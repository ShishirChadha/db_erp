import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { assertPublicHttps } from '@/lib/net-guard'
import { loadCompetitorsWithIdeas } from '@/lib/seo-competitors-state'
import { priceFetcher, probeSite } from '@/lib/competitor-prices/probe'

// Websites the owner has asked us to analyse, with the latest analysis of each and
// the ideas that follow from comparing it with our own site (also analysed).
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  try {
    return NextResponse.json(await loadCompetitorsWithIdeas())
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = (await req.json()) as { label?: string; base_url?: string; confirm_unreadable?: boolean }
  const label = String(body.label ?? '').trim()
  if (!label || label.length > 60) return NextResponse.json({ error: 'Give the website a name (max 60 characters)' }, { status: 400 })

  let url: URL
  try {
    const raw = String(body.base_url ?? '').trim()
    url = await assertPublicHttps(/^https?:\/\//i.test(raw) ? raw.replace(/^http:\/\//i, 'https://') : `https://${raw}`)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'That address cannot be analysed' }, { status: 400 })
  }
  const base = `https://${url.hostname}`

  // Warn before adding a site whose prices cannot be read automatically (bot check, robots block,
  // no price list). The SEO analysis can still run on it, so the owner may add it anyway.
  const probe = await probeSite(base, priceFetcher)
  if (probe.status !== 'ok' && body.confirm_unreadable !== true) {
    return NextResponse.json({ error: probe.message, needs_confirmation: true, probe }, { status: 409 })
  }

  const { data, error } = await supabaseAdmin.from('seo_competitors').insert({ label, base_url: base, added_by: sessionUser.id, price_enabled: probe.status === 'ok' }).select().single()
  if (error) return NextResponse.json({ error: error.code === '23505' ? 'That website is already in the list' : error.message }, { status: error.code === '23505' ? 409 : 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'settings',
    tableName: 'seo_competitors',
    recordId: data.id,
    recordLabel: `${label} (${base})`,
  })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const { data: row } = await supabaseAdmin.from('seo_competitors').select('*').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.is_self) return NextResponse.json({ error: 'Our own site is the baseline and cannot be removed' }, { status: 400 })

  const { error } = await supabaseAdmin.from('seo_competitors').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'hard_delete',
    module: 'settings',
    tableName: 'seo_competitors',
    recordId: id,
    recordLabel: `${row.label} (${row.base_url})`,
    snapshot: row,
  })
  return NextResponse.json({ success: true })
}

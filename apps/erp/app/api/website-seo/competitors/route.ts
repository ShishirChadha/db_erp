import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { assertPublicHttps } from '@/lib/net-guard'
import type { SiteSignals } from '@/lib/seo-competitor'
import { buildCompetitorIdeas } from '@/lib/seo-competitor-ideas'

// Websites the owner has asked us to analyse, with the latest analysis of each and
// the ideas that follow from comparing it with our own site (also analysed).
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data: sites, error } = await supabaseAdmin.from('seo_competitors').select('*').order('is_self', { ascending: false }).order('label')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: snaps } = await supabaseAdmin
    .from('seo_competitor_snapshots')
    .select('competitor_id, fetched_at, signals, error')
    .order('fetched_at', { ascending: false })
    .limit(200)
  const latest = new Map<string, { fetched_at: string; signals: SiteSignals | null; error: string | null }>()
  for (const s of snaps ?? []) if (!latest.has(s.competitor_id)) latest.set(s.competitor_id, s as any)

  const self = (sites ?? []).find((s) => s.is_self)
  const selfSignals = self ? latest.get(self.id)?.signals ?? null : null

  return NextResponse.json(
    (sites ?? []).map((s) => {
      const snap = latest.get(s.id) ?? null
      return {
        ...s,
        snapshot: snap,
        ideas: !s.is_self && snap?.signals ? buildCompetitorIdeas(selfSignals, snap.signals, s.label) : [],
      }
    })
  )
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = (await req.json()) as { label?: string; base_url?: string }
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

  const { data, error } = await supabaseAdmin.from('seo_competitors').insert({ label, base_url: base, added_by: sessionUser.id }).select().single()
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

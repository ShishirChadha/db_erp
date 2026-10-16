import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { normalizeBase, priceFetcher, probeSite } from '@/lib/competitor-prices/probe'

const SELECT = 'id, label, base_url, price_source, price_enabled, last_price_check_at, last_price_check_note, created_at'

async function audit(user: any, action: 'create' | 'update' | 'hard_delete', id: string, label: string, metadata?: Record<string, unknown>) {
  await logAuditEvent({
    actor: { id: user.id, email: user.email, role: user.role },
    actionType: action, module: 'settings', tableName: 'seo_competitors', recordId: id, recordLabel: label, metadata: metadata ?? null,
  })
}

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const { data, error } = await supabaseAdmin.from('seo_competitors').select(SELECT).eq('is_self', false).order('label')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

// Add a competitor. The site is probed first: if its prices cannot be read automatically
// (bot check, robots block, no price list) the owner is told and must confirm to add it.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const body = await req.json()
  const label = String(body.label ?? '').trim()
  if (!label || label.length > 60) return NextResponse.json({ error: 'Give the competitor a name (max 60 characters).' }, { status: 400 })

  let base: string
  try { base = await normalizeBase(body.base_url) } catch (e: any) { return NextResponse.json({ error: e?.message ?? 'That address cannot be used.' }, { status: 400 }) }

  const { data: existing } = await supabaseAdmin.from('seo_competitors').select('id').eq('base_url', base).maybeSingle()
  if (existing) return NextResponse.json({ error: 'That website is already in the list.' }, { status: 409 })

  const probe = await probeSite(base, priceFetcher)
  if (probe.status !== 'ok' && body.confirm_unreadable !== true) {
    return NextResponse.json({ error: probe.message, needs_confirmation: true, probe }, { status: 409 })
  }
  const { data, error } = await supabaseAdmin.from('seo_competitors')
    .insert({ label, base_url: base, added_by: sessionUser.id, price_enabled: probe.status === 'ok', last_price_check_note: probe.status === 'ok' ? null : `${probe.status}: ${probe.message}`.slice(0, 300) })
    .select(SELECT).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await audit(sessionUser, 'create', data.id, `${label} (${base})`, { probe })
  return NextResponse.json({ competitor: data, probe })
}

export async function PATCH(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const body = await req.json()
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const patch: Record<string, unknown> = {}
  if (typeof body.price_enabled === 'boolean') patch.price_enabled = body.price_enabled
  if (typeof body.label === 'string') {
    const l = body.label.trim()
    if (!l || l.length > 60) return NextResponse.json({ error: 'Name must be 1 to 60 characters.' }, { status: 400 })
    patch.label = l
  }
  if (body.price_source !== undefined) {
    if (body.price_source !== null && !['shopify', 'woocommerce', 'jsonld', 'none'].includes(body.price_source)) return NextResponse.json({ error: 'Unknown price source.' }, { status: 400 })
    patch.price_source = body.price_source
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  const { data, error } = await supabaseAdmin.from('seo_competitors').update(patch).eq('id', body.id).eq('is_self', false).select(SELECT).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await audit(sessionUser, 'update', data.id, data.label, { changed: patch })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const { data: row } = await supabaseAdmin.from('seo_competitors').select('id, label, base_url, is_self').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.is_self) return NextResponse.json({ error: 'Our own site cannot be removed.' }, { status: 400 })
  // stored prices, decisions and SEO analyses cascade with the row
  const { error } = await supabaseAdmin.from('seo_competitors').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await audit(sessionUser, 'hard_delete', id, `${row.label} (${row.base_url})`)
  return NextResponse.json({ ok: true })
}

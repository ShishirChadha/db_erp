import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// Keyword -> target page map. Volumes and positions are stored only when they
// come from a NAMED source (an import or an owner-entered figure with its
// source); the database refuses a volume without one, so nothing here is estimated.
const INTENTS = ['informational', 'commercial', 'transactional', 'navigational', 'local']
const SOURCES: Record<string, { kind: 'metrics' | 'volume'; label: string }> = {
  gsc: { kind: 'metrics', label: 'Search Console' },
  keyword_planner: { kind: 'volume', label: 'Google Keyword Planner' },
  trends: { kind: 'volume', label: 'Google Trends' },
  other: { kind: 'volume', label: 'Other tool' },
}

const txt = (v: unknown, max: number) => {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s.slice(0, max)
}
const int = (v: unknown) => {
  if (v === undefined || v === null || String(v).trim() === '') return null
  const n = Number(String(v).replace(/[,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const { data, error } = await supabaseAdmin.from('seo_keywords').select('*').order('priority', { ascending: true, nullsFirst: false }).order('keyword').range(0, 4999)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Two keywords of one cluster aimed at different pages compete with each other.
  const byCluster = new Map<string, Set<string>>()
  for (const k of data ?? []) {
    if (!k.cluster || !k.target_url) continue
    byCluster.set(k.cluster, (byCluster.get(k.cluster) ?? new Set()).add(k.target_url))
  }
  const cannibalisation = [...byCluster.entries()].filter(([, urls]) => urls.size > 1).map(([cluster, urls]) => ({ cluster, urls: [...urls] }))
  return NextResponse.json({ keywords: data ?? [], cannibalisation })
}

export async function PUT(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const b = (await req.json()) as Record<string, any>

  const keyword = txt(b.keyword, 200)
  if (!keyword) return NextResponse.json({ error: 'Keyword is required' }, { status: 400 })
  const intent = txt(b.intent, 30)
  if (intent && !INTENTS.includes(intent)) return NextResponse.json({ error: 'Invalid intent' }, { status: 400 })
  const target = txt(b.target_url, 300)
  if (target && !/^\/|^https:\/\//.test(target)) return NextResponse.json({ error: 'Target page must start with / or https://' }, { status: 400 })
  const priority = b.priority === '' || b.priority == null ? null : Number(b.priority)
  if (priority !== null && ![1, 2, 3].includes(priority)) return NextResponse.json({ error: 'Priority must be 1, 2 or 3' }, { status: 400 })
  const volume = int(b.volume)
  const volumeSource = txt(b.volume_source, 80)
  if (volume !== null && !volumeSource) return NextResponse.json({ error: 'A search volume needs its source (for example "Keyword Planner, Oct 2026")' }, { status: 400 })

  const row = {
    keyword, cluster: txt(b.cluster, 80), intent, geo: txt(b.geo, 40), target_url: target, priority,
    volume, volume_source: volume === null ? null : volumeSource, notes: txt(b.notes, 1000),
    updated_at: new Date().toISOString(), updated_by: sessionUser.id,
  }
  const q = typeof b.id === 'string' ? supabaseAdmin.from('seo_keywords').update(row).eq('id', b.id) : supabaseAdmin.from('seo_keywords').insert(row)
  const { data, error } = await q.select().single()
  if (error) return NextResponse.json({ error: error.code === '23505' ? 'That keyword is already in the list' : error.message }, { status: error.code === '23505' ? 409 : 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const { error } = await supabaseAdmin.from('seo_keywords').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

// Import already-parsed CSV rows from a named source.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const b = (await req.json()) as { source?: string; source_label?: string; as_of?: string; rows?: Record<string, any>[] }

  const source = SOURCES[b.source ?? '']
  if (!source) return NextResponse.json({ error: 'Choose where this file came from' }, { status: 400 })
  if (!Array.isArray(b.rows) || b.rows.length === 0 || b.rows.length > 5000) return NextResponse.json({ error: 'Send between 1 and 5000 rows' }, { status: 400 })
  const asOf = b.as_of && /^\d{4}-\d{2}-\d{2}$/.test(b.as_of) ? b.as_of : new Date().toISOString().slice(0, 10)
  const label = b.source === 'other' ? txt(b.source_label, 80) : source.label
  if (!label) return NextResponse.json({ error: 'Name the tool this came from' }, { status: 400 })
  const volumeSource = `${label}, ${asOf}`

  const { data: existing } = await supabaseAdmin.from('seo_keywords').select('id, keyword').range(0, 4999)
  const byKey = new Map((existing ?? []).map((k) => [k.keyword.toLowerCase(), k.id as string]))

  const inserts: Record<string, unknown>[] = []
  const updates: { id: string; patch: Record<string, unknown> }[] = []
  let skipped = 0
  const seen = new Set<string>()
  for (const r of b.rows) {
    const keyword = txt(r.keyword, 200)
    if (!keyword || seen.has(keyword.toLowerCase())) { skipped++; continue }
    seen.add(keyword.toLowerCase())
    let patch: Record<string, unknown>
    if (source.kind === 'metrics') {
      const position = r.position == null || String(r.position).trim() === '' ? null : Number(String(r.position).replace(/,/g, ''))
      patch = { clicks: int(r.clicks), impressions: int(r.impressions), avg_position: Number.isFinite(position as number) ? position : null, metrics_source: `${label}`, metrics_as_of: asOf }
    } else {
      const volume = int(r.volume)
      if (volume === null) { skipped++; continue }
      patch = { volume, volume_source: volumeSource }
    }
    const id = byKey.get(keyword.toLowerCase())
    if (id) updates.push({ id, patch: { ...patch, updated_at: new Date().toISOString(), updated_by: sessionUser.id } })
    else inserts.push({ keyword, ...patch, updated_by: sessionUser.id })
  }

  let inserted = 0
  for (let i = 0; i < inserts.length; i += 500) {
    const { error, count } = await supabaseAdmin.from('seo_keywords').insert(inserts.slice(i, i + 500), { count: 'exact' })
    if (error) return NextResponse.json({ error: error.message, inserted }, { status: 500 })
    inserted += count ?? 0
  }
  let updated = 0
  for (let i = 0; i < updates.length; i += 25) {
    const res = await Promise.all(updates.slice(i, i + 25).map((u) => supabaseAdmin.from('seo_keywords').update(u.patch).eq('id', u.id)))
    updated += res.filter((r) => !r.error).length
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'settings',
    tableName: 'seo_keywords',
    recordLabel: `Keyword import (${label})`,
    metadata: { inserted, updated, skipped },
  })
  return NextResponse.json({ inserted, updated, skipped })
}

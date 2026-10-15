import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { addRedirect, canonicalFilter, recordRevision, validateCollection } from '@/lib/seo-admin'
import { CATEGORY_SLUG, loadCollectionsWithState } from '@/lib/seo-collections-state'

// Owner-only. Each collection comes back with its live match counts and whether
// it currently passes the indexing gate (see lib/seo-collections-state.ts).
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  try {
    return NextResponse.json(await loadCollectionsWithState())
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// Create (no id) or update (id) one collection.
export async function PUT(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = (await req.json()) as Record<string, any>
  const checked = validateCollection(body)
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })
  const { row, warnings } = checked
  const id: string | undefined = typeof body.id === 'string' ? body.id : undefined

  // Two collections that match exactly the same products under different URLs
  // is the duplicate-page problem this module exists to avoid.
  const { data: siblings } = await supabaseAdmin.from('seo_collections').select('id, slug, filter').eq('category', row.category)
  const mine = canonicalFilter(row.filter)
  const dup = (siblings ?? []).find((s) => s.id !== id && canonicalFilter(s.filter ?? {}) === mine)
  if (dup) return NextResponse.json({ error: `Same filters as the existing collection "${dup.slug}". Edit that one instead.` }, { status: 409 })

  let before: Record<string, any> | null = null
  if (id) {
    const { data } = await supabaseAdmin.from('seo_collections').select('*').eq('id', id).maybeSingle()
    if (!data) return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    before = data
  }

  const payload = { ...row, updated_at: new Date().toISOString(), updated_by: sessionUser.id }
  const q = id
    ? supabaseAdmin.from('seo_collections').update(payload).eq('id', id)
    : supabaseAdmin.from('seo_collections').insert(payload)
  const { data, error } = await q.select().single()
  if (error) {
    const msg = error.code === '23505' ? 'That slug is already used in this category' : error.message
    return NextResponse.json({ error: msg }, { status: error.code === '23505' ? 409 : 500 })
  }

  if (before) await recordRevision('collection', `${before.category}:${before.slug}`, 'upsert', before, sessionUser.id)

  // A live page whose address changed keeps its inbound links and rankings.
  let redirected = false
  if (before && before.status === 'published' && (before.slug !== row.slug || before.category !== row.category)) {
    const r = await addRedirect({
      from: `/${CATEGORY_SLUG[before.category]}/${before.slug}`,
      to: `/${CATEGORY_SLUG[row.category as string]}/${row.slug}`,
      source: 'auto',
      note: 'Collection address changed',
      userId: sessionUser.id,
      targetIsLive: true,
    })
    redirected = r.ok
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: before ? 'update' : 'create',
    module: 'settings',
    tableName: 'seo_collections',
    recordId: data.id,
    recordLabel: `${row.category}:${row.slug}`,
    metadata: { status: row.status },
  })
  return NextResponse.json({ ...data, warnings, redirected })
}

export async function DELETE(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const { data: row } = await supabaseAdmin.from('seo_collections').select('*').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await supabaseAdmin.from('seo_collections').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recordRevision('collection', `${row.category}:${row.slug}`, 'delete', row, sessionUser.id)
  // A removed live page sends visitors to its parent category (not the home page).
  if (row.status === 'published') {
    await addRedirect({
      from: `/${CATEGORY_SLUG[row.category]}/${row.slug}`,
      to: `/${CATEGORY_SLUG[row.category]}`,
      source: 'auto',
      note: 'Collection removed',
      userId: sessionUser.id,
    })
  }
  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'hard_delete',
    module: 'settings',
    tableName: 'seo_collections',
    recordId: id,
    recordLabel: `${row.category}:${row.slug}`,
    snapshot: row,
  })
  return NextResponse.json({ success: true })
}

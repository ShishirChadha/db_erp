import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { recordRevision } from '@/lib/seo-admin'

// GET: recent change history (optionally for one entity).
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const type = req.nextUrl.searchParams.get('entity_type')
  const key = req.nextUrl.searchParams.get('entity_key')
  let query = supabaseAdmin.from('seo_revisions').select('*').order('created_at', { ascending: false }).limit(100)
  if (type) query = query.eq('entity_type', type)
  if (key) query = query.eq('entity_key', key)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

const SETTINGS_FIELDS = ['default_description', 'default_og_image_path', 'product_description_template']
const OVERRIDE_FIELDS = ['entity_type', 'entity_key', 'meta_title', 'meta_description', 'og_image_path', 'robots_index', 'canonical_override', 'status']

// POST { id }: put the saved snapshot back. The current state is snapshotted
// first, so a rollback can itself be rolled back.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = (await req.json()) as { id?: string }
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const { data: rev } = await supabaseAdmin.from('seo_revisions').select('*').eq('id', id).maybeSingle()
  if (!rev) return NextResponse.json({ error: 'Revision not found' }, { status: 404 })
  const snap = rev.snapshot as Record<string, any>

  if (rev.entity_type === 'settings') {
    const { data: current } = await supabaseAdmin.from('seo_settings').select('*').maybeSingle()
    if (current) await recordRevision('settings', 'singleton', 'upsert', current, sessionUser.id)
    const patch = Object.fromEntries(SETTINGS_FIELDS.map((f) => [f, snap[f] ?? null]))
    const { error } = await supabaseAdmin
      .from('seo_settings')
      .update({ ...patch, updated_at: new Date().toISOString(), updated_by: sessionUser.id })
      .eq('id', true)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else if (rev.entity_type === 'override') {
    const row = Object.fromEntries(OVERRIDE_FIELDS.map((f) => [f, snap[f] ?? null]))
    const { data: current } = await supabaseAdmin
      .from('seo_overrides')
      .select('*')
      .eq('entity_type', row.entity_type)
      .eq('entity_key', row.entity_key)
      .maybeSingle()
    if (current) await recordRevision('override', rev.entity_key, 'upsert', current, sessionUser.id)
    const { error } = await supabaseAdmin
      .from('seo_overrides')
      .upsert({ ...row, updated_at: new Date().toISOString(), updated_by: sessionUser.id }, { onConflict: 'entity_type,entity_key' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else if (rev.entity_type === 'collection') {
    const row = Object.fromEntries(
      ['category', 'slug', 'kind', 'name', 'h1', 'meta_title', 'meta_description', 'intro_md', 'faq', 'filter', 'min_products', 'min_intro_words', 'status'].map((f) => [f, snap[f] ?? null])
    )
    const { data: current } = await supabaseAdmin.from('seo_collections').select('*').eq('category', row.category).eq('slug', row.slug).maybeSingle()
    if (current) await recordRevision('collection', rev.entity_key, 'upsert', current, sessionUser.id)
    const { error } = await supabaseAdmin
      .from('seo_collections')
      .upsert({ ...row, updated_at: new Date().toISOString(), updated_by: sessionUser.id }, { onConflict: 'category,slug' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else if (rev.entity_type === 'site_profile') {
    // Put back every editable column from the saved row (never id / audit columns).
    const patch = Object.fromEntries(
      Object.entries(snap).filter(([k]) => !['id', 'updated_at', 'updated_by'].includes(k))
    )
    const { data: current } = await supabaseAdmin.from('site_profile').select('*').maybeSingle()
    if (current) await recordRevision('site_profile', 'singleton', 'upsert', current, sessionUser.id)
    const { error } = await supabaseAdmin
      .from('site_profile')
      .update({ ...patch, updated_at: new Date().toISOString(), updated_by: sessionUser.id })
      .eq('id', true)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else if (rev.entity_type === 'redirect') {
    const { error } = await supabaseAdmin
      .from('seo_redirects')
      .upsert(
        { from_path: snap.from_path, to_path: snap.to_path, source: snap.source ?? 'manual', note: snap.note ?? null, created_by: sessionUser.id },
        { onConflict: 'from_path' }
      )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    return NextResponse.json({ error: 'Unsupported revision type' }, { status: 400 })
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'restore',
    module: 'settings',
    tableName: ({ settings: 'seo_settings', override: 'seo_overrides', collection: 'seo_collections', site_profile: 'site_profile', redirect: 'seo_redirects' } as Record<string, string>)[rev.entity_type],
    recordLabel: rev.entity_key,
    metadata: { revision_id: id },
  })
  return NextResponse.json({ success: true })
}

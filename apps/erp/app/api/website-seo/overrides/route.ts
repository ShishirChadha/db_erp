import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { recordRevision, validateOverride } from '@/lib/seo-admin'

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const type = req.nextUrl.searchParams.get('entity_type')
  let query = supabaseAdmin.from('seo_overrides').select('*').order('updated_at', { ascending: false })
  if (type) query = query.eq('entity_type', type)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// Upsert on (entity_type, entity_key): one override row per page.
export async function PUT(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const checked = validateOverride(await req.json())
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })
  const { row, warnings } = checked

  const { data: before } = await supabaseAdmin
    .from('seo_overrides')
    .select('*')
    .eq('entity_type', row.entity_type as string)
    .eq('entity_key', row.entity_key as string)
    .maybeSingle()

  const { data, error } = await supabaseAdmin
    .from('seo_overrides')
    .upsert({ ...row, updated_at: new Date().toISOString(), updated_by: sessionUser.id }, { onConflict: 'entity_type,entity_key' })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const key = `${row.entity_type}:${row.entity_key}`
  if (before) await recordRevision('override', key, 'upsert', before, sessionUser.id)
  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: before ? 'update' : 'create',
    module: 'settings',
    tableName: 'seo_overrides',
    recordId: data.id,
    recordLabel: key,
    metadata: row,
  })
  return NextResponse.json({ ...data, warnings })
}

export async function DELETE(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { data: row } = await supabaseAdmin.from('seo_overrides').select('*').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { error } = await supabaseAdmin.from('seo_overrides').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const key = `${row.entity_type}:${row.entity_key}`
  await recordRevision('override', key, 'delete', row, sessionUser.id)
  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'hard_delete',
    module: 'settings',
    tableName: 'seo_overrides',
    recordId: id,
    recordLabel: key,
    snapshot: row,
  })
  return NextResponse.json({ success: true })
}

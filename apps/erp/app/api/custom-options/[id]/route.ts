import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- PATCH: owner edits or activates/deactivates a dropdown value ----------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json()

  const allowed = ['value', 'is_active', 'sort_order']
  const updates: Record<string, any> = {}
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key]
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('custom_options')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'update',
    module: 'settings',
    tableName: 'custom_options',
    recordId: id,
    recordLabel: data?.value ?? id,
    metadata: updates,
  })

  return NextResponse.json(data)
}

// ---------- DELETE: owner permanently removes a dropdown value ----------
// Prefer PATCH { is_active: false } for values that were ever used historically --
// this is for cleaning up genuine mistakes (typos, duplicates).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data: existing } = await supabaseAdmin.from('custom_options').select('*').eq('id', id).maybeSingle()
  const { error } = await supabaseAdmin.from('custom_options').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'hard_delete',
    module: 'settings',
    tableName: 'custom_options',
    recordId: id,
    recordLabel: existing?.value ?? id,
    snapshot: existing ? { kind: 'row', table: 'custom_options', row: existing } : null,
    restoreStatus: 'not_applicable',
  })

  return NextResponse.json({ success: true })
}

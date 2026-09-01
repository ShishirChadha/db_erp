import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

const EDITABLE = [
  'type', 'description', 'payment_account', 'vendor_id', 'expected_amount',
  'interval_unit', 'next_due_date', 'reminder_lead_days', 'assignee_id', 'is_active',
]

// ---------- PATCH: owner edits a rule or toggles is_active ----------
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json()

  const updates: Record<string, any> = {}
  for (const key of EDITABLE) {
    if (body[key] !== undefined) updates[key] = body[key]
  }
  if (updates.payment_account !== undefined) {
    updates.entity_key = updates.payment_account ? String(updates.payment_account).toLowerCase() : null
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('recurring_expense_rules')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'update',
    module: 'expenses',
    tableName: 'recurring_expense_rules',
    recordId: id,
    recordLabel: `Recurring: ${data.type} (${data.interval_unit})`,
    metadata: updates,
  })

  return NextResponse.json(data)
}

// ---------- DELETE: owner permanently removes a rule ----------
// Prefer PATCH { is_active: false } to pause one that was ever real -- this is for
// cleaning up genuine mistakes, same convention as custom_options.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data: existing } = await supabaseAdmin.from('recurring_expense_rules').select('*').eq('id', id).maybeSingle()
  const { error } = await supabaseAdmin.from('recurring_expense_rules').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'hard_delete',
    module: 'expenses',
    tableName: 'recurring_expense_rules',
    recordId: id,
    recordLabel: existing ? `Recurring: ${existing.type} (${existing.interval_unit})` : id,
    snapshot: existing ? { kind: 'row', table: 'recurring_expense_rules', row: existing } : null,
    restoreStatus: 'not_applicable',
  })

  return NextResponse.json({ success: true })
}

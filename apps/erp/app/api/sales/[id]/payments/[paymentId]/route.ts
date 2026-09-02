import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { logFieldCorrections } from '@/lib/field-corrections'

// ---------- PATCH: correct an existing payment's date ----------
// Owner-only, same correction tier as DELETE below (an employee who mis-recorded an
// installment's date can't silently rewrite the ledger). Only recorded_at is editable
// here -- amount/account corrections still go through DELETE + re-add via POST, since
// changing the amount changes the sum sales.amount_paid/payment_status are trigger-
// derived from, and that's cleaner as a real delete+insert than an in-place mutation.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id, paymentId } = await params
  const body = await req.json().catch(() => ({}))
  const recordedAtDate: string = body.recorded_at || ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recordedAtDate)) {
    return NextResponse.json({ error: 'recorded_at must be in YYYY-MM-DD format.' }, { status: 400 })
  }

  const { data: existing } = await supabaseAdmin
    .from('sale_payments')
    .select('id, recorded_at')
    .eq('id', paymentId)
    .eq('sale_id', id)
    .single()
  if (!existing) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })

  const newRecordedAt = `${recordedAtDate}T12:00:00.000Z`
  const { error } = await supabaseAdmin
    .from('sale_payments')
    .update({ recorded_at: newRecordedAt })
    .eq('id', paymentId)
    .eq('sale_id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logFieldCorrections(
    'sale_payments',
    paymentId,
    [{ field: 'recorded_at', oldValue: existing.recorded_at, newValue: newRecordedAt }],
    sessionUser.id,
    body.reason || null
  )

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'sales',
    tableName: 'sale_payments',
    recordId: paymentId,
    recordLabel: `Payment date correction on sale ${id}`,
  })

  return NextResponse.json({ success: true, recorded_at: newRecordedAt })
}

// ---------- DELETE: remove an erroneous payment entry ----------
// Owner-only correction (a mis-entered installment) -- the trigger on sale_payments
// recomputes sales.amount_paid/payment_status automatically after the delete.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id, paymentId } = await params

  const { data: existingPayment } = await supabaseAdmin
    .from('sale_payments')
    .select('*')
    .eq('id', paymentId)
    .eq('sale_id', id)
    .single()

  const { error } = await supabaseAdmin
    .from('sale_payments')
    .delete()
    .eq('id', paymentId)
    .eq('sale_id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: updatedSale } = await supabaseAdmin
    .from('sales')
    .select('amount_paid, payment_status')
    .eq('id', id)
    .single()

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'hard_delete',
    module: 'sales',
    tableName: 'sale_payments',
    recordId: paymentId,
    recordLabel: existingPayment ? `Payment of ₹${existingPayment.amount} on sale ${id}` : paymentId,
    snapshot: existingPayment ? { kind: 'row', table: 'sale_payments', row: existingPayment } : null,
    restoreStatus: existingPayment ? 'restorable' : 'not_applicable',
  })

  return NextResponse.json({ sale: updatedSale })
}

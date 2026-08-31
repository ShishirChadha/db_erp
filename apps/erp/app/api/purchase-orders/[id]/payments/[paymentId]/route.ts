import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- DELETE: remove an erroneous payment entry ----------
// Owner-only correction (a mis-entered installment) -- the trigger on vendor_payments
// recomputes purchase_orders.amount_paid/payment_status automatically after the delete.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id, paymentId } = await params

  const { data: existingPayment } = await supabaseAdmin
    .from('vendor_payments')
    .select('*')
    .eq('id', paymentId)
    .eq('po_id', id)
    .single()

  const { error } = await supabaseAdmin
    .from('vendor_payments')
    .delete()
    .eq('id', paymentId)
    .eq('po_id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: updatedPo } = await supabaseAdmin
    .from('purchase_orders')
    .select('amount_paid, payment_status')
    .eq('id', id)
    .single()

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'hard_delete',
    module: 'purchasing',
    tableName: 'vendor_payments',
    recordId: paymentId,
    recordLabel: existingPayment ? `Payment of ₹${existingPayment.amount} on PO ${id}` : paymentId,
    snapshot: existingPayment ? { kind: 'row', table: 'vendor_payments', row: existingPayment } : null,
    restoreStatus: existingPayment ? 'restorable' : 'not_applicable',
  })

  return NextResponse.json({ purchase_order: updatedPo })
}

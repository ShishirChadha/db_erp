import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

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

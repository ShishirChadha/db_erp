import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- DELETE: remove an erroneous reimbursement entry ----------
// Owner-only correction (a mis-entered installment) -- the trigger on
// expense_reimbursements recomputes expenses.reimbursed_amount/reimbursement_status
// automatically after the delete.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; reimbursementId: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id, reimbursementId } = await params

  const { data: existing } = await supabaseAdmin
    .from('expense_reimbursements')
    .select('*')
    .eq('id', reimbursementId)
    .eq('expense_id', id)
    .single()

  const { error } = await supabaseAdmin
    .from('expense_reimbursements')
    .delete()
    .eq('id', reimbursementId)
    .eq('expense_id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: updatedExpense } = await supabaseAdmin
    .from('expenses')
    .select('reimbursed_amount, reimbursement_status')
    .eq('id', id)
    .single()

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'hard_delete',
    module: 'expenses',
    tableName: 'expense_reimbursements',
    recordId: reimbursementId,
    recordLabel: existing ? `Reimbursement of ₹${existing.amount} on expense ${id}` : reimbursementId,
    snapshot: existing ? { kind: 'row', table: 'expense_reimbursements', row: existing } : null,
    restoreStatus: existing ? 'restorable' : 'not_applicable',
  })

  return NextResponse.json({ expense: updatedExpense })
}

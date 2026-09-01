import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, canEditPage } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// Append-only ledger of reimbursement installments against an expense a staff
// member paid out of pocket (docs/decisions.md, 2026-09-01). expenses.reimbursed_amount/
// reimbursement_status are trigger-derived from the sum of these rows -- never
// written directly here. Mirrors /api/sales/[id]/payments exactly.

// ---------- GET: list installments for an expense ----------
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!hasPageAccess(sessionUser, 'expenses')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data, error } = await supabaseAdmin
    .from('expense_reimbursements')
    .select('id, amount, payment_account, note, recorded_by, recorded_at, profiles:recorded_by(full_name)')
    .eq('expense_id', id)
    .order('recorded_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const result = (data || []).map((row: any) => ({
    id: row.id,
    amount: row.amount,
    payment_account: row.payment_account,
    note: row.note,
    recorded_at: row.recorded_at,
    recorded_by_name: row.profiles?.full_name || null,
  }))
  return NextResponse.json(result)
}

// ---------- POST: record a new reimbursement installment ----------
// Open to any role with the 'expenses' edit grant -- same "immediately real"
// principle as sale_payments. In practice the owner is usually the one clearing
// dues at month-end, but this isn't restricted to isOwner, matching how any
// role can record a sale-payment installment. Owner corrections/reversals go
// through DELETE below, not this route.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPage(sessionUser, 'expenses')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const amount = Number(body.amount)

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Amount must be a positive number.' }, { status: 400 })
  }

  const { data: expense, error: expenseErr } = await supabaseAdmin
    .from('expenses')
    .select('id, amount, reimbursed_amount, paid_by_staff, payment_account, is_deleted')
    .eq('id', id)
    .single()
  if (expenseErr || !expense || expense.is_deleted) {
    return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
  }
  if (!expense.paid_by_staff) {
    return NextResponse.json({ error: 'This expense has no "Paid By" staff member set -- nothing to reimburse.' }, { status: 400 })
  }

  const alreadyReimbursed = Number(expense.reimbursed_amount) || 0
  const expenseAmount = Number(expense.amount) || 0
  // Small rounding tolerance, not a hard equality check -- catches a genuine
  // typo (an extra digit) without fighting paise-level rounding differences.
  if (!body.confirm_overpayment && alreadyReimbursed + amount > expenseAmount + 0.5) {
    return NextResponse.json({
      error: `This would bring total reimbursed to ₹${(alreadyReimbursed + amount).toFixed(2)}, above the expense amount of ₹${expenseAmount.toFixed(2)}. Submit again to confirm this is correct.`,
      error_code: 'exceeds_expense_amount',
    }, { status: 409 })
  }

  const { data: reimbursement, error } = await supabaseAdmin
    .from('expense_reimbursements')
    .insert({
      expense_id: id,
      amount,
      payment_account: body.payment_account || null,
      note: body.note || null,
      recorded_by: sessionUser.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // A staff-paid expense has no company account attributed at entry time (see
  // AddExpenseDialog -- "Paid From" is hidden whenever paid_by_staff is set,
  // since which account actually bears the cost isn't known until it's settled).
  // The first reimbursement that names a payment_account is what finally answers
  // that question, so propagate it onto the expense itself -- otherwise the
  // expense would stay unattributed to either entity in reporting/recon forever.
  // Only fills a currently-empty value; never overwrites an explicit one.
  if (!expense.payment_account && body.payment_account) {
    await supabaseAdmin
      .from('expenses')
      .update({ payment_account: body.payment_account, entity_key: String(body.payment_account).toLowerCase() })
      .eq('id', id)
  }

  const { data: updatedExpense } = await supabaseAdmin
    .from('expenses')
    .select('reimbursed_amount, reimbursement_status, payment_account, entity_key')
    .eq('id', id)
    .single()

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'expenses',
    tableName: 'expense_reimbursements',
    recordId: reimbursement?.id || null,
    recordLabel: `Reimbursement of ₹${amount} on expense ${id}`,
  })

  return NextResponse.json({ reimbursement, expense: updatedExpense })
}

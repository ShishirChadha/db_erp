import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner, isManagerOrAbove } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// Append-only ledger of individual payment installments against a purchase order --
// the debit-side twin of sale_payments (see docs/decisions.md, "vendor_payments
// ledger"). purchase_orders.amount_paid/payment_status are trigger-derived from the
// sum of these rows -- never written directly here. This is the prerequisite bank
// recon's debit-matching depends on: a PO's grand_total only ever recorded what is
// owed, never what was paid.

// ---------- GET: list installments for a PO ----------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isManagerOrAbove(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data, error } = await supabaseAdmin
    .from('vendor_payments')
    .select('id, amount, payment_account, paid_on, method, reference, note, recorded_by, recorded_at, profiles:recorded_by(full_name)')
    .eq('po_id', id)
    .order('paid_on', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const result = (data || []).map((row: any) => ({
    id: row.id,
    amount: row.amount,
    payment_account: row.payment_account,
    paid_on: row.paid_on,
    method: row.method,
    reference: row.reference,
    note: row.note,
    recorded_at: row.recorded_at,
    recorded_by_name: row.profiles?.full_name || null,
  }))
  return NextResponse.json(result)
}

// ---------- POST: record a new payment installment ----------
// Owner-only, matching the sensitivity of the PO's other money-moving mutations
// (receive stock, edit line items) rather than sale_payments' broader "any
// sell-adjacent role" posture -- Purchase Orders is owner territory throughout.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const amount = Number(body.amount)

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Amount must be a positive number.' }, { status: 400 })
  }

  const { data: po, error: poErr } = await supabaseAdmin
    .from('purchase_orders')
    .select('id, grand_total, amount_paid, is_deleted')
    .eq('id', id)
    .single()
  if (poErr || !po || po.is_deleted) {
    return NextResponse.json({ error: 'Purchase Order not found' }, { status: 404 })
  }

  const alreadyPaid = Number(po.amount_paid) || 0
  const grandTotal = Number(po.grand_total) || 0
  // Small rounding tolerance, not a hard equality check -- catches a genuine typo
  // (an extra digit) without fighting paise-level rounding differences, same
  // guard sale_payments uses.
  if (!body.confirm_overpayment && alreadyPaid + amount > grandTotal + 0.5) {
    return NextResponse.json({
      error: `This would bring total paid to ₹${(alreadyPaid + amount).toFixed(2)}, above the PO total of ₹${grandTotal.toFixed(2)}. Submit again to confirm this is correct.`,
      error_code: 'exceeds_po_total',
    }, { status: 409 })
  }

  const { data: payment, error } = await supabaseAdmin
    .from('vendor_payments')
    .insert({
      po_id: id,
      purchase_invoice_id: body.purchase_invoice_id || null,
      amount,
      payment_account: body.payment_account || null,
      paid_on: body.paid_on || new Date().toISOString().slice(0, 10),
      method: body.method || null,
      reference: body.reference || null,
      note: body.note || null,
      recorded_by: sessionUser.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: updatedPo } = await supabaseAdmin
    .from('purchase_orders')
    .select('amount_paid, payment_status')
    .eq('id', id)
    .single()

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'purchasing',
    tableName: 'vendor_payments',
    recordId: payment?.id || null,
    recordLabel: `Payment of ₹${amount} on PO ${id}`,
  })

  return NextResponse.json({ payment, purchase_order: updatedPo })
}

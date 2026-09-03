import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- POST: record a match against this bank transaction ----------
// Five match_type shapes:
// - sale_payment: links an already-existing sale_payments row.
// - vendor_payment: either links an already-existing vendor_payments row
//   (vendor_payment_id), OR -- the normal case, since a bank debit is usually the
//   FIRST evidence a PO got paid -- creates a new one against an existing PO (po_id)
//   by calling the existing POST /api/purchase-orders/[id]/payments route rather
//   than duplicating its overpayment-guard/trigger-derived-totals logic here.
// - stock_purchase: links a stock_movements receipt (the no-PO accessory-purchase
//   case, vendor/price already captured at receive-stock time -- see
//   lib/recon/purchase-matcher.ts) -- never writes to inventory, purely a link.
// - expense: creates a NEW expenses row from the transaction's own narration/amount
//   in the same call (an expense normally doesn't pre-exist -- it's discovered from
//   the bank line), then links it. source='bank_recon' distinguishes it from a
//   manually-entered expense.
// - transfer_pair: links this transaction to the OTHER leg of an inter-entity
//   transfer (counterpart_txn_id) -- writes a match row on BOTH transactions, each
//   worth its own amount, so both sides end up recon_status='transfer' and neither
//   counts toward P&L via the normal expense/sale-payment paths.
// recon_status is never set directly here -- trg_sync_bank_transaction_recon_status
// derives it from the sum of matches after this insert.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const { match_type, sale_payment_id, vendor_payment_id, po_id, stock_movement_id, expense, counterpart_txn_id, amount_applied, variance_reason } = body

  const { data: txn, error: txnErr } = await supabaseAdmin.from('bank_transactions').select('*').eq('id', id).single()
  if (txnErr || !txn) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })

  const txnAmount = txn.debit || txn.credit || 0
  const applied = amount_applied != null ? Number(amount_applied) : txnAmount
  if (!(applied > 0)) return NextResponse.json({ error: 'amount_applied must be positive.' }, { status: 400 })

  let expenseId: string | null = null
  let resolvedVendorPaymentId: string | null = null

  if (match_type === 'sale_payment') {
    if (!sale_payment_id) return NextResponse.json({ error: 'sale_payment_id is required.' }, { status: 400 })
  } else if (match_type === 'vendor_payment') {
    if (vendor_payment_id) {
      resolvedVendorPaymentId = vendor_payment_id
    } else if (po_id) {
      const paymentRes = await fetch(new URL(`/api/purchase-orders/${po_id}/payments`, req.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: req.headers.get('authorization') || '' },
        body: JSON.stringify({ amount: applied, paid_on: txn.txn_date, method: 'bank', reference: txn.reference || txn.narration, note: `Auto-recorded from bank recon: ${txn.narration}` }),
      })
      const paymentJson = await paymentRes.json()
      if (!paymentRes.ok) return NextResponse.json({ error: paymentJson.error || 'Failed to record vendor payment against this PO.' }, { status: paymentRes.status })
      resolvedVendorPaymentId = paymentJson.payment.id
    } else {
      return NextResponse.json({ error: 'vendor_payment_id or po_id is required.' }, { status: 400 })
    }
  } else if (match_type === 'stock_purchase') {
    if (!stock_movement_id) return NextResponse.json({ error: 'stock_movement_id is required.' }, { status: 400 })
  } else if (match_type === 'expense') {
    if (!expense?.description || !expense?.type) return NextResponse.json({ error: 'expense.description and expense.type are required.' }, { status: 400 })
    const paymentAccount = txn.bank_account_id
      ? (await supabaseAdmin.from('bank_accounts').select('entity_key').eq('id', txn.bank_account_id).single()).data?.entity_key
      : null
    const { data: newExpense, error: expenseErr } = await supabaseAdmin
      .from('expenses')
      .insert({
        expense_date: txn.txn_date,
        description: expense.description,
        type: expense.type,
        amount: applied,
        payment_account: paymentAccount ? paymentAccount.charAt(0).toUpperCase() + paymentAccount.slice(1) : null,
        entity_key: paymentAccount || null,
        vendor_id: expense.vendor_id || null,
        created_by: sessionUser.id,
        source: 'bank_recon',
      })
      .select()
      .single()
    if (expenseErr) return NextResponse.json({ error: expenseErr.message }, { status: 500 })
    expenseId = newExpense.id
  } else if (match_type === 'transfer_pair') {
    if (!counterpart_txn_id) return NextResponse.json({ error: 'counterpart_txn_id is required.' }, { status: 400 })
    const { data: counterpart } = await supabaseAdmin.from('bank_transactions').select('id, debit, credit').eq('id', counterpart_txn_id).single()
    if (!counterpart) return NextResponse.json({ error: 'Counterpart transaction not found.' }, { status: 404 })
    const counterpartAmount = counterpart.debit || counterpart.credit || 0
    await supabaseAdmin.from('bank_transaction_matches').insert({
      bank_transaction_id: counterpart_txn_id, match_type: 'transfer_pair', counterpart_txn_id: id,
      amount_applied: counterpartAmount, matched_by: sessionUser.id,
    })
  } else {
    return NextResponse.json({ error: 'match_type must be sale_payment, vendor_payment, stock_purchase, expense, or transfer_pair.' }, { status: 400 })
  }

  const variance = applied !== txnAmount ? applied - txnAmount : null

  const { data: match, error: matchErr } = await supabaseAdmin
    .from('bank_transaction_matches')
    .insert({
      bank_transaction_id: id, match_type,
      sale_payment_id: match_type === 'sale_payment' ? sale_payment_id : null,
      vendor_payment_id: match_type === 'vendor_payment' ? resolvedVendorPaymentId : null,
      stock_movement_id: match_type === 'stock_purchase' ? stock_movement_id : null,
      expense_id: expenseId,
      counterpart_txn_id: match_type === 'transfer_pair' ? counterpart_txn_id : null,
      amount_applied: applied, variance, variance_reason: variance_reason || null,
      matched_by: sessionUser.id,
    })
    .select()
    .single()
  if (matchErr) return NextResponse.json({ error: matchErr.message }, { status: 500 })

  const { data: updatedTxn } = await supabaseAdmin.from('bank_transactions').select('recon_status').eq('id', id).single()

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create', module: 'reconciliation', tableName: 'bank_transaction_matches', recordId: match.id,
    recordLabel: `${match_type} match on ${txn.narration} (₹${applied})`,
  })

  return NextResponse.json({ match, recon_status: updatedTxn?.recon_status })
}

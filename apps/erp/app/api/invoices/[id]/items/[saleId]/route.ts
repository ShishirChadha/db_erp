import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { logFieldCorrections } from '@/lib/field-corrections'

// ---------- DELETE: un-invoice one sale that was wrongly included (e.g. a mis-click in
// the finalize checkbox list) without touching anything else on the invoice ----------
// Owner-only, same correction tier as a sale void/payment delete. Unlike voiding the sale
// itself, this does NOT touch inventory or the sale's own price/payment -- the sale just
// goes back to being un-finalized (visible again in the owner's pending-invoice queue) and
// the invoice's totals are recomputed from whatever items remain. Refuses to remove an
// invoice's only item -- there's no invoice-void flow exposed yet, so that case needs a
// manual/owner decision rather than silently leaving a zero-item invoice behind.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; saleId: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id: invoiceId, saleId } = await params
  const body = await req.json().catch(() => ({}))
  const reason = (body.reason || '').trim()
  if (!reason) return NextResponse.json({ error: 'A reason is required to remove an item from an invoice.' }, { status: 400 })

  const { data: invoice } = await supabaseAdmin.from('invoices').select('id, invoice_number').eq('id', invoiceId).single()
  if (!invoice) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })

  const { data: sale } = await supabaseAdmin
    .from('sales')
    .select('id, invoice_id, finalized, customer_name, sale_total, asset_ledger_id, accessory_id, repair_job_id')
    .eq('id', saleId)
    .single()
  if (!sale) return NextResponse.json({ error: 'Sale not found.' }, { status: 404 })
  if (sale.invoice_id !== invoiceId) {
    return NextResponse.json({ error: 'This sale is not linked to this invoice.' }, { status: 400 })
  }

  const { count: linkedCount } = await supabaseAdmin
    .from('sales')
    .select('id', { count: 'exact', head: true })
    .eq('invoice_id', invoiceId)
  if ((linkedCount ?? 0) <= 1) {
    return NextResponse.json({
      error: 'This is the invoice\'s only item -- removing it would leave an empty invoice. Void the sale instead if the whole invoice was a mistake.',
    }, { status: 409 })
  }

  // Prefer the direct link (every item created after 2026-09-28 has sale_id); fall back to
  // the same asset/accessory/repair-job match used to backfill older rows, but only when it
  // resolves to exactly one row -- an ambiguous match is refused rather than guessed at.
  let itemQuery = supabaseAdmin.from('invoice_items').select('id, description, amount').eq('invoice_id', invoiceId).eq('sale_id', saleId)
  let { data: matchedItems } = await itemQuery
  if (!matchedItems || matchedItems.length === 0) {
    let fallback = supabaseAdmin.from('invoice_items').select('id, description, amount').eq('invoice_id', invoiceId).is('sale_id', null)
    if (sale.asset_ledger_id) fallback = fallback.eq('ledger_asset_id', sale.asset_ledger_id)
    else if (sale.repair_job_id) fallback = fallback.eq('repair_job_id', sale.repair_job_id)
    else if (sale.accessory_id) fallback = fallback.eq('accessory_id', sale.accessory_id).eq('amount', sale.sale_total)
    const { data: fallbackItems } = await fallback
    matchedItems = fallbackItems || []
  }
  if (matchedItems.length === 0) {
    return NextResponse.json({ error: 'Could not find this sale\'s line item on the invoice.' }, { status: 500 })
  }
  if (matchedItems.length > 1) {
    return NextResponse.json({ error: 'Multiple matching line items found on this invoice -- refusing to guess which one to remove.' }, { status: 409 })
  }
  const item = matchedItems[0]

  const { error: deleteErr } = await supabaseAdmin.from('invoice_items').delete().eq('id', item.id)
  if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 })

  const { data: remainingItems } = await supabaseAdmin
    .from('invoice_items')
    .select('rate, quantity, cgst_amount, sgst_amount, igst_amount, amount')
    .eq('invoice_id', invoiceId)
  const newSubtotal = (remainingItems || []).reduce((a, r) => a + Number(r.rate) * Number(r.quantity), 0)
  const newTotalGst = (remainingItems || []).reduce((a, r) => a + Number(r.cgst_amount || 0) + Number(r.sgst_amount || 0) + Number(r.igst_amount || 0), 0)
  const newGrandTotal = (remainingItems || []).reduce((a, r) => a + Number(r.amount), 0)

  const { data: remainingSales } = await supabaseAdmin.from('sales').select('payment_status').eq('invoice_id', invoiceId)
  const allPaid = (remainingSales || []).length > 0 && (remainingSales || []).every((s: any) => s.payment_status === 'paid')

  const { error: invUpdateErr } = await supabaseAdmin
    .from('invoices')
    .update({
      subtotal: newSubtotal,
      total_gst: newTotalGst,
      grand_total: newGrandTotal,
      total_amount: newSubtotal,
      gst_total: newTotalGst,
      payment_status: allPaid ? 'paid' : 'pending',
    })
    .eq('id', invoiceId)
  if (invUpdateErr) return NextResponse.json({ error: `Item removed, but updating invoice totals failed: ${invUpdateErr.message}` }, { status: 500 })

  const { error: saleUpdateErr } = await supabaseAdmin
    .from('sales')
    .update({ finalized: false, finalized_by: null, finalized_at: null, invoice_id: null, invoice_number: null })
    .eq('id', saleId)
  if (saleUpdateErr) return NextResponse.json({ error: `Item removed from invoice, but resetting the sale failed: ${saleUpdateErr.message}` }, { status: 500 })

  const fieldCorrectionIds = await logFieldCorrections(
    'sales',
    saleId,
    [
      { field: 'invoice_id', oldValue: invoiceId, newValue: null },
      { field: 'invoice_number', oldValue: invoice.invoice_number, newValue: null },
      { field: 'finalized', oldValue: true, newValue: false },
    ],
    sessionUser.id,
    reason
  )

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'hard_delete',
    module: 'invoices',
    tableName: 'invoice_items',
    recordId: item.id,
    recordLabel: `${item.description} removed from invoice ${invoice.invoice_number}`,
    snapshot: { kind: 'row', table: 'invoice_items', row: item },
    restoreStatus: 'not_applicable',
    fieldCorrectionIds,
    reason,
  })

  return NextResponse.json({ success: true, invoice: { subtotal: newSubtotal, total_gst: newTotalGst, grand_total: newGrandTotal } })
}

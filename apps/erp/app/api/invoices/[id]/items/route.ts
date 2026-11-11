import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { logFieldCorrections } from '@/lib/field-corrections'
import { calculateGST } from '@/lib/gstCalculation'

// ---------- POST: add a manual/custom charge (shipping, packing, etc.) to an
// existing invoice, regardless of its status ----------
// Owner-only, same tier as the sibling DELETE .../items/[saleId] route this
// mirrors. Unlike that route's removal of a sale-linked item, this never
// touches `sales` -- a custom line has no sale_id, same shape SalesDocumentForm
// already uses for quotations/proforma invoices. Requires a reason since this
// changes a document that may already be with the customer (fully audited via
// field_corrections/audit_log, same convention as every other manual
// correction in this app).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id: invoiceId } = await params
  const body = await req.json().catch(() => ({}))
  const description = (body.description || '').trim()
  const hsnCode = (body.hsn_code || '').trim() || null
  const quantity = Number(body.quantity)
  const rate = Number(body.rate)
  const gstRate = body.gst_rate === '' || body.gst_rate === null || body.gst_rate === undefined ? 0 : Number(body.gst_rate)
  const reason = (body.reason || '').trim()

  if (!description) return NextResponse.json({ error: 'A description is required.' }, { status: 400 })
  if (!Number.isFinite(quantity) || quantity <= 0) return NextResponse.json({ error: 'Quantity must be greater than 0.' }, { status: 400 })
  if (!Number.isFinite(rate) || rate < 0) return NextResponse.json({ error: 'Rate must be 0 or more.' }, { status: 400 })
  if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) return NextResponse.json({ error: 'GST% must be between 0 and 100.' }, { status: 400 })
  if (!reason) return NextResponse.json({ error: 'A reason is required to add a charge to an existing invoice.' }, { status: 400 })

  const { data: invoice } = await supabaseAdmin
    .from('invoices')
    .select('id, invoice_number, entity_key, place_of_supply, customer_gst, subtotal, total_gst, grand_total, is_deleted')
    .eq('id', invoiceId)
    .single()
  if (!invoice || invoice.is_deleted) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })

  // Same place-of-supply resolution InvoiceForm.tsx uses when adding a line
  // client-side: explicit field -> customer GSTIN prefix -> entity's own state.
  const { data: entity } = await supabaseAdmin
    .from('business_profiles')
    .select('state_code, is_gst_registered')
    .eq('key', invoice.entity_key)
    .maybeSingle()
  const entityStateCode = entity?.state_code || ''
  const placeOfSupplyCode = (invoice.place_of_supply?.trim().slice(0, 2)) || (invoice.customer_gst?.trim().slice(0, 2)) || entityStateCode

  const amount = quantity * rate
  const gstResult = entity?.is_gst_registered && gstRate > 0
    ? calculateGST(amount, gstRate, placeOfSupplyCode, entityStateCode)
    : { gstType: null as 'IGST' | 'CGST_SGST' | null, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, totalGst: 0 }

  const { data: newItem, error: insertErr } = await supabaseAdmin
    .from('invoice_items')
    .insert({
      invoice_id: invoiceId,
      item_type: 'custom',
      description,
      hsn_code: hsnCode,
      quantity,
      rate,
      gst_rate: gstRate,
      gst_type: gstResult.gstType,
      cgst_amount: gstResult.cgstAmount,
      sgst_amount: gstResult.sgstAmount,
      igst_amount: gstResult.igstAmount,
      amount: amount + gstResult.totalGst,
    })
    .select('id')
    .single()
  if (insertErr || !newItem) return NextResponse.json({ error: insertErr?.message || 'Failed to add the line item.' }, { status: 500 })

  // Recompute invoice totals from every item, same as the sibling DELETE route.
  const { data: allItems } = await supabaseAdmin
    .from('invoice_items')
    .select('rate, quantity, gst_rate, cgst_amount, sgst_amount, igst_amount, amount')
    .eq('invoice_id', invoiceId)
  // `subtotal` is the GST return's "taxable value" -- a 0%-GST line (e.g. a
  // non-taxable shipping pass-through) is excluded from it even though it's
  // included in the invoice's grand_total, matching how Zoho itself reports
  // taxable_value vs doc_value for a mixed invoice (confirmed against a real
  // Zoho export row: a non-taxable charge inflated doc_value but not
  // taxable_value). Getting this wrong is what caused DBI2026/27-00765's GST
  // reconciliation to flag a false taxable-value mismatch after a shipping
  // charge was added.
  const newSubtotal = (allItems || []).filter((r) => Number(r.gst_rate) > 0).reduce((a, r) => a + Number(r.rate) * Number(r.quantity), 0)
  const newTotalGst = (allItems || []).reduce((a, r) => a + Number(r.cgst_amount || 0) + Number(r.sgst_amount || 0) + Number(r.igst_amount || 0), 0)
  const newGrandTotal = (allItems || []).reduce((a, r) => a + Number(r.amount), 0)

  const { error: invUpdateErr } = await supabaseAdmin
    .from('invoices')
    .update({
      subtotal: newSubtotal,
      total_gst: newTotalGst,
      grand_total: newGrandTotal,
      total_amount: newSubtotal,
      gst_total: newTotalGst,
    })
    .eq('id', invoiceId)
  if (invUpdateErr) return NextResponse.json({ error: `Line item added, but updating invoice totals failed: ${invUpdateErr.message}` }, { status: 500 })

  const fieldCorrectionIds = await logFieldCorrections(
    'invoices',
    invoiceId,
    [
      { field: 'subtotal', oldValue: invoice.subtotal, newValue: newSubtotal },
      { field: 'total_gst', oldValue: invoice.total_gst, newValue: newTotalGst },
      { field: 'grand_total', oldValue: invoice.grand_total, newValue: newGrandTotal },
    ],
    sessionUser.id,
    reason
  )

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'invoices',
    tableName: 'invoice_items',
    recordId: newItem.id,
    recordLabel: `${description} added to invoice ${invoice.invoice_number}`,
    fieldCorrectionIds,
    reason,
  })

  return NextResponse.json({ success: true, item_id: newItem.id, invoice: { subtotal: newSubtotal, total_gst: newTotalGst, grand_total: newGrandTotal } })
}

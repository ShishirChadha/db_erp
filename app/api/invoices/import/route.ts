import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { calculateGST } from '@/lib/gstCalculation'

// ---------- POST: backfill an invoice already issued by Zoho (or another prior ----------
// ---------- system) with its real, already-legal invoice number ----------
// Inserts directly into invoices/invoice_items -- never calls next_document_number,
// so this can never desync or collide with the live atomic counter (invoice_sequences
// only ever advances from that RPC, which this route never touches). See the
// "Existing Zoho Invoices" analysis in docs/decisions.md for why this is safe.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const {
    invoice_number, invoice_date, entity_key,
    customer_id, customer_name, customer_gst, customer_address, customer_phone, customer_email,
    notes, items,
  } = body

  if (!invoice_number?.trim()) return NextResponse.json({ error: 'invoice_number is required.' }, { status: 400 })
  if (!invoice_date) return NextResponse.json({ error: 'invoice_date is required.' }, { status: 400 })
  if (!entity_key) return NextResponse.json({ error: 'entity_key is required.' }, { status: 400 })
  if (!customer_name?.trim()) return NextResponse.json({ error: 'customer_name is required.' }, { status: 400 })
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'At least one line item is required.' }, { status: 400 })
  }

  // Preserving a real Zoho number verbatim means this route must reject a collision
  // with a clear message, not a raw unique-constraint error.
  const { data: existing } = await supabaseAdmin
    .from('invoices')
    .select('id')
    .eq('invoice_number', invoice_number.trim())
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ error: `Invoice number "${invoice_number}" already exists in the system.` }, { status: 409 })
  }

  const { data: entity } = await supabaseAdmin
    .from('business_profiles')
    .select('key, is_gst_registered, state_code')
    .eq('key', entity_key)
    .single()
  if (!entity) return NextResponse.json({ error: 'Unknown entity_key.' }, { status: 400 })

  // Same fallback the live finalize path uses: customer's GSTIN state code (B2B),
  // else the entity's own state (B2C / no GSTIN on file).
  const placeOfSupplyStateCode = (customer_gst || '').trim().slice(0, 2) || entity.state_code || ''

  let subtotal = 0
  let totalGst = 0
  const itemRows: any[] = []

  for (const item of items) {
    if (!item?.description?.trim()) return NextResponse.json({ error: 'Every line item needs a description.' }, { status: 400 })
    const quantity = Number(item.quantity) || 1
    const rate = Number(item.rate) || 0
    const gstRate = entity.is_gst_registered ? Number(item.gst_rate) || 0 : 0
    const lineSubtotal = quantity * rate

    // Non-GST entities (Techtenth/Cash) issue a Bill of Supply -- zero tax, full
    // amount presented as a plain taxable value, same rule the live finalize path
    // already applies.
    const gst = entity.is_gst_registered
      ? calculateGST(lineSubtotal, gstRate, placeOfSupplyStateCode, entity.state_code || '')
      : { gstType: null, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, totalGst: 0 }

    subtotal += lineSubtotal
    totalGst += gst.totalGst

    itemRows.push({
      item_type: item.asset_id ? 'asset' : 'custom',
      ledger_asset_id: item.asset_id || null,
      description: item.description.trim(),
      hsn_code: item.hsn_code || null,
      quantity,
      rate,
      gst_rate: gstRate,
      gst_type: gst.gstType,
      cgst_amount: gst.cgstAmount,
      sgst_amount: gst.sgstAmount,
      igst_amount: gst.igstAmount,
      amount: lineSubtotal + gst.totalGst,
    })
  }

  const { data: invoice, error: invoiceErr } = await supabaseAdmin
    .from('invoices')
    .insert({
      invoice_number: invoice_number.trim(),
      invoice_date,
      entity_key,
      customer_id: customer_id || null,
      customer_name: customer_name.trim(),
      customer_gst: customer_gst || null,
      customer_address: customer_address || null,
      customer_phone: customer_phone || null,
      customer_email: customer_email || null,
      place_of_supply: placeOfSupplyStateCode || null,
      notes: notes || null,
      invoice_type: 'sales',
      subtotal,
      total_gst: totalGst,
      grand_total: subtotal + totalGst,
      total_amount: subtotal + totalGst,
      gst_total: totalGst,
      status: 'sent',
      payment_status: 'paid',
      source: 'imported_zoho',
      imported_by: sessionUser.id,
      imported_at: new Date().toISOString(),
      created_by: sessionUser.id,
    })
    .select('id')
    .single()

  if (invoiceErr) return NextResponse.json({ error: invoiceErr.message }, { status: 500 })

  const { error: itemsErr } = await supabaseAdmin
    .from('invoice_items')
    .insert(itemRows.map((row) => ({ ...row, invoice_id: invoice.id })))

  if (itemsErr) {
    await supabaseAdmin.from('invoices').delete().eq('id', invoice.id)
    return NextResponse.json({ error: itemsErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, id: invoice.id, invoice_number: invoice_number.trim() }, { status: 201 })
}

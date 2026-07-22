import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { mintSalesInvoiceNumber } from '@/lib/sales-entry'

// ---------- POST: owner generates the GST invoice for an already-completed sale ----------
// The sale itself already happened (unit/accessory left stock at POST /api/sales-entry
// time) -- this route is invoice-only bookkeeping. It must NOT touch asset_ledger status,
// quantity_in_stock, or accessory stock again, or the sale's original stock movement
// would get double-counted.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params

  const { data: sale } = await supabaseAdmin
    .from('sales')
    .select('*')
    .eq('id', id)
    .single()

  if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
  if (sale.finalized) return NextResponse.json({ error: 'This sale already has an invoice.' }, { status: 400 })

  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('customer_name, gst_number, address, phone, email')
    .eq('id', sale.customer_id)
    .single()

  const body = await req.json().catch(() => ({}))
  const invoiceDate = body.invoice_date || new Date().toISOString().slice(0, 10)

  let invoiceNumber: string
  try {
    invoiceNumber = await mintSalesInvoiceNumber()
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to generate invoice number: ${err.message}` }, { status: 500 })
  }

  const { data: invoice, error: invErr } = await supabaseAdmin
    .from('invoices')
    .insert({
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      invoice_type: 'sales',
      customer_id: sale.customer_id,
      customer_name: customer?.customer_name || sale.customer_name,
      customer_gst: customer?.gst_number || null,
      customer_address: customer?.address || null,
      customer_phone: customer?.phone || null,
      customer_email: customer?.email || null,
      subtotal: sale.sale_base_price,
      total_gst: sale.sale_gst,
      grand_total: sale.sale_total,
      total_amount: sale.sale_base_price,
      gst_total: sale.sale_gst,
      status: 'approved',
      payment_status: sale.payment_status || 'pending',
      created_by: sessionUser.id,
      approved_by: sessionUser.id,
      approved_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 })

  const nowIso = new Date().toISOString()

  // ---------- Standalone accessory sale ----------
  if (sale.accessory_id) {
    const { data: accessory } = await supabaseAdmin
      .from('accessories')
      .select('accessory_name')
      .eq('id', sale.accessory_id)
      .single()

    const qty = sale.accessory_quantity || 1
    await supabaseAdmin.from('invoice_items').insert({
      invoice_id: invoice.id,
      item_type: 'accessory',
      accessory_id: sale.accessory_id,
      description: accessory?.accessory_name || 'Accessory',
      quantity: qty,
      rate: sale.sale_base_price / qty,
      gst_rate: sale.sale_base_price > 0 ? Math.round((sale.sale_gst / sale.sale_base_price) * 10000) / 100 : 0,
      gst_type: 'CGST_SGST',
      cgst_amount: sale.sale_gst / 2,
      sgst_amount: sale.sale_gst / 2,
      amount: sale.sale_total,
    })

    await supabaseAdmin
      .from('sales')
      .update({ finalized: true, finalized_by: sessionUser.id, finalized_at: nowIso, invoice_id: invoice.id, invoice_number: invoiceNumber })
      .eq('id', id)

    return NextResponse.json({ success: true, invoice_id: invoice.id, invoice_number: invoiceNumber })
  }

  // ---------- Unit sale ----------
  const { data: asset } = await supabaseAdmin
    .from('asset_ledger')
    .select('id, sku_id, asset_number')
    .eq('id', sale.asset_ledger_id)
    .single()

  if (!asset) return NextResponse.json({ error: 'Linked unit not found' }, { status: 404 })

  const { data: sku } = await supabaseAdmin
    .from('sku_master')
    .select('full_sku_code, sku_description, hsn_code')
    .eq('id', asset.sku_id)
    .single()

  const { error: itemErr } = await supabaseAdmin.from('invoice_items').insert({
    invoice_id: invoice.id,
    item_type: 'asset',
    ledger_asset_id: asset.id,
    sku_id: asset.sku_id,
    asset_number: asset.asset_number,
    description: sku?.sku_description || sku?.full_sku_code || 'Unit',
    hsn_code: sku?.hsn_code || null,
    quantity: 1,
    rate: sale.sale_base_price,
    gst_rate: sale.sale_base_price > 0 ? Math.round((sale.sale_gst / sale.sale_base_price) * 10000) / 100 : 0,
    gst_type: 'CGST_SGST',
    cgst_amount: sale.sale_gst / 2,
    sgst_amount: sale.sale_gst / 2,
    amount: sale.sale_total,
  })

  if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 })

  await supabaseAdmin
    .from('sales')
    .update({
      finalized: true,
      finalized_by: sessionUser.id,
      finalized_at: nowIso,
      invoice_id: invoice.id,
      invoice_number: invoiceNumber,
    })
    .eq('id', id)

  return NextResponse.json({ success: true, invoice_id: invoice.id, invoice_number: invoiceNumber })
}

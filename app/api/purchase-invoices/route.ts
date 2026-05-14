import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'

// ---------- GET: list purchase invoices ----------
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const po_id = searchParams.get('po_id')

  let invoiceQuery = supabaseAdmin
    .from('invoices')
    .select('*')
    .eq('invoice_type', 'purchase')
    .order('invoice_date', { ascending: false })

  if (po_id) invoiceQuery = invoiceQuery.eq('po_id', po_id)

  const { data: invoices, error } = await invoiceQuery
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Collect unique PO ids
  const poIds = invoices
    .map((inv: any) => inv.po_id)
    .filter((id: string | null): id is string => id !== null)

  let poMap: Record<string, any> = {}
  if (poIds.length > 0) {
    const { data: pos } = await supabaseAdmin
      .from('purchase_orders')
      .select('id, po_number, vendor_name')
      .in('id', poIds)

    pos?.forEach((po: any) => {
      poMap[po.id] = po
    })
  }

  const result = invoices.map((inv: any) => ({
    ...inv,
    purchase_orders: poMap[inv.po_id] || null,
  }))

  return NextResponse.json(result)
}

// ---------- POST: create a purchase invoice ----------
export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    po_id,
    invoice_number,
    invoice_date,
    total_amount,
    gst_total,
    grand_total,
    payment_status = 'pending',
    notes,
    attachment_urls = [],
  } = body

  // Basic validation
  if (!po_id || !invoice_number || !invoice_date || !total_amount || !gst_total || !grand_total) {
    return NextResponse.json(
      { error: 'Missing required fields: po_id, invoice_number, invoice_date, total_amount, gst_total, grand_total' },
      { status: 400 }
    )
  }

  // Check if an invoice already exists for this PO
const { data: existingInvoice } = await supabaseAdmin
  .from('invoices')
  .select('id')
  .eq('po_id', po_id)
  .eq('invoice_type', 'purchase')
  .single()

if (existingInvoice) {
  return NextResponse.json(
    { error: 'An invoice already exists for this Purchase Order.' },
    { status: 409 }  // Conflict
  )
}

  // Verify the PO exists
  const { data: po } = await supabaseAdmin
    .from('purchase_orders')
    .select('po_status')
    .eq('id', po_id)
    .single()

  if (!po) {
    return NextResponse.json({ error: 'Purchase Order not found' }, { status: 404 })
  }

  // Insert the invoice
  const { data: invoice, error: invErr } = await supabaseAdmin
    .from('invoices')
    .insert({
      po_id,
      invoice_type: 'purchase',
      invoice_number,
      invoice_date,
      total_amount,
      gst_total,
      grand_total,
      payment_status,
      notes,
      attachment_urls,
    })
    .select()
    .single()

  if (invErr) {
    return NextResponse.json({ error: invErr.message }, { status: 500 })
  }

  // Optionally update PO status to 'invoiced' if currently submitted/partially_received/received
  if (['submitted', 'partially_received', 'received'].includes(po.po_status)) {
    await supabaseAdmin
      .from('purchase_orders')
      .update({ po_status: 'invoiced' })
      .eq('id', po_id)
  }

  return NextResponse.json(invoice, { status: 201 })
}
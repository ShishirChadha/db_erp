import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'

// ---------- GET (detail) ----------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Get invoice
  const { data: invoice, error: invErr } = await supabaseAdmin
    .from('invoices')
    .select('*')
    .eq('id', id)
    .single()

  if (invErr || !invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  // Get linked PO (header)
  let po = null
  if (invoice.po_id) {
    const { data: poData } = await supabaseAdmin
      .from('purchase_orders')
      .select('po_number, po_date, vendor_name, purchased_by_type, po_status')
      .eq('id', invoice.po_id)
      .single()
    po = poData || null
  }

  // Get PO items with asset mappings
  let poItems: any[] = []
  if (invoice.po_id) {
    const { data: items } = await supabaseAdmin
      .from('purchase_order_items')
      .select('*')
      .eq('po_id', invoice.po_id)
      .order('line_item_number', { ascending: true })

    if (items) {
      poItems = await Promise.all(
        items.map(async (item: any) => {
          const { data: sku } = await supabaseAdmin
            .from('sku_master')
            .select('full_sku_code, sku_description')
            .eq('id', item.sku_id)
            .single()

          const { data: assets } = await supabaseAdmin
            .from('purchase_order_asset_mapping')
            .select('asset_number, serial_number, status')
            .eq('po_item_id', item.id)

          return {
            ...item,
            sku_code: sku?.full_sku_code || item.base_sku_code,
            sku_desc: sku?.sku_description || '',
            assets: assets || [],
          }
        })
      )
    }
  }

  return NextResponse.json({
    ...invoice,
    purchase_order: po,
    po_items: poItems,
  })
}

// ---------- DELETE (permanent) ----------
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // 1. Get invoice to know its PO
  const { data: invoice } = await supabaseAdmin
    .from('invoices')
    .select('po_id')
    .eq('id', id)
    .single()

  // 2. Delete the invoice
  const { error } = await supabaseAdmin
    .from('invoices')
    .delete()
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 3. If this invoice was linked to a PO, revert PO status to 'received'
  if (invoice?.po_id) {
    await supabaseAdmin
      .from('purchase_orders')
      .update({ po_status: 'received' })
      .eq('id', invoice.po_id)
  }

  return NextResponse.json({ success: true })
}
// app/api/purchase-orders/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { recalcPOTotals, getVendorName } from '@/lib/purchase-utils'

export async function GET(req: NextRequest) {
  // Temporarily skip authentication for testing
  // const user = await getUser(req);
  // if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const vendor_id = searchParams.get('vendor_id')
  const search = searchParams.get('search')

  let query = supabaseAdmin
    .from('purchase_orders')
    .select('*')
    .eq('is_deleted', false)
    .order('po_date', { ascending: false })

  if (status) query = query.eq('po_status', status)
  if (vendor_id) query = query.eq('vendor_id', vendor_id)
  if (search) query = query.ilike('po_number', `%${search}%`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error }, { status: 400 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  // Temporarily skip authentication for testing
  // const user = await getUser(req);
  // if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json()
  const { vendor_id, po_date, purchase_type, purchased_by_type, purchased_by_other,
          expected_delivery_date, delivery_location, remarks, items } = body

  if (!vendor_id || !po_date || !items?.length) {
    return NextResponse.json({ error: 'vendor_id, po_date, and items required' }, { status: 400 })
  }

  // Generate PO number
  const { data: poNumber, error: numErr } = await supabaseAdmin.rpc('generate_po_number')
  if (numErr) throw numErr

  const vendorName = await getVendorName(vendor_id)

  // We'll use a hard‑coded dummy user ID for the `created_by` field
  const dummyUserId = '00000000-0000-0000-0000-000000000000' // can be any valid UUID

  // Create PO header
  const { data: po, error: poErr } = await supabaseAdmin
    .from('purchase_orders')
    .insert({
      po_number: poNumber,
      po_date,
      vendor_id,
      vendor_name: vendorName,
      purchase_type: purchase_type || 'GST',
      purchased_by_type: purchased_by_type || 'Digitalbluez',
      purchased_by_other,
      expected_delivery_date,
      delivery_location,
      remarks,
      po_status: 'draft',
      created_by: null
    })
    .select()
    .single()

  if (poErr) throw poErr

  // Insert line items
  const lineItems = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const { data: sku, error: skuErr } = await supabaseAdmin
      .from('sku_master')
      .select('base_sku_code, variant_number, base_cost')
      .eq('id', item.sku_id)
      .single()
    if (skuErr || !sku) throw new Error(`SKU not found: ${item.sku_id}`)

    const basePrice = item.base_price ?? sku.base_cost
    const gstPct = item.gst_percentage ?? 18
    const unitTotal = basePrice * item.quantity
    const gstAmount = unitTotal * gstPct / 100
    const lineTotal = unitTotal + gstAmount

    lineItems.push({
      po_id: po.id,
      line_item_number: i + 1,
      sku_id: item.sku_id,
      base_sku_code: sku.base_sku_code,
      variant_number: sku.variant_number,
      quantity: item.quantity,
      base_price: basePrice,
      unit_price: basePrice,
      gst_percentage: gstPct,
      gst_amount: gstAmount,
      line_total: lineTotal,
      asset_prefix: '',
      asset_numbers_reserved: [],
      notes: item.notes || ''
    })
  }

  const { error: itemsErr } = await supabaseAdmin.from('purchase_order_items').insert(lineItems)
  if (itemsErr) throw itemsErr

  await recalcPOTotals(po.id)

  return NextResponse.json({ po_id: po.id, po_number: poNumber }, { status: 201 })
}
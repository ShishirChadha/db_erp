import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'

// ---------- GET: list all assets ----------
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const statusFilter = searchParams.get('status')      // optional
  const search = searchParams.get('search')            // optional (asset number or serial)
  const sku_id = searchParams.get('sku_id')            // optional

  let query = supabaseAdmin
    .from('purchase_order_asset_mapping')
    .select(`
      id,
      asset_number,
      serial_number,
      status,
      reserved_at,
      received_at,
      sold_at,
      po_id,
      po_item_id,
      sku_id,
      purchase_order_items!inner (
        quantity,
        base_price,
        unit_price,
        gst_percentage,
        line_total,
        purchase_orders!inner (
          po_number,
          po_date,
          vendor_name,
          purchased_by_type
        ),
        sku_master!inner (
          full_sku_code,
          sku_description
        )
      )
    `)
    .order('asset_number')

  if (statusFilter) {
    query = query.eq('status', statusFilter)
  }
  if (search) {
    query = query.or(`asset_number.ilike.%${search}%,serial_number.ilike.%${search}%`)
  }
  if (sku_id) {
    query = query.eq('sku_id', sku_id)
  }

  const { data: assets, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Flatten the nested joins into a simpler structure
  const result = (assets || []).map((asset: any) => {
    const item = asset.purchase_order_items
    const po = item?.purchase_orders
    const sku = item?.sku_master
    return {
      id: asset.id,
      asset_number: asset.asset_number,
      serial_number: asset.serial_number,
      status: asset.status,
      reserved_at: asset.reserved_at,
      received_at: asset.received_at,
      sold_at: asset.sold_at,
      sku_code: sku?.full_sku_code || '',
      description: sku?.sku_description || '',
      quantity: item?.quantity,
      unit_price: item?.unit_price,
      gst_percentage: item?.gst_percentage,
      line_total: item?.line_total,
      po_number: po?.po_number,
      po_date: po?.po_date,
      vendor_name: po?.vendor_name,
      purchased_by_type: po?.purchased_by_type,
    }
  })

  return NextResponse.json(result)
}

// ---------- PUT: update asset number or serial ----------
export async function PUT(req: NextRequest) {
  const body = await req.json()
  const { id, asset_number, serial_number } = body

  if (!id) {
    return NextResponse.json({ error: 'Asset id is required' }, { status: 400 })
  }

  // Check current asset status
  const { data: asset, error: fetchErr } = await supabaseAdmin
    .from('purchase_order_asset_mapping')
    .select('status')
    .eq('id', id)
    .single()

  if (fetchErr || !asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
  }

  // Only allow editing if asset is NOT sold or invoiced or returned
  if (['sold', 'invoiced', 'returned'].includes(asset.status)) {
    return NextResponse.json(
      { error: `Cannot edit asset in '${asset.status}' status. Only unsold assets can be edited.` },
      { status: 400 }
    )
  }

  // Prepare update object
  const updates: any = {}
  if (asset_number !== undefined) updates.asset_number = asset_number
  if (serial_number !== undefined) updates.serial_number = serial_number

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { error: updateErr } = await supabaseAdmin
    .from('purchase_order_asset_mapping')
    .update(updates)
    .eq('id', id)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
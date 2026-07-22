import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: poId } = await params

  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const user = { id: sessionUser.id }

  const { data: po } = await supabaseAdmin
    .from('purchase_orders')
    .select('purchased_by_type, po_status, vendor_id')
    .eq('id', poId)
    .single()

  if (!po || po.po_status !== 'draft') {
    return NextResponse.json({ error: 'PO not in draft' }, { status: 400 })
  }

  const { data: items } = await supabaseAdmin
    .from('purchase_order_items')
    .select('*')
    .eq('po_id', poId)

  // Guard against null items
  if (!items) {
    return NextResponse.json({ error: 'No line items found' }, { status: 400 })
  }

  for (const item of items) {
    let prefix: string
    switch (po.purchased_by_type) {
      case 'Digitalbluez': prefix = 'DBAS'; break
      case 'Techtenth': prefix = 'TTAS'; break
      case 'Cash': prefix = 'CSAS'; break
      default: prefix = 'OTHR'; break
    }

    const { data: assets, error: rpcErr } = await supabaseAdmin.rpc('reserve_assets', {
      p_prefix: prefix,
      purchased_by_type: po.purchased_by_type,
      qty: item.quantity
    })
    if (rpcErr) throw rpcErr

    await supabaseAdmin
      .from('purchase_order_items')
      .update({ asset_prefix: prefix, asset_numbers_reserved: assets })
      .eq('id', item.id)

    const mappings = assets.map((asset: string) => ({
      po_id: poId,
      po_item_id: item.id,
      sku_id: item.sku_id,
      asset_number: asset,
      status: 'reserved',
      reserved_at: new Date().toISOString(),
      source: 'purchase_order',
      vendor_id: po.vendor_id,
      purchased_by_type: po.purchased_by_type,
      cost_price: item.unit_price,
      gst_percentage: item.gst_percentage
    }))
    await supabaseAdmin.from('asset_ledger').insert(mappings)
  }

  // Update PO status and track who submitted
  await supabaseAdmin
    .from('purchase_orders')
    .update({
      po_status: 'submitted',
      updated_by: user.id
    })
    .eq('id', poId)

  return NextResponse.json({ success: true })
}
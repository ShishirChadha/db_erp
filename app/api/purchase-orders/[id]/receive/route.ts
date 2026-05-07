import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  return error ? null : user
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { items } = body   // { po_item_id, assets: [{ asset_number, serial_number }] }

  const { data: po } = await supabaseAdmin
    .from('purchase_orders')
    .select('po_status, po_number')
    .eq('id', params.id)
    .single()

  if (!po || !['submitted', 'partially_received'].includes(po.po_status)) {
    return NextResponse.json({ error: 'PO cannot be received at this stage' }, { status: 400 })
  }

  let allFullyReceived = true

  for (const recItem of items) {
    const { po_item_id, assets } = recItem
    if (!assets || assets.length === 0) continue

    const { data: poItem } = await supabaseAdmin
      .from('purchase_order_items')
      .select('*')
      .eq('id', po_item_id)
      .single()
    if (!poItem) continue

    const orderedQty = poItem.quantity
    const alreadyReceived = poItem.serial_numbers?.length || 0
    const nowReceiving = assets.length

    if (alreadyReceived + nowReceiving > orderedQty) {
      return NextResponse.json({ error: `Receiving ${nowReceiving} would exceed ordered ${orderedQty}` }, { status: 400 })
    }

    // Update asset mapping: serial + status
    for (const asset of assets) {
      await supabaseAdmin
        .from('purchase_order_asset_mapping')
        .update({
          serial_number: asset.serial_number,
          status: 'received',
          received_at: new Date().toISOString()
        })
        .eq('asset_number', asset.asset_number)
        .eq('po_item_id', po_item_id)
    }

    // Append new serials to item
    const newSerials = [...(poItem.serial_numbers || []), ...assets.map((a: any) => a.serial_number)]
    await supabaseAdmin
      .from('purchase_order_items')
      .update({ serial_numbers: newSerials })
      .eq('id', po_item_id)

    // Update stock
    const { data: sku } = await supabaseAdmin
      .from('sku_master')
      .select('quantity_in_stock')
      .eq('id', poItem.sku_id)
      .single()
    const oldQty = sku?.quantity_in_stock || 0
    const newQty = oldQty + nowReceiving
    await supabaseAdmin
      .from('sku_master')
      .update({ quantity_in_stock: newQty })
      .eq('id', poItem.sku_id)

    // Stock movement
    await supabaseAdmin.from('stock_movements').insert({
      sku_id: poItem.sku_id,
      movement_type: 'receipt',
      quantity_change: nowReceiving,
      quantity_before: oldQty,
      quantity_after: newQty,
      po_id: params.id,
      po_item_id,
      notes: `Goods receipt for PO ${po.po_number}`,
      created_by: user.id
    })

    if (newSerials.length < orderedQty) allFullyReceived = false
  }

  const newStatus = allFullyReceived ? 'received' : 'partially_received'
  await supabaseAdmin.from('purchase_orders').update({ po_status: newStatus }).eq('id', params.id)

  return NextResponse.json({ success: true, new_status: newStatus })
}
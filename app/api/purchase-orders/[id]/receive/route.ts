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

  const body = await req.json()
  const { items } = body

  const { data: po } = await supabaseAdmin
    .from('purchase_orders')
    .select('po_status, po_number')
    .eq('id', poId)
    .single()

  if (!po || !['submitted', 'partially_received'].includes(po.po_status)) {
    return NextResponse.json({ error: 'PO cannot be received at this stage' }, { status: 400 })
  }

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

    // Update asset mapping — a received unit moves straight into the QC queue
    // (qc_pending) rather than sitting at a terminal 'received' status; received_at
    // still records the physical-receipt timestamp.
    for (const asset of assets) {
      await supabaseAdmin
        .from('asset_ledger')
        .update({
          serial_number: asset.serial_number,
          status: 'qc_pending',
          received_at: new Date().toISOString()
        })
        .eq('asset_number', asset.asset_number)
        .eq('po_item_id', po_item_id)
    }

    const newSerials = [...(poItem.serial_numbers || []), ...assets.map((a: any) => a.serial_number)]
    await supabaseAdmin
      .from('purchase_order_items')
      .update({ serial_numbers: newSerials })
      .eq('id', po_item_id)

    // Stock movement — sku_master.quantity_in_stock is updated atomically by the
    // trg_sync_sku_stock trigger (BEFORE INSERT on stock_movements), which also
    // computes quantity_before/quantity_after. No manual read-then-write here.
    await supabaseAdmin.from('stock_movements').insert({
      sku_id: poItem.sku_id,
      movement_type: 'receipt',
      quantity_change: nowReceiving,
      po_id: poId,
      po_item_id,
      notes: `Goods receipt for PO ${po.po_number}`,
      created_by: user.id
    })

  }

  // Determine final PO status from ALL line items belonging to this PO, not just the
  // ones present in this request body — a partial payload (e.g. receiving only 2 of 3
  // SKU lines today) must never mark the PO as fully 'received' while another line
  // item still has outstanding quantity.
  const { data: allItems } = await supabaseAdmin
    .from('purchase_order_items')
    .select('quantity, serial_numbers')
    .eq('po_id', poId)

  const allFullyReceived = (allItems ?? []).every(
    (item) => (item.serial_numbers?.length || 0) >= item.quantity
  )

  const newStatus = allFullyReceived ? 'received' : 'partially_received'
  await supabaseAdmin
    .from('purchase_orders')
    .update({
      po_status: newStatus,
      updated_by: user.id
    })
    .eq('id', poId)

  return NextResponse.json({ success: true, new_status: newStatus })
}
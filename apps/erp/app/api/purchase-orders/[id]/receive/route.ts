import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { findDuplicateSerial } from '@/lib/duplicate-serial'
import { isSerializedCategory } from '@/lib/sku-categories'
import { logAuditEvent } from '@/lib/audit-log'

// Sums 'receipt' stock_movements already booked against a given fungible PO line,
// so partial receipts of an accessory line can't cumulatively exceed the ordered
// quantity. Received progress for fungible lines is derived from the movement ledger
// (the source of truth for quantity), never a stored counter -- mirrors how a
// serialized line derives its received count from its serial_numbers array.
async function receivedQtyForLine(poItemId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('stock_movements')
    .select('quantity_change')
    .eq('po_item_id', poItemId)
    .eq('movement_type', 'receipt')
  return (data || []).reduce((sum, m) => sum + m.quantity_change, 0)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: poId } = await params

  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const user = { id: sessionUser.id }

  const body = await req.json()
  const { items, confirm_duplicate } = body

  // Serial number has no DB-level uniqueness constraint -- check every serial being
  // received against the whole ledger before writing anything, so a batch receipt
  // can't silently duplicate a unit already in the system from another door.
  if (!confirm_duplicate) {
    const duplicates: Array<{ serial_number: string; existing: any }> = []
    for (const recItem of items || []) {
      for (const asset of recItem.assets || []) {
        if (!asset.serial_number) continue
        const dup = await findDuplicateSerial(asset.serial_number)
        if (dup) duplicates.push({ serial_number: asset.serial_number, existing: dup })
      }
    }
    if (duplicates.length > 0) {
      return NextResponse.json({
        error: `${duplicates.length} serial number(s) already exist elsewhere in the system. Review and confirm to proceed.`,
        error_code: 'duplicate_serial',
        duplicates,
      }, { status: 409 })
    }
  }

  const { data: po } = await supabaseAdmin
    .from('purchase_orders')
    .select('po_status, po_number')
    .eq('id', poId)
    .single()

  if (!po || !['submitted', 'partially_received'].includes(po.po_status)) {
    return NextResponse.json({ error: 'PO cannot be received at this stage' }, { status: 400 })
  }

  for (const recItem of items) {
    const { po_item_id, assets, quantity } = recItem

    const { data: poItem } = await supabaseAdmin
      .from('purchase_order_items')
      .select('*, sku:sku_master ( category )')
      .eq('id', po_item_id)
      .single()
    if (!poItem) continue

    const orderedQty = poItem.quantity
    const serialized = isSerializedCategory(poItem.sku?.category)

    if (serialized) {
      // ---- Serialized line: one asset_ledger row per unit, matched by serial ----
      if (!assets || assets.length === 0) continue
      const alreadyReceived = poItem.serial_numbers?.length || 0
      const nowReceiving = assets.length
      if (alreadyReceived + nowReceiving > orderedQty) {
        return NextResponse.json({ error: `Receiving ${nowReceiving} would exceed ordered ${orderedQty}` }, { status: 400 })
      }

      // A received unit moves straight into the QC queue (qc_pending); received_at
      // records the physical-receipt timestamp.
      for (const asset of assets) {
        await supabaseAdmin
          .from('asset_ledger')
          .update({ serial_number: asset.serial_number, status: 'qc_pending', received_at: new Date().toISOString() })
          .eq('asset_number', asset.asset_number)
          .eq('po_item_id', po_item_id)
      }

      const newSerials = [...(poItem.serial_numbers || []), ...assets.map((a: any) => a.serial_number)]
      await supabaseAdmin.from('purchase_order_items').update({ serial_numbers: newSerials }).eq('id', po_item_id)

      await supabaseAdmin.from('stock_movements').insert({
        sku_id: poItem.sku_id, movement_type: 'receipt', quantity_change: nowReceiving,
        po_id: poId, po_item_id, notes: `Goods receipt for PO ${po.po_number}`, created_by: user.id,
      })
    } else {
      // ---- Fungible line: no per-unit rows, just a quantity-based stock movement ----
      const nowReceiving = Number(quantity) || 0
      if (nowReceiving <= 0) continue
      const alreadyReceived = await receivedQtyForLine(po_item_id)
      if (alreadyReceived + nowReceiving > orderedQty) {
        return NextResponse.json({ error: `Receiving ${nowReceiving} would exceed ordered ${orderedQty}` }, { status: 400 })
      }

      await supabaseAdmin.from('stock_movements').insert({
        sku_id: poItem.sku_id, movement_type: 'receipt', quantity_change: nowReceiving,
        po_id: poId, po_item_id, notes: `Goods receipt for PO ${po.po_number}`, created_by: user.id,
      })

      // Record the now-known purchase cost on the SKU (accessories have no per-unit
      // asset_ledger.cost_price to carry it) -- same as the deferred-attach flow.
      if (poItem.unit_price != null) {
        await supabaseAdmin.from('sku_master').update({ base_cost: poItem.unit_price }).eq('id', poItem.sku_id)
      }
    }
  }

  // Determine final PO status from ALL line items belonging to this PO, not just the
  // ones present in this request body — a partial payload (e.g. receiving only 2 of 3
  // SKU lines today) must never mark the PO as fully 'received' while another line
  // item still has outstanding quantity. Serialized lines count received units via
  // their serial_numbers array; fungible lines via their summed receipt movements.
  const { data: allItems } = await supabaseAdmin
    .from('purchase_order_items')
    .select('id, quantity, serial_numbers, sku:sku_master ( category )')
    .eq('po_id', poId)

  const receivedChecks = await Promise.all(
    (allItems ?? []).map(async (item: any) => {
      const received = isSerializedCategory(item.sku?.category)
        ? (item.serial_numbers?.length || 0)
        : await receivedQtyForLine(item.id)
      return received >= item.quantity
    })
  )
  const allFullyReceived = receivedChecks.every(Boolean)

  const newStatus = allFullyReceived ? 'received' : 'partially_received'
  await supabaseAdmin
    .from('purchase_orders')
    .update({
      po_status: newStatus,
      updated_by: user.id
    })
    .eq('id', poId)

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'status_change',
    module: 'purchase_orders',
    tableName: 'purchase_orders',
    recordId: poId,
    recordLabel: po.po_number,
    metadata: { from: po.po_status, to: newStatus },
  })

  return NextResponse.json({ success: true, new_status: newStatus })
}
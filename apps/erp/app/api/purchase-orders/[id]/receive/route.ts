import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { findDuplicateSerial, DuplicateSerialMatch } from '@/lib/duplicate-serial'
import { isSerializedCategory } from '@/lib/sku-categories'
import { logAuditEvent } from '@/lib/audit-log'

// Sums 'receipt' stock_movements already booked against a given fungible PO line,
// so partial receipts of an accessory line can't cumulatively exceed the ordered
// quantity. Received progress for fungible lines is derived from the movement ledger
// (the source of truth for quantity), never a stored counter -- mirrors how a
// serialized line derives its received count from its serial_numbers array.
export async function receivedQtyForLine(poItemId: string): Promise<number> {
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
  const { items } = body

  // sku_id per line is needed up front to judge whether a colliding serial is a real
  // duplicate or the same physical unit catching up on paperwork (see below).
  const poItemIds = [...new Set((items || []).map((i: any) => i.po_item_id))]
  const { data: poItemSkuRows } = await supabaseAdmin
    .from('purchase_order_items')
    .select('id, sku_id')
    .in('id', poItemIds)
  const skuIdByPoItem = new Map((poItemSkuRows || []).map((r) => [r.id, r.sku_id]))

  // Serial number has no DB-level uniqueness constraint -- check every serial being
  // received against the whole ledger before writing anything, so a batch receipt
  // can't duplicate a unit already in the system from another door. Hard block, no
  // confirm-and-proceed override -- same reasoning as stock-intake's own duplicate
  // check (a real live duplicate, serial PG02SA4Q, got through via the old
  // click-past-the-warning path).
  //
  // One carve-out: a match that is an employee-intake row, not yet attached to any
  // PO, for this exact SKU isn't a duplicate at all -- it's the same physical unit
  // the owner is now doing paperwork for (employee entered it into Live Stock before
  // the PO existed). That case gets promoted onto this PO further down instead of
  // blocked. Any other match (different SKU, already attached elsewhere, or a real
  // second entry) still hard-blocks exactly as before.
  const duplicates: Array<{ serial_number: string; existing: any }> = []
  const promotions = new Map<string, DuplicateSerialMatch>()
  for (const recItem of items || []) {
    const lineSkuId = skuIdByPoItem.get(recItem.po_item_id)
    for (const asset of recItem.assets || []) {
      if (!asset.serial_number) continue
      const dup = await findDuplicateSerial(asset.serial_number)
      if (!dup) continue
      const promotable = dup.source === 'employee_intake' && dup.po_id === null && dup.sku_id === lineSkuId
      if (promotable) {
        promotions.set(asset.serial_number.trim().toLowerCase(), dup)
      } else {
        duplicates.push({ serial_number: asset.serial_number, existing: dup })
      }
    }
  }
  if (duplicates.length > 0) {
    return NextResponse.json({
      error: `${duplicates.length} serial number(s) already exist elsewhere in the system -- this cannot be received as-is. Check Stock/QC for the existing entry first, or ask the owner to correct it there.`,
      error_code: 'duplicate_serial',
      duplicates,
    }, { status: 409 })
  }

  const { data: po } = await supabaseAdmin
    .from('purchase_orders')
    .select('po_status, po_number, vendor_id, purchased_by_type')
    .eq('id', poId)
    .single()

  if (!po || !['submitted', 'partially_received'].includes(po.po_status)) {
    return NextResponse.json({ error: 'PO cannot be received at this stage' }, { status: 400 })
  }

  let promotedCount = 0

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
      // records the physical-receipt timestamp. Exception: a promoted employee-intake
      // unit keeps its existing status untouched (it may already be QC'd or even
      // sold) -- only its paperwork/PO linkage changes, same rule as /from-intake.
      let lineNewlyArrived = 0
      for (const asset of assets) {
        const promo = promotions.get(String(asset.serial_number).trim().toLowerCase())
        if (promo) {
          // Discard the placeholder row `submit` reserved for this asset_number FIRST --
          // asset_number is unique, so the promoted intake row can't take it over while
          // the placeholder still holds it. The promoted row carries that identity
          // instead, so keeping both would leave a duplicate ledger entry for one
          // physical unit anyway.
          await supabaseAdmin
            .from('asset_ledger')
            .delete()
            .eq('asset_number', asset.asset_number)
            .eq('po_item_id', po_item_id)
            .eq('source', 'purchase_order')
            .eq('status', 'reserved')
            .is('serial_number', null)

          await supabaseAdmin
            .from('asset_ledger')
            .update({
              asset_number: asset.asset_number,
              po_id: poId,
              po_item_id,
              cost_price: poItem.unit_price,
              vendor_id: po.vendor_id,
              gst_percentage: poItem.gst_percentage,
              purchased_by_type: po.purchased_by_type,
              reserved_at: new Date().toISOString(),
            })
            .eq('id', promo.id)

          promotedCount++
        } else {
          await supabaseAdmin
            .from('asset_ledger')
            .update({ serial_number: asset.serial_number, status: 'qc_pending', received_at: new Date().toISOString() })
            .eq('asset_number', asset.asset_number)
            .eq('po_item_id', po_item_id)
          lineNewlyArrived++
        }
      }

      const newSerials = [...(poItem.serial_numbers || []), ...assets.map((a: any) => a.serial_number)]
      await supabaseAdmin.from('purchase_order_items').update({ serial_numbers: newSerials }).eq('id', po_item_id)

      // A promoted unit was already counted into quantity_in_stock at intake time --
      // only genuinely newly-arrived units get a fresh receipt movement.
      if (lineNewlyArrived > 0) {
        await supabaseAdmin.from('stock_movements').insert({
          sku_id: poItem.sku_id, movement_type: 'receipt', quantity_change: lineNewlyArrived,
          po_id: poId, po_item_id, notes: `Goods receipt for PO ${po.po_number}`, created_by: user.id,
        })
      }
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

  return NextResponse.json({ success: true, new_status: newStatus, promoted_count: promotedCount })
}
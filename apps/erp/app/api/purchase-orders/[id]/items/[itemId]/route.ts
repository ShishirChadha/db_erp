import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { isSerializedCategory } from '@/lib/sku-categories'
import { recalcPOTotals } from '@/lib/purchase-utils'
import { logFieldCorrections } from '@/lib/field-corrections'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- PATCH: owner corrects a mistaken quantity/price/GST% on a line item ----------
// Unlike the draft-only PUT on /api/purchase-orders/[id], this works at any PO status
// past draft (submitted/received/invoiced) -- draft has no reservations/receipts yet
// and is still edited via the existing full-replace PUT. A price/GST correction is
// propagated onto every asset_ledger row already tied to this line (paperwork only,
// never touches status -- same rule /from-intake and the receive-promotion path
// already follow) and, for a fungible line, onto sku_master.base_cost. A quantity
// correction is floored at what's already been received/serial-tagged and, for a
// serialized line, reserves more asset numbers (same RPC /submit uses) or releases
// still-unreceived reserved ones -- it never touches a unit that's already physically
// in hand. Mirrors apps/erp/app/api/sales/[id]/route.ts's already-invoiced guard
// exactly: correcting is allowed, but requires confirm_despite_invoice if a Purchase
// Invoice already exists for this PO (that invoice is a frozen snapshot and is never
// retroactively updated here).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id: poId, itemId } = await params
  const body = await req.json()
  const { quantity, base_price, gst_percentage, reason, confirm_despite_invoice } = body

  const { data: po } = await supabaseAdmin
    .from('purchase_orders')
    .select('po_status, po_number, vendor_id, purchased_by_type')
    .eq('id', poId)
    .single()
  if (!po) return NextResponse.json({ error: 'Purchase Order not found' }, { status: 404 })
  if (po.po_status === 'draft') {
    return NextResponse.json({ error: 'A draft PO\'s line items are edited via the New PO wizard, not this endpoint.' }, { status: 400 })
  }
  if (po.po_status === 'cancelled') {
    return NextResponse.json({ error: 'A cancelled PO cannot be edited.' }, { status: 400 })
  }

  const { data: item } = await supabaseAdmin
    .from('purchase_order_items')
    .select('*, sku:sku_master ( category )')
    .eq('id', itemId)
    .eq('po_id', poId)
    .single()
  if (!item) return NextResponse.json({ error: 'Line item not found' }, { status: 404 })

  if (quantity === undefined && base_price === undefined && gst_percentage === undefined) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  // An already-generated Purchase Invoice is a frozen snapshot (see
  // /api/purchase-invoices) -- it is never retroactively recomputed, so correcting
  // the PO after invoicing needs an explicit confirm, same as the sales-side flow.
  const { data: existingInvoices } = await supabaseAdmin
    .from('invoices')
    .select('id, invoice_number')
    .eq('po_id', poId)
    .order('created_at', { ascending: false })
    .limit(1)
  const invoice = existingInvoices?.[0]
  if (invoice && !confirm_despite_invoice) {
    return NextResponse.json({
      error: `This PO is already invoiced (${invoice.invoice_number}) -- correcting it will NOT update that invoice, which will then disagree with the live record. Confirm to proceed anyway.`,
      error_code: 'already_invoiced',
    }, { status: 409 })
  }

  const serialized = isSerializedCategory((item as any).sku?.category)
  const newQuantity = quantity !== undefined ? Number(quantity) : item.quantity
  const newBasePrice = base_price !== undefined ? Number(base_price) : item.base_price
  const newGstPct = gst_percentage !== undefined ? Number(gst_percentage) : item.gst_percentage

  if (newQuantity <= 0) return NextResponse.json({ error: 'Quantity must be greater than zero.' }, { status: 400 })

  // ---- Quantity change: branch by category, floored at what's already committed ----
  if (newQuantity !== item.quantity) {
    if (serialized) {
      const { data: rows } = await supabaseAdmin
        .from('asset_ledger')
        .select('id, asset_number, serial_number, status')
        .eq('po_item_id', itemId)
      const currentReserved = rows?.length || 0
      const alreadyReceived = (rows || []).filter((r) => r.serial_number).length

      if (newQuantity < alreadyReceived) {
        return NextResponse.json({
          error: `Cannot reduce quantity below ${alreadyReceived} -- that many units on this line already have a serial number recorded.`,
        }, { status: 400 })
      }

      if (newQuantity > currentReserved) {
        const toAdd = newQuantity - currentReserved
        const prefix = item.asset_prefix || 'OTHR'
        const { data: reserved, error: rpcErr } = await supabaseAdmin.rpc('reserve_assets', {
          p_prefix: prefix,
          purchased_by_type: po.purchased_by_type,
          qty: toAdd,
        })
        if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 })

        const mappings = reserved.map((asset: string) => ({
          po_id: poId,
          po_item_id: itemId,
          sku_id: item.sku_id,
          asset_number: asset,
          status: 'reserved',
          reserved_at: new Date().toISOString(),
          source: 'purchase_order',
          vendor_id: po.vendor_id,
          purchased_by_type: po.purchased_by_type,
          cost_price: newBasePrice,
          gst_percentage: newGstPct,
        }))
        await supabaseAdmin.from('asset_ledger').insert(mappings)
        await supabaseAdmin
          .from('purchase_order_items')
          .update({ asset_numbers_reserved: [...(item.asset_numbers_reserved || []), ...reserved] })
          .eq('id', itemId)
      } else {
        const toRemove = currentReserved - newQuantity
        const removable = (rows || []).filter((r) => r.status === 'reserved' && !r.serial_number).slice(0, toRemove)
        if (removable.length < toRemove) {
          return NextResponse.json({
            error: 'Not enough still-unreceived reserved units to remove -- some units on this line may already be received.',
          }, { status: 400 })
        }
        await supabaseAdmin.from('asset_ledger').delete().in('id', removable.map((r) => r.id))
        const removedNumbers = new Set(removable.map((r) => r.asset_number))
        await supabaseAdmin
          .from('purchase_order_items')
          .update({ asset_numbers_reserved: (item.asset_numbers_reserved || []).filter((a: string) => !removedNumbers.has(a)) })
          .eq('id', itemId)
      }
    } else {
      // A fungible line's `quantity` only tracks real stock once it equals what's
      // actually been receipted -- below that there's still unreceived headroom and
      // changing `quantity` is pure paperwork (matches the "ordered more / cancelled
      // the rest" case, no stock_movements touch, same as before). Once there's no
      // headroom left (the common case for a backlog-attach line, e.g.
      // /attach-accessory-stock, which starts at 100% received), ANY quantity edit
      // necessarily means "correct the actual counted amount" -- so it must write a
      // compensating 'adjustment' movement to keep sku_master.quantity_in_stock
      // truthful, the same mechanism the Accessories page's own "Correct Quantity"
      // control already uses. Counts both 'receipt' and this endpoint's own prior
      // 'adjustment' corrections linked to this line -- receivedQtyForLine alone
      // (receipt-only) would forget an earlier correction on the very next edit.
      const { data: linkedMovements } = await supabaseAdmin
        .from('stock_movements')
        .select('quantity_change')
        .eq('po_item_id', itemId)
        .in('movement_type', ['receipt', 'adjustment'])
      const alreadyReceived = (linkedMovements || []).reduce((sum, m) => sum + m.quantity_change, 0)
      const fullyReceived = alreadyReceived === item.quantity

      if (newQuantity < alreadyReceived) {
        const shortfall = alreadyReceived - newQuantity
        const { data: skuStock } = await supabaseAdmin
          .from('sku_master')
          .select('quantity_in_stock')
          .eq('id', item.sku_id)
          .single()
        const available = skuStock?.quantity_in_stock ?? 0
        if (available < shortfall) {
          return NextResponse.json({
            error: `Cannot reduce this line below ${alreadyReceived - available} -- only ${available} unit(s) of this SKU remain in stock (the rest has already sold), so reducing further would understate what's actually been sold.`,
          }, { status: 400 })
        }
        await supabaseAdmin.from('stock_movements').insert({
          sku_id: item.sku_id, movement_type: 'adjustment', quantity_change: -shortfall,
          po_id: poId, po_item_id: itemId, notes: `Quantity correction on PO ${po.po_number}`, created_by: sessionUser.id,
        })
      } else if (newQuantity > alreadyReceived && fullyReceived) {
        const extra = newQuantity - alreadyReceived
        await supabaseAdmin.from('stock_movements').insert({
          sku_id: item.sku_id, movement_type: 'adjustment', quantity_change: extra,
          po_id: poId, po_item_id: itemId, notes: `Quantity correction on PO ${po.po_number}`, created_by: sessionUser.id,
        })
      }
      // else: still unreceived headroom (newQuantity >= alreadyReceived, not fully
      // received) -- ordered-amount edit only, no stock impact, unchanged from before.
    }
  }

  // ---- Recompute line totals from the (possibly also-corrected) price/GST%/qty ----
  const unitTotal = newBasePrice * newQuantity
  const gstAmount = unitTotal * newGstPct / 100
  const lineTotal = unitTotal + gstAmount

  await supabaseAdmin
    .from('purchase_order_items')
    .update({ quantity: newQuantity, base_price: newBasePrice, unit_price: newBasePrice, gst_percentage: newGstPct, gst_amount: gstAmount, line_total: lineTotal })
    .eq('id', itemId)

  const fieldCorrectionIds = await logFieldCorrections(
    'purchase_order_items',
    itemId,
    [
      { field: 'quantity', oldValue: item.quantity, newValue: newQuantity },
      { field: 'base_price', oldValue: item.base_price, newValue: newBasePrice },
      { field: 'gst_percentage', oldValue: item.gst_percentage, newValue: newGstPct },
    ],
    sessionUser.id,
    reason || null
  )

  // Propagate a price/GST correction onto every asset_ledger row already tied to this
  // line -- any status, never touches status itself -- and onto sku_master.base_cost
  // for a fungible line (same field the receive route itself writes unconditionally).
  if (newBasePrice !== item.base_price || newGstPct !== item.gst_percentage) {
    await supabaseAdmin
      .from('asset_ledger')
      .update({ cost_price: newBasePrice, gst_percentage: newGstPct })
      .eq('po_item_id', itemId)
    if (!serialized) {
      await supabaseAdmin.from('sku_master').update({ base_cost: newBasePrice }).eq('id', item.sku_id)
    }
  }

  await recalcPOTotals(poId)

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'purchase_orders',
    tableName: 'purchase_order_items',
    recordId: itemId,
    recordLabel: po.po_number,
    fieldCorrectionIds,
    reason: reason || null,
  })

  return NextResponse.json({ success: true })
}

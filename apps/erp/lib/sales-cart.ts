import { supabaseAdmin } from './supabase/service'
import { insertAccessoryMovement } from './accessory-movements'
import { SELLABLE_STATUSES } from './sales-entry'

// One line in a multi-item Sell-form checkout: either a unit (with optional bundled
// accessories folded into its own price/row, unchanged from the single-item flow) or a
// standalone accessory. See app/api/sales-entry/route.ts for how these are assembled
// into a cart and app/dashboard/entry/sell/page.tsx for the UI that builds them.
export type CartItemInput = {
  asset_ledger_id?: string
  bundled_accessories?: Array<{ accessory_id: string; quantity: number; unit_price?: number }>
  accessory_id?: string
  accessory_quantity?: number
  sale_base_price: number
}

export type BaseSaleFields = {
  sale_date: string
  sale_month: string
  sale_year: number
  customer_id: string
  customer_name: string | null
  sale_type: string
  entered_by: string
  sold_by: string | null
  payment_account: string | null
  notes: string | null
  finalized: false
}

export type ProcessedSaleRow = {
  id: string
  asset_ledger_id: string | null
  accessory_id: string | null
  accessory_quantity: number | null
  bundled_accessories: Array<{ accessory_id: string; quantity: number }> | null
  priorAssetStatus?: string
}

export type ProcessItemResult =
  | { ok: true; saleRow: ProcessedSaleRow }
  | { ok: false; status: number; message: string }

// One payment method's contribution to a cart checkout -- e.g. ₹50,000 into
// "Digitalbluez" + ₹50,000 "Cash" for one laptop. payment_account here is purely a
// receipt/reconciliation detail (which of the business's accounts the money landed in)
// and is independent of BaseSaleFields.payment_account, which stays the single
// "invoicing entity" for GST/invoice-numbering purposes (see docs/decisions.md --
// a serialized unit can only ever belong to one sales row, so it can't be
// half-invoiced across entities, even though its payment legitimately can be split).
export type PaymentLeg = { amount: number; payment_account: string; note?: string }

// Allocates every leg's amount across every cart item's sale_total, processing legs IN
// ORDER, each leg split proportionally across items' REMAINING (not yet allocated by an
// earlier leg) capacity -- not their full total. This guarantees (a) one leg's
// allocations across all items sum EXACTLY to that leg's own amount (this is real money
// that must reconcile against actual bank/cash amounts) and (b) no single item is ever
// allocated more than its own sale_total, which independently re-running a naive
// per-item proportional split once per leg (against each item's full total every time)
// does NOT guarantee -- two legs can jointly over-allocate one item past its own total
// even though the whole-cart sum is exact. Reduces byte-for-byte to a simple
// proportional-by-total split when legs.length === 1 (remaining == full item total on
// the only leg). Integer-paise arithmetic; a leg's own floor-division remainder cascades
// backward through items with remaining capacity.
export function allocatePaymentLegs(
  legs: PaymentLeg[],
  itemTotalsRupees: number[]
): Array<Array<{ legIndex: number; amount: number }>> {
  const toPaise = (r: number) => Math.round(r * 100)
  const n = itemTotalsRupees.length
  const remaining = itemTotalsRupees.map(toPaise)
  const perItem: Array<Array<{ legIndex: number; amount: number }>> = itemTotalsRupees.map(() => [])

  legs.forEach((leg, legIndex) => {
    const totalRemaining = remaining.reduce((sum, r) => sum + r, 0)
    if (totalRemaining <= 0) return
    const legPaise = Math.min(toPaise(leg.amount), totalRemaining) // defensive clamp
    if (legPaise <= 0) return

    const shares = remaining.map((r) => Math.floor((legPaise * r) / totalRemaining))
    let remainder = legPaise - shares.reduce((sum, s) => sum + s, 0)

    // Cascade the remainder backward through items with capacity left -- terminates with
    // remainder === 0 because legPaise <= totalRemaining and floor division never
    // over-allocates.
    for (let i = n - 1; i >= 0 && remainder > 0; i--) {
      const capacityLeft = remaining[i] - shares[i]
      const add = Math.min(remainder, capacityLeft)
      shares[i] += add
      remainder -= add
    }

    for (let i = 0; i < n; i++) {
      if (shares[i] > 0) {
        perItem[i].push({ legIndex, amount: shares[i] / 100 })
        remaining[i] -= shares[i]
      }
    }
  })

  return perItem
}

// Upfront, read-only pass over every line in the cart before anything is written --
// catches the common case (stale search result, archived SKU, someone typed a bigger
// quantity than is in stock) as one clean error response instead of a partial commit
// needing rollback. Aggregates demand for the same accessory SKU across multiple lines
// (a standalone line + a bundled-on-a-unit line, or two units bundling the same mouse)
// so two lines can't each pass an independent check against the same stale stock read
// and jointly oversell -- something the single-item flow never had to worry about.
export async function validateCartItems(
  items: CartItemInput[]
): Promise<{ ok: true } | { ok: false; itemErrors: Array<{ index: number; error: string }> }> {
  const itemErrors: Array<{ index: number; error: string }> = []

  const unitLines = items.map((item, index) => ({ item, index })).filter(({ item }) => !!item.asset_ledger_id)
  if (unitLines.length > 0) {
    const assetIds = unitLines.map(({ item }) => item.asset_ledger_id!)
    const { data: assets } = await supabaseAdmin.from('asset_ledger').select('id, status').in('id', assetIds)
    const assetById = new Map((assets || []).map((a) => [a.id, a]))
    for (const { item, index } of unitLines) {
      const asset = assetById.get(item.asset_ledger_id!)
      if (!asset) { itemErrors.push({ index, error: 'Unit not found.' }); continue }
      if (!SELLABLE_STATUSES.includes(asset.status)) {
        itemErrors.push({ index, error: `This unit is '${asset.status}' and cannot be sold right now.` })
      }
    }
  }

  type Demand = { skuId: string; qty: number; indexes: number[] }
  const demandBySku = new Map<string, Demand>()
  const addDemand = (skuId: string | undefined, qty: number | undefined, index: number) => {
    if (!skuId || !qty) return
    const existing = demandBySku.get(skuId)
    if (existing) { existing.qty += qty; existing.indexes.push(index) }
    else demandBySku.set(skuId, { skuId, qty, indexes: [index] })
  }
  items.forEach((item, index) => {
    if (!item.asset_ledger_id) addDemand(item.accessory_id, item.accessory_quantity || 1, index)
    for (const b of item.bundled_accessories || []) addDemand(b.accessory_id, b.quantity, index)
  })

  if (demandBySku.size > 0) {
    const { data: skus } = await supabaseAdmin
      .from('sku_master')
      .select('id, full_sku_code, quantity_in_stock, status')
      .in('id', [...demandBySku.keys()])
    const skuById = new Map((skus || []).map((s) => [s.id, s]))
    for (const demand of demandBySku.values()) {
      const sku = skuById.get(demand.skuId)
      if (!sku) {
        demand.indexes.forEach((index) => itemErrors.push({ index, error: 'An accessory in this cart could not be found.' }))
        continue
      }
      if (sku.status !== 'active') {
        demand.indexes.forEach((index) => itemErrors.push({ index, error: `${sku.full_sku_code} is archived and cannot be sold.` }))
        continue
      }
      if (sku.quantity_in_stock < demand.qty) {
        const message = demand.indexes.length > 1
          ? `Only ${sku.quantity_in_stock} of ${sku.full_sku_code} in stock, but this cart requests ${demand.qty} combined across multiple lines.`
          : `Only ${sku.quantity_in_stock} of ${sku.full_sku_code} in stock.`
        demand.indexes.forEach((index) => itemErrors.push({ index, error: message }))
      }
    }
  }

  if (itemErrors.length > 0) return { ok: false, itemErrors }
  return { ok: true }
}

// Commits one cart line: standalone accessory sale, or unit sale (optionally with free/
// priced bundled accessories folded into its own row). This is the same logic the
// single-item /api/sales-entry POST always ran, just extracted so a cart can call it
// once per line and roll back earlier lines (via lib/sales-entry.ts's
// reverseSaleInventoryEffects) if a later line in the same request fails.
export async function processSingleSaleItem(
  item: CartItemInput,
  base: BaseSaleFields,
  gstPercent: number,
  sessionUserId: string
): Promise<ProcessItemResult> {
  const gstAmount = Math.round(item.sale_base_price * gstPercent) / 100
  const saleTotal = item.sale_base_price + gstAmount
  // amount_paid/payment_status are deliberately absent here -- they stay at their
  // NOT NULL DEFAULT (0/'pending') until the caller's Phase C inserts this item's
  // allocated sale_payments rows, at which point trg_sync_sale_payment_totals derives
  // both from the ledger. Setting them directly here is exactly the bug this design
  // fixes: the trigger recomputes amount_paid as sum(sale_payments) with zero awareness
  // of anything set directly on this row, so a value written here would be silently
  // wiped out the moment anyone adds a later installment via the existing "Add Payment"
  // ledger route.
  const saleRecord = {
    ...base,
    sale_base_price: item.sale_base_price,
    sale_gst: gstAmount,
    sale_total: saleTotal,
  }

  // ---------- Standalone accessory line ----------
  if (!item.asset_ledger_id) {
    const qty = item.accessory_quantity || 1
    const { data: accessorySku } = await supabaseAdmin
      .from('sku_master')
      .select('id, quantity_in_stock, status')
      .eq('id', item.accessory_id)
      .single()

    if (!accessorySku) return { ok: false, status: 404, message: 'Accessory not found.' }
    if (accessorySku.status !== 'active') {
      return { ok: false, status: 400, message: 'This item is archived and cannot be sold.' }
    }
    if (accessorySku.quantity_in_stock < qty) {
      return { ok: false, status: 400, message: `Only ${accessorySku.quantity_in_stock} in stock.` }
    }

    const { data: sale, error: saleErr } = await supabaseAdmin
      .from('sales')
      .insert({ ...saleRecord, accessory_id: item.accessory_id, accessory_quantity: qty })
      .select('id')
      .single()
    if (saleErr) return { ok: false, status: 500, message: saleErr.message }

    const { error: moveErr } = await insertAccessoryMovement({
      skuId: accessorySku.id,
      movementType: 'sale',
      quantityChange: -qty,
      notes: 'Standalone accessory sale',
      createdBy: sessionUserId,
    })
    if (moveErr) {
      await supabaseAdmin.from('sales').delete().eq('id', sale.id)
      return { ok: false, status: 400, message: moveErr.message }
    }

    return {
      ok: true,
      saleRow: {
        id: sale.id,
        asset_ledger_id: null,
        accessory_id: item.accessory_id!,
        accessory_quantity: qty,
        bundled_accessories: null,
      },
    }
  }

  // ---------- Unit line ----------
  const { data: asset } = await supabaseAdmin
    .from('asset_ledger')
    .select('id, status, sku_id, asset_number, serial_number')
    .eq('id', item.asset_ledger_id)
    .single()

  if (!asset) return { ok: false, status: 404, message: 'Unit not found.' }
  if (!SELLABLE_STATUSES.includes(asset.status)) {
    return { ok: false, status: 400, message: `This unit is '${asset.status}' and cannot be sold right now.` }
  }

  const bundledToCheck = item.bundled_accessories || []
  if (bundledToCheck.length > 0) {
    const bundledIds = bundledToCheck.map((b) => b.accessory_id).filter(Boolean)
    const { data: bundledSkus } = await supabaseAdmin
      .from('sku_master')
      .select('id, full_sku_code, quantity_in_stock, status')
      .in('id', bundledIds)
    const bundledSkuById = new Map((bundledSkus || []).map((s) => [s.id, s]))
    for (const b of bundledToCheck) {
      if (!b?.accessory_id || !b?.quantity) continue
      const sku = bundledSkuById.get(b.accessory_id)
      if (!sku) return { ok: false, status: 404, message: 'A bundled accessory could not be found.' }
      if (sku.status !== 'active') {
        return { ok: false, status: 400, message: `${sku.full_sku_code} is archived and cannot be sold.` }
      }
      if (sku.quantity_in_stock < b.quantity) {
        return { ok: false, status: 400, message: `Only ${sku.quantity_in_stock} of ${sku.full_sku_code} in stock.` }
      }
    }
  }

  // Atomic lock straight to 'sold' -- if this affects 0 rows, someone else already sold
  // it between our validation pass and this commit, so this line fails and the cart
  // rolls back any earlier lines already committed in this same request.
  const { data: sold, error: soldErr } = await supabaseAdmin
    .from('asset_ledger')
    .update({ status: 'sold', sold_at: new Date(`${base.sale_date}T12:00:00.000Z`).toISOString() })
    .eq('id', item.asset_ledger_id)
    .in('status', SELLABLE_STATUSES)
    .select('id')
    .maybeSingle()

  if (soldErr) return { ok: false, status: 500, message: soldErr.message }
  if (!sold) return { ok: false, status: 409, message: 'This unit was just sold by someone else. Please remove it and pick another.' }

  const { data: sale, error: saleErr } = await supabaseAdmin
    .from('sales')
    .insert({
      ...saleRecord,
      asset_ledger_id: item.asset_ledger_id,
      asset_number: asset.asset_number,
      serial_number: asset.serial_number,
      bundled_accessories: item.bundled_accessories || null,
    })
    .select('id')
    .single()

  if (saleErr) {
    // Roll back the sale so the unit isn't stuck 'sold' with no sales row behind it.
    await supabaseAdmin.from('asset_ledger').update({ status: asset.status, sold_at: null }).eq('id', item.asset_ledger_id)
    return { ok: false, status: 500, message: saleErr.message }
  }

  // sku_master.quantity_in_stock is decremented atomically by the existing
  // trg_sync_sku_stock trigger on this insert -- no manual read-then-write.
  await supabaseAdmin.from('stock_movements').insert({
    sku_id: asset.sku_id,
    movement_type: 'sale',
    quantity_change: -1,
    notes: `Sold to customer -- invoice pending`,
    created_by: sessionUserId,
  })

  const bundled = item.bundled_accessories || []
  for (const b of bundled) {
    if (!b?.accessory_id || !b?.quantity) continue
    await insertAccessoryMovement({
      skuId: b.accessory_id,
      movementType: 'sale',
      quantityChange: -b.quantity,
      notes: `Bundled with unit sale ${asset.asset_number}`,
      createdBy: sessionUserId,
    })
  }

  return {
    ok: true,
    saleRow: {
      id: sale.id,
      asset_ledger_id: item.asset_ledger_id!,
      accessory_id: null,
      accessory_quantity: null,
      bundled_accessories: item.bundled_accessories || null,
      priorAssetStatus: asset.status,
    },
  }
}

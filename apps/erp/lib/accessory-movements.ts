import { supabaseAdmin } from './supabase/service'

// Accessories are sku_master rows like everything else (see docs/decisions.md,
// 2026-07-23) -- this just wraps the same stock_movements insert every other
// category already uses (trg_sync_sku_stock keeps sku_master.quantity_in_stock in
// sync). No per-unit asset_ledger row: fungible items are tracked by quantity
// alone. movement_type follows the app-wide vocabulary already in use elsewhere
// ('receipt' on stock-in, 'sale' on stock-out, 'adjustment' for corrections) --
// po_id stays null until the owner's deferred PO-attach step links it.
export async function insertAccessoryMovement(input: {
  skuId: string
  movementType: 'receipt' | 'sale' | 'adjustment'
  quantityChange: number
  poId?: string | null
  vendorId?: string | null
  unitPrice?: number | null
  purchaseDate?: string | null
  paymentAccount?: string | null
  notes?: string | null
  createdBy: string
}) {
  return supabaseAdmin.from('stock_movements').insert({
    sku_id: input.skuId,
    movement_type: input.movementType,
    quantity_change: input.quantityChange,
    po_id: input.poId || null,
    vendor_id: input.vendorId || null,
    unit_price: input.unitPrice ?? null,
    purchase_date: input.purchaseDate || null,
    payment_account: input.paymentAccount || null,
    notes: input.notes || null,
    created_by: input.createdBy,
  })
}

// Attaches exactly `requestedQty` of a SKU's still-unattached ('receipt', po_id IS
// NULL) stock_movements onto a PO/line -- not necessarily all of it (the owner may
// want to formalize only part of a backlog, e.g. 50 of 100 units already received,
// generating one PO now and leaving the rest for later).
//
// Whole rows are consumed by updating just po_id/po_item_id (quantity_change
// untouched, so there's no stock-count impact -- correct, since re-pointing which PO
// a receipt belongs to doesn't change how many units physically exist). Splitting a
// row that's bigger than what's still needed is NOT done by shrinking that row's own
// quantity_change: trg_sync_sku_stock is BEFORE INSERT only (it does
// `quantity_in_stock += NEW.quantity_change` off the inserted row alone) and never
// fires on UPDATE, so an UPDATE to quantity_change is silently invisible to the
// cached quantity_in_stock -- it would then only see the *new* split-off row's
// insert and overcount by that amount. Instead, the source row is left completely
// untouched (permanent, immutable receipt history) and the split is expressed as two
// new 'receipt' inserts that net to zero on quantity_in_stock: +consumed (attached to
// the PO) and -consumed (po_id null, pulling that same amount back out of the
// backlog). Both are real INSERTs the trigger sees, so both invariants -- total
// quantity_in_stock unchanged, and the unattached-backlog sum reduced by exactly what
// was attached -- hold simultaneously.
export async function claimAccessoryBacklog(
  skuId: string,
  requestedQty: number,
  target: { poId: string; poItemId: string; createdBy: string }
): Promise<{ error?: string }> {
  const { data: movements, error } = await supabaseAdmin
    .from('stock_movements')
    .select('id, quantity_change, vendor_id, unit_price, purchase_date, payment_account, notes')
    .eq('sku_id', skuId)
    .eq('movement_type', 'receipt')
    .is('po_id', null)
    .order('created_at', { ascending: true })
  if (error) return { error: error.message }

  // `available` is the net of every unattached row, positive receipts and negative
  // split-offsets alike -- that's the correct bound for what can be requested.
  const available = (movements || []).reduce((sum, m) => sum + m.quantity_change, 0)
  if (requestedQty <= 0) return { error: 'quantity must be greater than zero.' }
  if (requestedQty > available) return { error: `Only ${available} unit(s) unattached for this SKU.` }

  // The consumption loop itself only ever draws from *positive* rows, though -- a
  // negative offset row (created by an earlier split, see below) exists purely to
  // net the backlog total down; it must never itself be "consumed"/attached to a PO
  // (a negative-quantity receipt row on a real PO line would be a nonsensical
  // artifact even though the totals would still add up).
  let remaining = requestedQty
  for (const m of (movements || []).filter((row) => row.quantity_change > 0)) {
    if (remaining <= 0) break
    if (m.quantity_change <= remaining) {
      const { error: updErr } = await supabaseAdmin
        .from('stock_movements')
        .update({ po_id: target.poId, po_item_id: target.poItemId })
        .eq('id', m.id)
      if (updErr) return { error: updErr.message }
      remaining -= m.quantity_change
    } else {
      const splitNotes = m.notes ? `${m.notes} (split at PO-attach)` : 'Split from backlog at PO-attach'
      const { error: attachedErr } = await supabaseAdmin.from('stock_movements').insert({
        sku_id: skuId,
        movement_type: 'receipt',
        quantity_change: remaining,
        po_id: target.poId,
        po_item_id: target.poItemId,
        vendor_id: m.vendor_id,
        unit_price: m.unit_price,
        purchase_date: m.purchase_date,
        payment_account: m.payment_account,
        notes: splitNotes,
        created_by: target.createdBy,
      })
      if (attachedErr) return { error: attachedErr.message }
      const { error: offsetErr } = await supabaseAdmin.from('stock_movements').insert({
        sku_id: skuId,
        movement_type: 'receipt',
        quantity_change: -remaining,
        po_id: null,
        vendor_id: m.vendor_id,
        unit_price: m.unit_price,
        purchase_date: m.purchase_date,
        payment_account: m.payment_account,
        notes: splitNotes,
        created_by: target.createdBy,
      })
      if (offsetErr) return { error: offsetErr.message }
      remaining = 0
    }
  }
  return {}
}

// Employee-entered vendor + unit price + purchase date, captured optionally at receipt
// time (see docs/decisions.md) -- distinct from the owner-only formal PO-attach cost/
// vendor on purchase_order_items. Returns the most recent receipt's vendor/price/date per
// SKU, for every SKU that has ever had one recorded. "Most recent" is by purchase_date
// (the business date, which may be backdated) with created_at as a tiebreak/fallback for
// older rows that predate that column.
export async function getLastEntryVendorsBySku(
  skuIds: string[]
): Promise<Map<string, { vendorId: string; vendorName: string; unitPrice: number | null; purchaseDate: string | null }>> {
  const result = new Map<string, { vendorId: string; vendorName: string; unitPrice: number | null; purchaseDate: string | null }>()
  if (skuIds.length === 0) return result

  const { data } = await supabaseAdmin
    .from('stock_movements')
    .select('sku_id, vendor_id, unit_price, purchase_date, created_at, vendors(company_name)')
    .eq('movement_type', 'receipt')
    .not('vendor_id', 'is', null)
    .in('sku_id', skuIds)

  // "Most recent" has to compare the effective date (purchase_date, falling back to
  // created_at's date for rows that never set one) -- PostgREST can't express that
  // COALESCE in a plain .order(), so it's done client-side instead. Ties on the same
  // effective date fall back to created_at (the actual insert order).
  const bestBySkuId = new Map<string, { row: any; effectiveDate: string; createdAt: string }>()
  for (const row of data || []) {
    const effectiveDate: string = row.purchase_date || row.created_at?.slice(0, 10) || ''
    const current = bestBySkuId.get(row.sku_id)
    if (!current || effectiveDate > current.effectiveDate || (effectiveDate === current.effectiveDate && row.created_at > current.createdAt)) {
      bestBySkuId.set(row.sku_id, { row, effectiveDate, createdAt: row.created_at })
    }
  }

  for (const [skuId, { row }] of bestBySkuId) {
    const vendor = Array.isArray(row.vendors) ? row.vendors[0] : row.vendors
    if (!vendor?.company_name || !row.vendor_id) continue
    result.set(skuId, {
      vendorId: row.vendor_id,
      vendorName: vendor.company_name,
      unitPrice: row.unit_price,
      purchaseDate: row.purchase_date || row.created_at?.slice(0, 10) || null,
    })
  }
  return result
}

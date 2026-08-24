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
    notes: input.notes || null,
    created_by: input.createdBy,
  })
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

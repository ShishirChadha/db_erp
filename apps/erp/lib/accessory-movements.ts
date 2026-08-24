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
    notes: input.notes || null,
    created_by: input.createdBy,
  })
}

// Employee-entered vendor + unit price captured optionally at receipt time (see
// docs/decisions.md) -- distinct from the owner-only formal PO-attach cost/vendor
// on purchase_order_items. Returns the most recent receipt's vendor/price per SKU,
// for every SKU that has ever had one recorded.
export async function getLastEntryVendorsBySku(
  skuIds: string[]
): Promise<Map<string, { vendorId: string; vendorName: string; unitPrice: number | null; receivedAt: string }>> {
  const result = new Map<string, { vendorId: string; vendorName: string; unitPrice: number | null; receivedAt: string }>()
  if (skuIds.length === 0) return result

  const { data } = await supabaseAdmin
    .from('stock_movements')
    .select('sku_id, vendor_id, unit_price, created_at, vendors(company_name)')
    .eq('movement_type', 'receipt')
    .not('vendor_id', 'is', null)
    .in('sku_id', skuIds)
    .order('created_at', { ascending: false })

  for (const row of data || []) {
    if (result.has(row.sku_id)) continue // already saw a more recent row for this SKU
    const vendor = Array.isArray(row.vendors) ? row.vendors[0] : row.vendors
    if (!vendor?.company_name || !row.vendor_id) continue
    result.set(row.sku_id, {
      vendorId: row.vendor_id,
      vendorName: vendor.company_name,
      unitPrice: row.unit_price,
      receivedAt: row.created_at,
    })
  }
  return result
}

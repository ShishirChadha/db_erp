// asset_ledger.sku_id (or, for a PO-linked unit, purchase_order_items.sku_id) is the
// as-purchased/as-received spec, set once at intake/PO time and never touched again --
// it's the historical purchase record. asset_ledger.current_sku_id is an optional
// override: null means "no override, current spec = purchased spec" (true for almost
// every unit); non-null means this specific unit was physically modified after
// purchase and its real current spec differs from what was bought.
//
// Every caller that needs "what is this unit's spec RIGHT NOW" (Sell, Stock, Sales
// Ledger, invoicing) must resolve current_sku_id first, falling back to the purchased
// spec -- this is that one shared rule, so it can't drift between call sites. Callers
// that need "what did we actually buy" (PO reporting, /api/purchase-orders/from-intake)
// read sku_id/purchase_order_items.sku_id directly and must NEVER look at
// current_sku_id -- see PATCH /api/asset-ledger/[id]/reassign-sku, the only writer.
export function resolveEffectiveSkuId(asset: {
  sku_id: string | null
  current_sku_id?: string | null
  purchase_order_items?: { sku_id: string | null } | { sku_id: string | null }[] | null
}): string | null {
  if (asset.current_sku_id) return asset.current_sku_id
  const poItem = Array.isArray(asset.purchase_order_items) ? asset.purchase_order_items[0] : asset.purchase_order_items
  return poItem?.sku_id || asset.sku_id || null
}

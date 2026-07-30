// Fungible / quantity-only SKU categories -- tracked purely by quantity via
// stock_movements (trigger-synced sku_master.quantity_in_stock), with NO per-unit
// asset_ledger row (no serial/QC/warranty per unit). Everything else (LAP/DES/MON/
// TAB/...) is serialized: one asset_ledger row per physical unit, with its own
// asset number, serial, QC, and cost.
//
// This distinction drives the purchase flow: a serialized PO line reserves N asset
// numbers and creates N asset_ledger rows; a fungible line is a single quantity-based
// row that just moves stock on receipt. See docs/decisions.md.
export const NON_SERIALIZED_CATEGORIES = ['RAM', 'SSD', 'CPU', 'GPU', 'KBD', 'MOUSE', 'ACC', 'ADP']

export function isSerializedCategory(category: string | null | undefined): boolean {
  return !!category && !NON_SERIALIZED_CATEGORIES.includes(category)
}

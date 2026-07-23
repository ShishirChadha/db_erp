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
  notes?: string | null
  createdBy: string
}) {
  return supabaseAdmin.from('stock_movements').insert({
    sku_id: input.skuId,
    movement_type: input.movementType,
    quantity_change: input.quantityChange,
    po_id: input.poId || null,
    notes: input.notes || null,
    created_by: input.createdBy,
  })
}

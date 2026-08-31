import { supabaseAdmin } from './supabase/service'

// Soft-delete restore dispatch -- every table here uses `is_deleted`, except
// sku_master which uses a divergent `status: 'archived'` convention (handled
// explicitly, not silently generalized).
const SOFT_DELETE_RESTORE: Record<string, (recordId: string) => Promise<{ error: string | null }>> = {
  sales: (id) => restoreFlag('sales', id, { is_deleted: false }),
  vendors: (id) => restoreFlag('vendors', id, { is_deleted: false }),
  purchase_orders: (id) => restoreFlag('purchase_orders', id, { is_deleted: false }),
  customers: (id) => restoreFlag('customers', id, { is_deleted: false }),
  invoices: (id) => restoreFlag('invoices', id, { is_deleted: false }),
  expenses: (id) => restoreFlag('expenses', id, { is_deleted: false }),
  asset_ledger: (id) => restoreFlag('asset_ledger', id, { is_deleted: false }),
  sales_documents: (id) => restoreFlag('sales_documents', id, { is_deleted: false }),
  activities: (id) => restoreFlag('activities', id, { is_deleted: false }),
  activity_comments: (id) => restoreFlag('activity_comments', id, { is_deleted: false }),
  sku_master: (id) => restoreFlag('sku_master', id, { status: 'active' }),
  profiles: (id) => restoreFlag('profiles', id, { is_active: true }),
}

async function restoreFlag(table: string, id: string, patch: Record<string, any>): Promise<{ error: string | null }> {
  const { error } = await supabaseAdmin.from(table).update(patch).eq('id', id)
  return { error: error?.message ?? null }
}

export function canRestoreSoftDelete(tableName: string): boolean {
  return tableName in SOFT_DELETE_RESTORE
}

export async function restoreSoftDelete(tableName: string, recordId: string): Promise<{ error: string | null }> {
  const handler = SOFT_DELETE_RESTORE[tableName]
  if (!handler) return { error: `No soft-delete restore handler for table "${tableName}"` }
  return handler(recordId)
}

// Field-level values are stored as stringified text in field_corrections; these
// columns are jsonb/array and would be corrupted by writing a stringified value
// back verbatim, so single-field revert refuses them rather than guessing.
export const NON_SCALAR_REVERT_BLOCKLIST = new Set([
  'bundled_accessories',
  'specifications',
  'field_schema',
  'allowed_pages',
  'tags',
  'mentioned_user_ids',
  'attachments',
  'selected_upgrades',
  'metadata',
])

export interface HardDeleteRestoreResult {
  success: boolean
  failedStep?: string
  error?: string
}

// Per-route hard-delete restore handlers -- genuinely different reconstruction
// steps per route, not a generic one-size-fits-all restore. Re-inserts rows
// with their ORIGINAL ids/asset_number/po_number: this does not conflict with
// the existing "counters are never clawed back" decision (docs/decisions.md) --
// that decision is about not rewinding asset_counters/po_counter on delete,
// which is orthogonal to putting back a row with the numbers it already had.
export async function restoreAssetLedgerHardDelete(snapshot: any): Promise<HardDeleteRestoreResult> {
  if (!snapshot || snapshot.kind !== 'row' || snapshot.table !== 'asset_ledger') {
    return { success: false, error: 'Snapshot is missing or not a single-row asset_ledger snapshot' }
  }
  const { error } = await supabaseAdmin.from('asset_ledger').insert(snapshot.row)
  if (error) return { success: false, failedStep: 'insert asset_ledger', error: error.message }
  return { success: true }
}

export async function restorePurchaseOrderHardDelete(snapshot: any): Promise<HardDeleteRestoreResult> {
  if (!snapshot || snapshot.kind !== 'cascade' || snapshot.primary?.table !== 'purchase_orders') {
    return { success: false, error: 'Snapshot is missing or not a valid purchase_orders cascade snapshot' }
  }

  const { error: poErr } = await supabaseAdmin.from('purchase_orders').insert(snapshot.primary.row)
  if (poErr) return { success: false, failedStep: 'insert purchase_orders', error: poErr.message }

  const itemsChild = (snapshot.children || []).find((c: any) => c.table === 'purchase_order_items')
  if (itemsChild?.rows?.length) {
    const { error: itemsErr } = await supabaseAdmin.from('purchase_order_items').insert(itemsChild.rows)
    if (itemsErr) return { success: false, failedStep: 'insert purchase_order_items', error: itemsErr.message }
  }

  const assetsChild = (snapshot.children || []).find((c: any) => c.table === 'asset_ledger')
  if (assetsChild?.rows?.length) {
    const { error: assetsErr } = await supabaseAdmin.from('asset_ledger').insert(assetsChild.rows)
    if (assetsErr) return { success: false, failedStep: 'insert asset_ledger', error: assetsErr.message }
  }

  const stockChild = (snapshot.children || []).find((c: any) => c.table === 'stock_movements')
  if (stockChild?.reversals?.length) {
    for (const reversal of stockChild.reversals) {
      const { error: movementErr } = await supabaseAdmin.from('stock_movements').insert({
        sku_id: reversal.sku_id,
        movement_type: 'adjustment',
        quantity_change: -reversal.quantity_change, // undo the hard-delete's reduction
        po_id: snapshot.primary.row.id,
        notes: `Stock restored due to PO restore (${snapshot.primary.row.po_number})`,
      })
      if (movementErr) return { success: false, failedStep: 'insert stock_movements reversal', error: movementErr.message }
    }
  }
  // po_counter / asset_counters intentionally untouched -- one-way by design.

  return { success: true }
}

// sale_payments hard-delete restore is a plain single-row insert-back -- the
// sales.amount_paid/payment_status trigger recomputes automatically off the
// re-inserted row, same as it does for any other sale_payments insert.
export async function restoreSalePaymentHardDelete(snapshot: any): Promise<HardDeleteRestoreResult> {
  if (!snapshot || snapshot.kind !== 'row' || snapshot.table !== 'sale_payments') {
    return { success: false, error: 'Snapshot is missing or not a single-row sale_payments snapshot' }
  }
  const { error } = await supabaseAdmin.from('sale_payments').insert(snapshot.row)
  if (error) return { success: false, failedStep: 'insert sale_payments', error: error.message }
  return { success: true }
}

// vendor_payments hard-delete restore mirrors sale_payments -- a plain single-row
// insert-back, with purchase_orders.amount_paid/payment_status recomputed
// automatically by trg_sync_po_payment_totals off the re-inserted row.
export async function restoreVendorPaymentHardDelete(snapshot: any): Promise<HardDeleteRestoreResult> {
  if (!snapshot || snapshot.kind !== 'row' || snapshot.table !== 'vendor_payments') {
    return { success: false, error: 'Snapshot is missing or not a single-row vendor_payments snapshot' }
  }
  const { error } = await supabaseAdmin.from('vendor_payments').insert(snapshot.row)
  if (error) return { success: false, failedStep: 'insert vendor_payments', error: error.message }
  return { success: true }
}

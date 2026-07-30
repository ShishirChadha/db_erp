import { supabaseAdmin } from './supabase/service'
import { insertAccessoryMovement } from './accessory-movements'
import { financialYear } from '@db/shared'

// SELLABLE_STATUSES/financialYear now live in @db/shared so apps/web's order
// -> sale conversion uses the exact same definitions, not a second copy that
// could silently drift (see docs/decisions.md, 2026-07-28, Phase 2).
export { SELLABLE_STATUSES, financialYear } from '@db/shared'

// Mints the next real invoice number for a business entity via the atomic
// next_document_number() RPC -- never a client-side scan, never editable.
// entityKey maps 1:1 to sales.payment_account (lowercased): 'digitalbluez',
// 'techtenth', or 'cash'.
export async function mintSalesInvoiceNumber(entityKey: string = 'digitalbluez'): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc('next_document_number', {
    p_entity_key: entityKey,
    p_doc_type: 'sales_invoice',
    p_financial_year: financialYear(),
  })
  if (error) throw error
  return data as string
}

// Reverses the inventory-side effects of one 'sales' row -- shared by the owner's
// explicit void (app/api/sales/[id]/void) and cart-checkout rollback (a later item in
// the same multi-item submission failed, so earlier items committed in this request
// need to be undone). Does NOT touch the sales row itself (is_deleted / hard-delete /
// audit logging) -- callers decide that part, since a real void and a same-request
// rollback treat the sales row differently (soft-delete + logged reason vs hard-delete,
// since a rolled-back cart line was never a completed sale anyone saw).
export async function reverseSaleInventoryEffects(
  saleRow: {
    asset_ledger_id?: string | null
    accessory_id?: string | null
    accessory_quantity?: number | null
    bundled_accessories?: Array<{ accessory_id: string; quantity: number }> | null
  },
  opts: { reason: string; userId: string; assetRevertStatus?: string }
): Promise<{ error?: string }> {
  const revertStatus = opts.assetRevertStatus || 'ready_for_sale'

  if (saleRow.asset_ledger_id) {
    const { data: asset } = await supabaseAdmin
      .from('asset_ledger')
      .select('id, status, sku_id')
      .eq('id', saleRow.asset_ledger_id)
      .single()
    if (!asset) return { error: 'Linked unit not found.' }

    const { data: reverted, error: revertErr } = await supabaseAdmin
      .from('asset_ledger')
      .update({ status: revertStatus, sold_at: null })
      .eq('id', saleRow.asset_ledger_id)
      .eq('status', 'sold')
      .select('id')
      .maybeSingle()
    if (revertErr) return { error: revertErr.message }
    if (!reverted) return { error: "This unit is no longer in 'sold' status (something else already changed it) -- cannot reverse automatically." }

    await supabaseAdmin.from('stock_movements').insert({
      sku_id: asset.sku_id,
      movement_type: 'adjustment',
      quantity_change: 1,
      notes: opts.reason,
      created_by: opts.userId,
    })

    const bundled = saleRow.bundled_accessories || []
    for (const item of bundled) {
      if (!item?.accessory_id || !item?.quantity) continue
      await insertAccessoryMovement({
        skuId: item.accessory_id,
        movementType: 'adjustment',
        quantityChange: item.quantity,
        notes: opts.reason,
        createdBy: opts.userId,
      })
    }
  } else if (saleRow.accessory_id) {
    const { error: moveErr } = await insertAccessoryMovement({
      skuId: saleRow.accessory_id,
      movementType: 'adjustment',
      quantityChange: saleRow.accessory_quantity || 1,
      notes: opts.reason,
      createdBy: opts.userId,
    })
    if (moveErr) return { error: moveErr.message }
  }

  return {}
}

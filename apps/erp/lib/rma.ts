import { supabaseAdmin } from './supabase/service'
import { insertAccessoryMovement } from './accessory-movements'

// A unit physically coming back from a customer -- shared by plain Return
// (app/api/rma/route.ts, direction: 'from_customer') and Replacement's old-unit
// leg (app/api/repair-jobs/route.ts). Distinct from reverseSaleInventoryEffects
// (lib/sales-entry.ts), which is for "this sale was a mistake" (void, cart
// rollback) and reverts straight to ready_for_sale with no QC gate and no
// asset_rma_events row -- a real physical return needs re-inspection first.
export async function processCustomerReturn(
  assetId: string,
  opts: { reason: string; notes?: string | null; userId: string; eventDate?: string }
): Promise<{
  error?: string
  status?: number
  saleId?: string
  saleAmountPaid?: number
  bundledAccessories?: Array<{ accessory_id: string; quantity: number; unit_price?: number }> | null
}> {
  const { data: asset } = await supabaseAdmin
    .from('asset_ledger')
    .select('status, sku_id')
    .eq('id', assetId)
    .single()

  if (!asset) return { error: 'Asset not found', status: 404 }
  if (asset.status !== 'sold') {
    return {
      error: `Only 'sold' assets can have a customer return (current status: ${asset.status})`,
      status: 400,
    }
  }

  const openedAt = opts.eventDate ? `${opts.eventDate}T12:00:00.000Z` : undefined
  const { error: insertErr } = await supabaseAdmin.from('asset_rma_events').insert({
    asset_id: assetId,
    direction: 'from_customer',
    reason: opts.reason,
    notes: opts.notes || null,
    created_by: opts.userId,
    ...(openedAt ? { opened_at: openedAt } : {}),
  })
  if (insertErr) return { error: insertErr.message, status: 500 }

  // A customer return re-enters the QC funnel exactly like a fresh receipt,
  // since it needs to be re-inspected before it can be resold.
  const { data: reverted, error: revertErr } = await supabaseAdmin
    .from('asset_ledger')
    .update({ status: 'qc_pending', qc_status: 'pending' })
    .eq('id', assetId)
    .eq('status', 'sold')
    .select('id')
    .maybeSingle()
  if (revertErr) return { error: revertErr.message, status: 500 }
  if (!reverted) {
    return { error: "This unit is no longer in 'sold' status (something else already changed it) -- cannot process return.", status: 409 }
  }

  // The original sale wrote a -1 'sale' movement that nothing downstream ever
  // offsets -- without this, sku_master.quantity_in_stock permanently
  // understates stock by 1 every time a customer returns a unit.
  await supabaseAdmin.from('stock_movements').insert({
    sku_id: asset.sku_id,
    movement_type: 'adjustment',
    quantity_change: 1,
    notes: `Customer return -- ${opts.reason}`,
    created_by: opts.userId,
  })

  // Reverse bundled accessories from the original sale too -- these were
  // decremented as part of that sale and nothing has ever offset them either.
  const { data: saleRow } = await supabaseAdmin
    .from('sales')
    .select('id, amount_paid, bundled_accessories')
    .eq('asset_ledger_id', assetId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const bundled = saleRow?.bundled_accessories || []
  for (const item of bundled) {
    if (!item?.accessory_id || !item?.quantity) continue
    await insertAccessoryMovement({
      skuId: item.accessory_id,
      movementType: 'adjustment',
      quantityChange: item.quantity,
      notes: `Customer return -- ${opts.reason}`,
      createdBy: opts.userId,
    })
  }

  return {
    saleId: saleRow?.id,
    saleAmountPaid: saleRow?.amount_paid ?? 0,
    bundledAccessories: saleRow?.bundled_accessories ?? null,
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser } from '@/lib/auth/session'

// ---------- GET: how many assets would be affected by a reassignment ----------
// A PO-linked asset's SKU is governed by its purchase_order_items.sku_id, shared
// by every asset under that same line item -- reassigning one means reassigning
// all of them together. The caller should see that count before confirming.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: asset } = await supabaseAdmin
    .from('asset_ledger')
    .select('po_item_id, sku_id')
    .eq('id', id)
    .single()

  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 })

  if (!asset.po_item_id) {
    return NextResponse.json({ po_item_id: null, affected_count: 1 })
  }

  const { count } = await supabaseAdmin
    .from('asset_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('po_item_id', asset.po_item_id)

  return NextResponse.json({ po_item_id: asset.po_item_id, affected_count: count ?? 1 })
}

// ---------- PATCH: reassign this asset (or its whole PO line item) to an existing SKU ----------
// Open to any authenticated role (employee or owner) -- no cost/vendor data is
// read or returned here, so this doesn't need owner-gating the way editing SKU
// master data does.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const { new_sku_id, confirm_despite_invoice } = body as { new_sku_id?: string; confirm_despite_invoice?: boolean }

  if (!new_sku_id) {
    return NextResponse.json({ error: 'new_sku_id is required' }, { status: 400 })
  }

  const { data: sku } = await supabaseAdmin
    .from('sku_master')
    .select('id')
    .eq('id', new_sku_id)
    .single()
  if (!sku) return NextResponse.json({ error: 'Target SKU not found' }, { status: 404 })

  // A reassignment on a unit whose sale is already invoiced silently desyncs the
  // printed/sent invoice from the live system (the invoice is a frozen snapshot,
  // never retroactively updated) -- warn and require explicit confirmation rather
  // than allowing that drift unnoticed.
  const { data: invoicedSale } = await supabaseAdmin
    .from('sales')
    .select('id, invoice_number')
    .eq('asset_ledger_id', id)
    .eq('finalized', true)
    .maybeSingle()
  if (invoicedSale && !confirm_despite_invoice) {
    return NextResponse.json({
      error: `This unit is already on invoice ${invoicedSale.invoice_number || invoicedSale.id} -- reassigning its SKU will NOT update that invoice, which will then disagree with the live system. Confirm to proceed anyway.`,
      error_code: 'already_invoiced',
    }, { status: 409 })
  }

  const { data: asset } = await supabaseAdmin
    .from('asset_ledger')
    .select('po_item_id, sku_id')
    .eq('id', id)
    .single()
  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 })

  const oldSkuId = asset.sku_id

  if (asset.po_item_id) {
    // Reassign the whole PO line item -- every asset under it shares this SKU.
    const { error } = await supabaseAdmin
      .from('purchase_order_items')
      .update({ sku_id: new_sku_id })
      .eq('id', asset.po_item_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    // Legacy-door / pre-adoption row -- SKU lives directly on the ledger row.
    const { error } = await supabaseAdmin
      .from('asset_ledger')
      .update({ sku_id: new_sku_id })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // sku_master.quantity_in_stock is only ever updated by the trg_sync_sku_stock
  // trigger (BEFORE INSERT on stock_movements) -- never write it directly.
  // A reassignment moves 1 unit's stock-count contribution from the old SKU to
  // the new one, regardless of whether this asset is part of a larger PO line
  // item (each asset under that line already has its own original receipt row;
  // only this one unit's current SKU mapping is changing).
  if (oldSkuId && oldSkuId !== new_sku_id) {
    const { error: movementErr } = await supabaseAdmin.from('stock_movements').insert([
      { sku_id: oldSkuId, movement_type: 'adjustment', quantity_change: -1, notes: 'SKU reassignment' },
      { sku_id: new_sku_id, movement_type: 'adjustment', quantity_change: 1, notes: 'SKU reassignment' },
    ])
    if (movementErr) return NextResponse.json({ error: movementErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { resolveEffectiveSkuId } from '@/lib/effective-sku'

// ---------- GET: the asset's current effective spec, for FixSkuDialog's before/after diff ----------
// Returns `current_sku` -- the "before" side of a RAM/SSD spec diff FixSkuDialog uses to
// detect an upgrade/downgrade and prompt the correct stock-adjustment direction, rather
// than a generic guess. Resolved via the current_sku_id override (if set), falling back
// to the purchased spec -- same precedence rule as everywhere else that reads a unit's
// current spec (see resolveEffectiveSkuId above).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: asset } = await supabaseAdmin
    .from('asset_ledger')
    .select('sku_id, current_sku_id, purchase_order_items(sku_id)')
    .eq('id', id)
    .single()

  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 })

  const effectiveSkuId = resolveEffectiveSkuId(asset)
  const { data: currentSku } = effectiveSkuId
    ? await supabaseAdmin
        .from('sku_master')
        .select('id, full_sku_code, sku_description, category, specifications')
        .eq('id', effectiveSkuId)
        .single()
    : { data: null }

  return NextResponse.json({ current_sku: currentSku || null })
}

// ---------- PATCH: change this unit's CURRENT effective spec ----------
// Open to any authenticated role (employee or owner) -- no cost/vendor data is
// read or returned here, so this doesn't need owner-gating the way editing SKU
// master data does.
//
// Deliberately never writes to asset_ledger.sku_id or purchase_order_items.sku_id --
// those are the historical purchase record and must stay accurate to what was actually
// bought, no matter what happens to the unit afterward. This only ever sets
// current_sku_id on the ONE unit being reassigned, so (a) a Purchase Order's own record
// is never retroactively rewritten, and (b) reassigning one unit can never affect
// sibling units sharing the same PO line item (both real bugs the old sku_id-mutating
// version had -- see docs/decisions.md).
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
    .select('sku_id, current_sku_id, purchase_order_items(sku_id)')
    .eq('id', id)
    .single()
  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 })

  const oldEffectiveSkuId = resolveEffectiveSkuId(asset)

  const { error: updateErr } = await supabaseAdmin
    .from('asset_ledger')
    .update({ current_sku_id: new_sku_id })
    .eq('id', id)
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  // sku_master.quantity_in_stock is only ever updated by the trg_sync_sku_stock
  // trigger (BEFORE INSERT on stock_movements) -- never write it directly. Moves this
  // one unit's stock-count contribution from its old effective SKU to the new one.
  if (oldEffectiveSkuId && oldEffectiveSkuId !== new_sku_id) {
    const { error: movementErr } = await supabaseAdmin.from('stock_movements').insert([
      { sku_id: oldEffectiveSkuId, movement_type: 'adjustment', quantity_change: -1, notes: 'SKU reassignment' },
      { sku_id: new_sku_id, movement_type: 'adjustment', quantity_change: 1, notes: 'SKU reassignment' },
    ])
    if (movementErr) return NextResponse.json({ error: movementErr.message }, { status: 500 })
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'stock',
    tableName: 'asset_ledger',
    recordId: id,
    metadata: { old_effective_sku_id: oldEffectiveSkuId, new_current_sku_id: new_sku_id },
  })

  return NextResponse.json({ success: true })
}

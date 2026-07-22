import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { resolveOrCreateSku } from '@/lib/sku-resolver'
import { getSessionUser, isOwner, hasPageAccess } from '@/lib/auth/session'
import { TYPE_TO_CATEGORY, resolveBrand, buildSpecifications, buildIntakeLedgerRow } from '@/lib/stock-intake'

// ---------- GET: owner's queue of intake units still needing purchase paperwork ----------
// "Needs paperwork" = never adopted into a PO (po_id IS NULL). Inventory-wise these
// units are already live (see POST below) -- this is a bookkeeping reminder, not a gate.
// Surfaced from the Current Stock page (Part 7/D'), not a standalone review page.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data, error } = await supabaseAdmin
    .from('asset_ledger')
    .select('id, asset_number, serial_number, status, notes, purchased_by_type, created_at, entered_by, sku_id, sku_master(full_sku_code, brand, model_name, specifications)')
    .eq('source', 'employee_intake')
    .is('po_id', null)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

// ---------- POST: employee (or owner) registers a physical unit they just received ----------
// No vendor_id/cost_price/po_id/asset_number accepted here by design -- this is the
// employee-safe door. The unit is live stock immediately (status='qc_pending', counted
// in quantity_in_stock) but stays untagged (no asset number) until a real PO exists for
// it -- see /api/purchase-orders/from-intake, which is bookkeeping, not a gate on
// whether the unit exists, can be QC'd, or can be sold.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'new_entry')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()

  if (!body.type) return NextResponse.json({ error: 'Type is required.' }, { status: 400 })
  if (!body.model) return NextResponse.json({ error: 'Model is required.' }, { status: 400 })

  const category = TYPE_TO_CATEGORY[body.type] || 'OTHER'
  const specs = buildSpecifications(category, body)
  const brand = resolveBrand(body)

  let sku
  try {
    const result = await resolveOrCreateSku({
      category,
      item_type: body.type,
      brand,
      model_name: body.model,
      specifications: specs,
      sku_description: `${brand} ${body.model}`.trim(),
    })
    sku = result.sku
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to resolve SKU: ${err.message}` }, { status: 500 })
  }

  const ledgerRow = buildIntakeLedgerRow(body, {
    skuId: sku.id,
    enteredBy: sessionUser.id,
  })

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('asset_ledger')
    .insert(ledgerRow)
    .select('id')
    .single()

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  // sku_master.quantity_in_stock is incremented atomically by the existing
  // trg_sync_sku_stock trigger on this insert -- mirrors what the structured PO flow's
  // /receive route already does on physical receipt.
  await supabaseAdmin.from('stock_movements').insert({
    sku_id: sku.id,
    movement_type: 'receipt',
    quantity_change: 1,
    notes: `Stock intake -- serial ${body.serial_number || 'n/a'}`,
    created_by: sessionUser.id,
  })

  return NextResponse.json({ success: true, id: inserted.id, sku_id: sku.id }, { status: 201 })
}

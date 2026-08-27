import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { resolveOrCreateSku } from '@/lib/sku-resolver'
import { getSessionUser, isOwner, hasPageAccess } from '@/lib/auth/session'
import { TYPE_TO_CATEGORY, resolveBrand, buildSpecifications, buildIntakeLedgerRow } from '@/lib/stock-intake'
import { insertAccessoryMovement } from '@/lib/accessory-movements'
import { findDuplicateSerial } from '@/lib/duplicate-serial'
import { logAuditEvent } from '@/lib/audit-log'

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
  const category = TYPE_TO_CATEGORY[body.type] || 'OTHER'
  // Monitor's field_schema has no `model`-equivalent field (just brand/size/etc, see
  // sku_category_templates) -- schema-driven field capture means the frontend genuinely
  // has nothing to send for it, matching how creating a Monitor SKU via SKU Master's own
  // "New SKU" form works today. Every other category still requires it.
  if (!body.model && category !== 'MON') return NextResponse.json({ error: 'Model is required.' }, { status: 400 })

  // Serial number has no DB-level uniqueness constraint (see the duplication analysis
  // in docs/decisions.md) -- hard block on any existing match, no confirm-and-proceed
  // override, same as every other door that writes asset_ledger (PO receiving, manual
  // stock edit -- see lib/duplicate-serial.ts). A live duplicate (serial PG02SA4Q, same
  // physical unit entered twice under two slightly different model-name spellings) got
  // through this exact door via the old click-past-the-warning path.
  if (body.serial_number) {
    const dup = await findDuplicateSerial(body.serial_number)
    if (dup) {
      return NextResponse.json({
        error: `Serial "${body.serial_number}" already exists as ${dup.asset_number || 'an untagged unit'} (status: ${dup.status}, source: ${dup.source}). This serial cannot be entered again -- if this is genuinely a different unit, check Stock/QC for the existing entry first, or ask the owner to correct it there.`,
        error_code: 'duplicate_serial',
        existing: dup,
      }, { status: 409 })
    }
  }

  // A desktop bought as a "complete set" can bundle its own monitor -- a real
  // serialized unit (own sku_master/asset_ledger row), not a quantity-only accessory.
  // Validate its serial up front too, before any writes happen for either unit.
  const bundledMonitor = body.bundled_monitor as { brand?: string; size?: string; resolution?: string; serial_number?: string } | undefined
  if (bundledMonitor?.serial_number) {
    const dupMon = await findDuplicateSerial(bundledMonitor.serial_number)
    if (dupMon) {
      return NextResponse.json({
        error: `Bundled monitor serial "${bundledMonitor.serial_number}" already exists as ${dupMon.asset_number || 'an untagged unit'} (status: ${dupMon.status}, source: ${dupMon.source}).`,
        error_code: 'duplicate_serial',
        existing: dupMon,
      }, { status: 409 })
    }
  }

  // Schema-driven callers (the current Stock Intake frontend) send a ready-made
  // `specifications` object matching the category's own sku_category_templates.
  // field_schema, same shape SKU Master's "New SKU" form sends -- used verbatim when
  // present. `buildSpecifications`'s legacy flat-field assembly stays as a fallback for
  // any caller that still sends the old shape (e.g. /api/purchases' AddPurchaseDialog,
  // which shares this same helper and hasn't been migrated).
  const specs = body.specifications && typeof body.specifications === 'object'
    ? { brand: resolveBrand(body), ...body.specifications }
    : buildSpecifications(category, body)
  const brand = resolveBrand(body)

  let sku
  let possibleDuplicates
  try {
    const result = await resolveOrCreateSku({
      category,
      item_type: body.type,
      brand,
      model_name: body.model || '',
      specifications: specs,
      sku_description: `${brand} ${body.model || ''}`.trim(),
    })
    sku = result.sku
    possibleDuplicates = result.possibleDuplicates
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

  // Accessories received alongside this unit (mouse, adapter, bag, etc.) -- these are
  // sku_master rows like everything else, incremented via the same trigger-synced
  // stock_movements ledger, just a 'receipt' movement instead of 'sale'.
  const bundled: Array<{ accessory_id: string; quantity: number }> = body.bundled_accessories || []
  for (const item of bundled) {
    if (!item?.accessory_id || !item?.quantity) continue
    await insertAccessoryMovement({
      skuId: item.accessory_id,
      movementType: 'receipt',
      quantityChange: item.quantity,
      notes: `Received bundled with stock intake -- serial ${body.serial_number || 'n/a'}`,
      createdBy: sessionUser.id,
    })
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'stock',
    tableName: 'asset_ledger',
    recordId: inserted.id,
    recordLabel: body.serial_number || inserted.id,
    metadata: { sku_id: sku.id, type: body.type, model: body.model },
  })

  // Bundled monitor -- a genuine second unit, created the same way the primary one
  // was (resolve/create its SKU, insert its own asset_ledger row, own receipt
  // movement), just fixed to category MON. Not wrapped in the primary unit's success
  // response failing if this fails -- the desktop is already live stock either way,
  // so a problem here is surfaced as a warning, not a rollback.
  let bundledMonitorId: string | undefined
  let bundledMonitorWarning: string | undefined
  if (bundledMonitor?.brand && bundledMonitor?.size) {
    try {
      const monSpecs = { brand: bundledMonitor.brand, size: bundledMonitor.size, ...(bundledMonitor.resolution ? { resolution: bundledMonitor.resolution } : {}) }
      const monResult = await resolveOrCreateSku({
        category: 'MON',
        item_type: 'Monitor',
        brand: bundledMonitor.brand,
        model_name: `${bundledMonitor.brand} ${bundledMonitor.size}"`,
        specifications: monSpecs,
        sku_description: `${bundledMonitor.brand} ${bundledMonitor.size}" Monitor`,
      })
      const monLedgerRow = buildIntakeLedgerRow(
        { ...body, serial_number: bundledMonitor.serial_number, condition_notes: `Bundled with desktop -- serial ${body.serial_number || 'n/a'}` },
        { skuId: monResult.sku.id, enteredBy: sessionUser.id }
      )
      const { data: monInserted, error: monInsertErr } = await supabaseAdmin
        .from('asset_ledger')
        .insert(monLedgerRow)
        .select('id')
        .single()
      if (monInsertErr) throw new Error(monInsertErr.message)
      bundledMonitorId = monInserted.id

      await supabaseAdmin.from('stock_movements').insert({
        sku_id: monResult.sku.id,
        movement_type: 'receipt',
        quantity_change: 1,
        notes: `Bundled monitor with desktop intake -- serial ${bundledMonitor.serial_number || 'n/a'}`,
        created_by: sessionUser.id,
      })

      await logAuditEvent({
        actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
        actionType: 'create',
        module: 'stock',
        tableName: 'asset_ledger',
        recordId: monInserted.id,
        recordLabel: bundledMonitor.serial_number || monInserted.id,
        metadata: { sku_id: monResult.sku.id, type: 'Monitor', bundled_with: inserted.id },
      })
    } catch (err: any) {
      bundledMonitorWarning = `Desktop saved, but the bundled monitor failed: ${err.message}`
    }
  }

  return NextResponse.json(
    {
      success: true,
      id: inserted.id,
      sku_id: sku.id,
      possible_duplicates: possibleDuplicates,
      bundled_monitor_id: bundledMonitorId,
      bundled_monitor_warning: bundledMonitorWarning,
    },
    { status: 201 }
  )
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { resolveOrCreateSku } from '@/lib/sku-resolver'
import {
  TYPE_TO_CATEGORY,
  buildSpecifications,
  resolveBrand,
  getAssetPrefix,
  mapStatusPurchaseToLedgerStatus,
  updateVendorInvoiceTotal,
  buildPurchaseRecord,
} from '@/lib/purchases-legacy'
import { logAuditEvent } from '@/lib/audit-log'
import { insertAccessoryMovement } from '@/lib/accessory-movements'

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  return error ? null : user
}

// ---------- POST: create one or more purchase entries (legacy quick-entry door) ----------
// Writes both a `purchases` row (rich purchase-event detail: invoice/expense/photo/
// remarks) and a matching `asset_ledger` row (shared per-unit lifecycle), linked via
// legacy_purchase_id. This is the server-side replacement for AddPurchaseDialog.tsx's
// direct client-side insert + its own asset-numbering logic.
export async function POST(req: NextRequest) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  if (!body.purchase_date) return NextResponse.json({ error: 'Purchase date is required.' }, { status: 400 })
  if (!body.vendor_id) return NextResponse.json({ error: 'Please select a vendor.' }, { status: 400 })
  if (!body.type) return NextResponse.json({ error: 'Type is required.' }, { status: 400 })

  const category = TYPE_TO_CATEGORY[body.type] || 'OTHER'
  const specs = buildSpecifications(category, body)
  const brand = resolveBrand(body)

  let sku
  let possibleDuplicates
  try {
    const result = await resolveOrCreateSku({
      category,
      item_type: body.type,
      brand,
      model_name: body.model,
      specifications: specs,
      base_cost: body.base_price,
      sku_description: body.asset_description,
    })
    sku = result.sku
    possibleDuplicates = result.possibleDuplicates
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to resolve SKU: ${err.message}` }, { status: 500 })
  }

  const status: 'draft' | 'submitted' = body.status === 'submitted' ? 'submitted' : 'draft'
  const quantity = Math.max(1, parseInt(body.quantity) || 1)

  const providedSerials: string[] = Array.isArray(body.serial_numbers) ? body.serial_numbers : []
  const serials = Array.from({ length: quantity }, (_, i) =>
    quantity > 1 ? (providedSerials[i] || '') : (body.serial_number || '')
  )

  // Only a 'submitted' save consumes real asset numbers -- a draft is saved with no
  // number at all so an abandoned/deleted draft never creates a gap in the sequence.
  let assetNumbers: (string | null)[] = Array(quantity).fill(null)
  const manualOverride = quantity === 1 ? (body.asset_number || '').trim() : ''
  if (status === 'submitted' && manualOverride) {
    const { data: existing } = await supabaseAdmin
      .from('asset_ledger')
      .select('id')
      .eq('asset_number', manualOverride)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ error: `Asset number "${manualOverride}" already exists.` }, { status: 400 })
    }
    assetNumbers = [manualOverride]
  } else if (status === 'submitted') {
    const prefix = getAssetPrefix(body.purchased_by_type, body.purchased_by_other)
    const { data: reserved, error: rpcErr } = await supabaseAdmin.rpc('reserve_assets', {
      p_prefix: prefix,
      purchased_by_type: body.purchased_by_type,
      qty: quantity,
    })
    if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 })
    assetNumbers = reserved
  }

  const ledgerStatus = status === 'draft' ? 'draft' : mapStatusPurchaseToLedgerStatus(body.status_purchase)
  const nowIso = new Date().toISOString()
  const createdIds: string[] = []

  for (let i = 0; i < quantity; i++) {
    const purchaseRecord = buildPurchaseRecord(body, {
      assetNumber: assetNumbers[i],
      serialNumber: serials[i],
      skuFullCode: sku.full_sku_code,
      brand,
      status,
    })

    const { data: purchaseRow, error: purchaseErr } = await supabaseAdmin
      .from('purchases')
      .insert(purchaseRecord)
      .select('id')
      .single()
    if (purchaseErr) return NextResponse.json({ error: purchaseErr.message }, { status: 500 })

    const { error: ledgerErr } = await supabaseAdmin.from('asset_ledger').insert({
      sku_id: sku.id,
      asset_number: assetNumbers[i],
      serial_number: serials[i] || null,
      status: ledgerStatus,
      source: 'legacy_purchase',
      legacy_purchase_id: purchaseRow.id,
      vendor_id: body.vendor_id,
      purchased_by_type: body.purchased_by_type,
      cost_price: body.base_price,
      gst_percentage: body.gst,
      reserved_at: status === 'submitted' ? nowIso : null,
      received_at: status === 'submitted' ? nowIso : null,
    })
    if (ledgerErr) return NextResponse.json({ error: ledgerErr.message }, { status: 500 })

    createdIds.push(purchaseRow.id)
  }

  if (body.purchased_invoice_number) {
    await updateVendorInvoiceTotal(body.vendor_id, body.purchased_invoice_number)
  }

  // This route's session comes from a raw Supabase auth user (getUser above), not the
  // role-resolved sessionUser used elsewhere -- role is left null here rather than
  // guessed.
  for (const purchaseId of createdIds) {
    await logAuditEvent({
      actor: { id: user.id, email: user.email, role: null },
      actionType: 'create',
      module: 'purchase_orders',
      tableName: 'purchases',
      recordId: purchaseId,
    })
  }

  // Bundled accessories (real stock, e.g. a keyboard/mouse bought with this desktop) --
  // only meaningful for a single-unit purchase, same restriction the client enforces.
  const bundledAccessories: Array<{ accessory_id: string; quantity: number }> = quantity === 1 ? (body.bundled_accessories || []) : []
  for (const item of bundledAccessories) {
    if (!item?.accessory_id || !item?.quantity) continue
    await insertAccessoryMovement({
      skuId: item.accessory_id,
      movementType: 'receipt',
      quantityChange: item.quantity,
      notes: `Received bundled with purchase -- serial ${serials[0] || 'n/a'}`,
      createdBy: user.id,
    })
  }

  // Bundled monitor -- a genuine second unit (own sku_master/asset_ledger/purchases
  // rows), same vendor/invoice as the primary purchase but its own asset number and
  // no price captured separately (the owner can allocate cost later via the Purchases
  // ledger edit if needed). Failure here doesn't roll back the primary purchase, which
  // already succeeded -- surfaced as a warning instead.
  let bundledMonitorWarning: string | undefined
  const bundledMonitor = quantity === 1 ? body.bundled_monitor as { brand?: string; size?: string; resolution?: string; serial_number?: string } | undefined : undefined
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

      let monAssetNumber: string | null = null
      if (status === 'submitted') {
        const prefix = getAssetPrefix(body.purchased_by_type, body.purchased_by_other)
        const { data: reserved, error: rpcErr } = await supabaseAdmin.rpc('reserve_assets', {
          p_prefix: prefix,
          purchased_by_type: body.purchased_by_type,
          qty: 1,
        })
        if (rpcErr) throw new Error(rpcErr.message)
        monAssetNumber = reserved[0]
      }

      const monPurchaseRecord = buildPurchaseRecord(
        { ...body, model: `${bundledMonitor.brand} ${bundledMonitor.size}"`, asset_description: `Bundled monitor with ${sku.full_sku_code}`, base_price: null, gst_amount: null, total_price: 0, selling_price: null },
        { assetNumber: monAssetNumber, serialNumber: bundledMonitor.serial_number || '', skuFullCode: monResult.sku.full_sku_code, brand: bundledMonitor.brand, status }
      )
      const { data: monPurchaseRow, error: monPurchaseErr } = await supabaseAdmin
        .from('purchases')
        .insert(monPurchaseRecord)
        .select('id')
        .single()
      if (monPurchaseErr) throw new Error(monPurchaseErr.message)

      const { error: monLedgerErr } = await supabaseAdmin.from('asset_ledger').insert({
        sku_id: monResult.sku.id,
        asset_number: monAssetNumber,
        serial_number: bundledMonitor.serial_number || null,
        status: ledgerStatus,
        source: 'legacy_purchase',
        legacy_purchase_id: monPurchaseRow.id,
        vendor_id: body.vendor_id,
        purchased_by_type: body.purchased_by_type,
        reserved_at: status === 'submitted' ? nowIso : null,
        received_at: status === 'submitted' ? nowIso : null,
      })
      if (monLedgerErr) throw new Error(monLedgerErr.message)

      await logAuditEvent({
        actor: { id: user.id, email: user.email, role: null },
        actionType: 'create',
        module: 'purchase_orders',
        tableName: 'purchases',
        recordId: monPurchaseRow.id,
        metadata: { bundled_with: createdIds[0] },
      })
    } catch (err: any) {
      bundledMonitorWarning = `Purchase saved, but the bundled monitor failed: ${err.message}`
    }
  }

  return NextResponse.json(
    { success: true, ids: createdIds, sku_id: sku.id, possible_duplicates: possibleDuplicates, bundled_monitor_warning: bundledMonitorWarning },
    { status: 201 }
  )
}

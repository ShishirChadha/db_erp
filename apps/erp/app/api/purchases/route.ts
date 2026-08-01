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

  return NextResponse.json(
    { success: true, ids: createdIds, sku_id: sku.id, possible_duplicates: possibleDuplicates },
    { status: 201 }
  )
}

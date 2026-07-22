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

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  return error ? null : user
}

// Statuses beyond which editing purchase-entry details through this door no longer
// makes sense -- the unit has moved on to sale or an RMA cycle.
const NOT_EDITABLE_STATUSES = ['sold', 'rma_sent', 'rma_returned', 'scrapped']

// ---------- PATCH: edit an existing legacy-door purchase entry ----------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: purchase } = await supabaseAdmin
    .from('purchases')
    .select('*')
    .eq('id', id)
    .single()
  if (!purchase) return NextResponse.json({ error: 'Purchase not found' }, { status: 404 })

  const { data: ledger } = await supabaseAdmin
    .from('asset_ledger')
    .select('id, status, asset_number')
    .eq('legacy_purchase_id', id)
    .maybeSingle()

  if (ledger && NOT_EDITABLE_STATUSES.includes(ledger.status)) {
    return NextResponse.json(
      { error: `Cannot edit: this unit is already '${ledger.status}'.` },
      { status: 400 }
    )
  }

  const body = await req.json()

  if (!body.purchase_date) return NextResponse.json({ error: 'Purchase date is required.' }, { status: 400 })
  if (!body.vendor_id) return NextResponse.json({ error: 'Please select a vendor.' }, { status: 400 })
  if (!body.type) return NextResponse.json({ error: 'Type is required.' }, { status: 400 })

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
      base_cost: body.base_price,
      sku_description: body.asset_description,
    })
    sku = result.sku
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to resolve SKU: ${err.message}` }, { status: 500 })
  }

  const targetStatus: 'draft' | 'submitted' = body.status === 'submitted' ? 'submitted' : 'draft'

  let finalAssetNumber: string | null = null
  const wasSubmitted = purchase.status === 'submitted' && purchase.asset_number

  if (targetStatus === 'draft') {
    finalAssetNumber = null
  } else if (!wasSubmitted) {
    // Finalizing a draft for the first time -- either honor a manually-typed number
    // (validated for uniqueness) or reserve a real one now.
    const manualOverride = (body.asset_number || '').trim()
    if (manualOverride) {
      const { data: existing } = await supabaseAdmin
        .from('asset_ledger')
        .select('id')
        .eq('asset_number', manualOverride)
        .maybeSingle()
      if (existing) {
        return NextResponse.json({ error: `Asset number "${manualOverride}" already exists.` }, { status: 400 })
      }
      finalAssetNumber = manualOverride
    } else {
      const prefix = getAssetPrefix(body.purchased_by_type, body.purchased_by_other)
      const { data: reserved, error: rpcErr } = await supabaseAdmin.rpc('reserve_assets', {
        p_prefix: prefix,
        purchased_by_type: body.purchased_by_type,
        qty: 1,
      })
      if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 })
      finalAssetNumber = reserved[0]
    }
  } else {
    // Already submitted -- keep the existing number unless the user typed a different
    // one, in which case it must not collide with anything in the shared ledger.
    const requested = (body.asset_number || '').trim()
    const original = (purchase.asset_number || '').trim()
    if (requested && requested !== original) {
      const { data: existing } = await supabaseAdmin
        .from('asset_ledger')
        .select('id')
        .eq('asset_number', requested)
        .neq('id', ledger?.id || '')
        .maybeSingle()
      if (existing) {
        return NextResponse.json({ error: `Asset number "${requested}" already exists.` }, { status: 400 })
      }
      finalAssetNumber = requested
    } else {
      finalAssetNumber = original
    }
  }

  const purchaseRecord = buildPurchaseRecord(body, {
    assetNumber: finalAssetNumber,
    serialNumber: body.serial_number || '',
    skuFullCode: sku.full_sku_code,
    brand,
    status: targetStatus,
  })

  const { error: updateErr } = await supabaseAdmin
    .from('purchases')
    .update(purchaseRecord)
    .eq('id', id)
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  const ledgerStatus = targetStatus === 'draft' ? 'draft' : mapStatusPurchaseToLedgerStatus(body.status_purchase)
  const ledgerUpdate = {
    sku_id: sku.id,
    asset_number: finalAssetNumber,
    serial_number: body.serial_number || null,
    status: ledgerStatus,
    vendor_id: body.vendor_id,
    purchased_by_type: body.purchased_by_type,
    cost_price: body.base_price,
    gst_percentage: body.gst,
    ...(targetStatus === 'submitted' && !wasSubmitted
      ? { reserved_at: new Date().toISOString(), received_at: new Date().toISOString() }
      : {}),
  }

  if (ledger) {
    const { error: ledgerErr } = await supabaseAdmin
      .from('asset_ledger')
      .update(ledgerUpdate)
      .eq('id', ledger.id)
    if (ledgerErr) return NextResponse.json({ error: ledgerErr.message }, { status: 500 })
  } else {
    // Pre-Phase-4 purchases row with no linked ledger row yet (shouldn't normally
    // happen for anything created after this route went live, but historical rows
    // migrated in Phase 2 are adopted in place under the PO chain, not here).
    await supabaseAdmin.from('asset_ledger').insert({ ...ledgerUpdate, source: 'legacy_purchase', legacy_purchase_id: id })
  }

  if (body.purchased_invoice_number) {
    await updateVendorInvoiceTotal(body.vendor_id, body.purchased_invoice_number)
  }

  return NextResponse.json({ success: true, asset_number: finalAssetNumber })
}

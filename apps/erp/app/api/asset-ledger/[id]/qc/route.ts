import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { resolveEffectiveSkuId } from '@/lib/effective-sku'
import { latestPaymentDatesBySaleId } from '@/lib/sale-payment-dates'

// ---------- GET: asset detail + existing QC checklist ----------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // This route uses supabaseAdmin (service role, bypasses RLS), so it must
  // enforce staff-only access itself -- getSessionUser() resolves to null for
  // anyone without an active `profiles` row, which is exactly a staff check
  // (web customers only ever have a `customer_profiles` row).
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, ['live_stock', 'stock'])) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data: asset, error: assetErr } = await supabaseAdmin
    .from('asset_ledger')
    .select(`
      id, asset_number, serial_number, status, created_at, notes,
      qc_grade, qc_status, qc_notes, qc_by, qc_at,
      warranty_type, warranty_start_date, warranty_duration_months, warranty_expiry_date,
      battery_health_percent, estimated_backup_hours,
      screen_condition, keyboard_condition, body_condition, included_accessories,
      po_id, po_item_id, sku_id, current_sku_id, vendor_id, cost_price,
      purchase_order_items (
        unit_price,
        sku_master ( full_sku_code, sku_description, category, brand, model_name, specifications ),
        purchase_orders ( po_number, vendor_name )
      )
    `)
    .eq('id', id)
    .single()

  if (assetErr || !asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
  }

  // PO number / vendor / unit cost -- owner-only, same redaction rule as everywhere
  // else in the app (CLAUDE.md: cost/vendor/margin never shown to employees). Legacy-
  // door rows (no purchase_order_items link) fall back to asset_ledger's own
  // vendor_id/cost_price, same fallback /api/stock already uses.
  let purchaseInfo: { po_number: string | null; vendor_name: string | null; unit_price: number | null } | null = null
  if (isOwner(sessionUser)) {
    const poItem = (asset as any).purchase_order_items
    const po = poItem?.purchase_orders
    let vendorName: string | null = po?.vendor_name || null
    if (!vendorName && asset.vendor_id) {
      const { data: vendor } = await supabaseAdmin.from('vendors').select('company_name').eq('id', asset.vendor_id).maybeSingle()
      vendorName = vendor?.company_name || null
    }
    purchaseInfo = {
      po_number: po?.po_number || null,
      vendor_name: vendorName,
      unit_price: poItem?.unit_price ?? asset.cost_price ?? null,
    }
  }

  // Legacy-door rows have no purchase_order_items link -- fall back to the SKU
  // directly referenced on the ledger row itself. This is still the AS-PURCHASED
  // spec at this point -- current_sku_id (below) is resolved separately.
  if (!(asset as any).purchase_order_items && asset.sku_id) {
    const { data: sku } = await supabaseAdmin
      .from('sku_master')
      .select('full_sku_code, sku_description, category, brand, model_name, specifications')
      .eq('id', asset.sku_id)
      .single()
    if (sku) (asset as any).purchase_order_items = { sku_master: sku }
  }

  // If this unit was reassigned after purchase (Change SKU), swap in its CURRENT
  // effective spec as the primary `purchase_order_items.sku_master` the page reads,
  // and preserve the as-purchased one separately as `purchased_sku` so the page can
  // show both instead of silently losing the purchase history from view.
  // This route's own purchase_order_items join only selects sku_master, not sku_id,
  // so resolveEffectiveSkuId's PO-item fallback isn't reachable here -- asset.sku_id
  // alone is already a reliable stand-in (confirmed always populated and equal to the
  // PO item's original sku_id at creation time, see lib/effective-sku.ts).
  const effectiveSkuId = resolveEffectiveSkuId({ sku_id: asset.sku_id, current_sku_id: asset.current_sku_id })
  if (asset.current_sku_id && effectiveSkuId) {
    (asset as any).purchased_sku = (asset as any).purchase_order_items?.sku_master || null
    const { data: currentSku } = await supabaseAdmin
      .from('sku_master')
      .select('full_sku_code, sku_description, category, brand, model_name, specifications')
      .eq('id', effectiveSkuId)
      .single()
    if (currentSku) (asset as any).purchase_order_items = { sku_master: currentSku }
  }

  const { data: checks } = await supabaseAdmin
    .from('asset_qc_checks')
    .select('id, check_item, result, notes, checked_at')
    .eq('asset_id', id)
    .order('checked_at', { ascending: true })

  // Surfaced so the asset detail page can show a "Sale Details" summary (and offer an
  // edit panel) for sold/invoiced/returned units without a second round trip.
  let saleId: string | null = null
  let saleSummary: {
    customer_name: string | null
    sale_total: number | null
    payment_status: string | null
    amount_paid: number | null
    payment_date: string | null
    bundled_accessories_display: { name: string; quantity: number }[]
  } | null = null
  if (['sold', 'invoiced', 'returned'].includes(asset.status)) {
    const { data: saleRow } = await supabaseAdmin
      .from('sales')
      .select('id, customer_name, sale_total, payment_status, amount_paid, bundled_accessories')
      .eq('asset_ledger_id', id)
      .eq('is_deleted', false)
      .maybeSingle()
    saleId = saleRow?.id ?? null
    if (saleRow) {
      // "Payment date" here is the same "latest installment" definition Sales
      // Ledger/Stock/Sold Accessories already use, not sales.created_at.
      const paymentDateBySaleId = await latestPaymentDatesBySaleId([saleRow.id])
      // Bundled accessories are stored inline on the sale row (sales.bundled_accessories
      // JSONB: [{accessory_id, quantity}]) -- resolve each to a display name, same
      // pattern as /api/sales and /api/stock.
      const bundled = Array.isArray(saleRow.bundled_accessories) ? saleRow.bundled_accessories : []
      const bundledIds = [...new Set(bundled.map((b: any) => b.accessory_id).filter(Boolean))]
      const { data: bundledSkus } = bundledIds.length
        ? await supabaseAdmin.from('sku_master').select('id, full_sku_code, sku_description').in('id', bundledIds)
        : { data: [] as any[] }
      const bundledSkuById = new Map((bundledSkus || []).map((s: any) => [s.id, s]))
      saleSummary = {
        customer_name: saleRow.customer_name,
        sale_total: saleRow.sale_total,
        payment_status: saleRow.payment_status,
        amount_paid: saleRow.amount_paid,
        payment_date: paymentDateBySaleId.get(saleRow.id) || null,
        bundled_accessories_display: bundled.map((b: any) => {
          const bsku = bundledSkuById.get(b.accessory_id)
          return { name: bsku?.sku_description || bsku?.full_sku_code || 'Accessory', quantity: b.quantity }
        }),
      }
    }
  }

  // vendor_id/cost_price, and purchase_order_items.unit_price/purchase_orders, were
  // only selected to compute purchase_info above -- strip them from the raw asset
  // spread so a non-owner response never carries cost/vendor data regardless of this
  // route's own gating bugs (purchase_info itself is already null for non-owners).
  const { vendor_id: _vendorId, cost_price: _costPrice, ...assetWithoutCostFields } = asset as any
  if (assetWithoutCostFields.purchase_order_items) {
    const { unit_price: _unitPrice, purchase_orders: _po, ...restPoItem } = assetWithoutCostFields.purchase_order_items
    assetWithoutCostFields.purchase_order_items = restPoItem
  }

  return NextResponse.json({ ...assetWithoutCostFields, checks: checks || [], sale_id: saleId, sale_summary: saleSummary, purchase_info: purchaseInfo })
}

// ---------- PUT: submit QC checklist + grade, transition status ----------
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, ['live_stock', 'stock'])) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data: asset } = await supabaseAdmin
    .from('asset_ledger')
    .select('status, warranty_type, warranty_start_date')
    .eq('id', id)
    .single()

  if (!asset || !['qc_pending', 'qc_passed', 'faulty'].includes(asset.status)) {
    return NextResponse.json(
      { error: `Cannot QC an asset in '${asset?.status}' status` },
      { status: 400 }
    )
  }

  const body = await req.json()
  const {
    checks, qc_grade, qc_notes,
    battery_health_percent, estimated_backup_hours,
    screen_condition, keyboard_condition, body_condition, included_accessories,
    warranty_duration_months,
  } = body as {
    checks: { check_item: string; result: 'pass' | 'fail' | 'na'; notes?: string }[]
    qc_grade: string | null
    qc_notes: string | null
    battery_health_percent?: number | null
    estimated_backup_hours?: number | null
    screen_condition?: string | null
    keyboard_condition?: string | null
    body_condition?: string | null
    included_accessories?: string | null
    warranty_duration_months?: number | null
  }

  if (!checks || checks.length === 0) {
    return NextResponse.json({ error: 'At least one checklist item is required' }, { status: 400 })
  }

  // Replace any prior checklist for this asset with this submission
  await supabaseAdmin.from('asset_qc_checks').delete().eq('asset_id', id)

  const { error: insertErr } = await supabaseAdmin.from('asset_qc_checks').insert(
    checks.map((c) => ({
      asset_id: id,
      check_item: c.check_item,
      result: c.result,
      notes: c.notes || null,
      checked_by: sessionUser.id,
    }))
  )
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  const anyFail = checks.some((c) => c.result === 'fail')
  const qcStatus = anyFail ? 'failed' : 'passed'
  const newStatus = anyFail ? 'faulty' : 'qc_passed'

  // The compute_warranty_expiry trigger only fires off warranty_start_date +
  // warranty_duration_months -- set a start date (today, if none already on
  // file) whenever a duration is being recorded, so warranty_expiry_date
  // actually gets computed rather than silently staying NULL.
  const warrantyUpdate: Record<string, unknown> = {}
  if (warranty_duration_months !== undefined) {
    warrantyUpdate.warranty_duration_months = warranty_duration_months
    if (warranty_duration_months != null) {
      warrantyUpdate.warranty_start_date = asset.warranty_start_date || new Date().toISOString().slice(0, 10)
      if (!asset.warranty_type) warrantyUpdate.warranty_type = 'in_house'
    }
  }

  const { error: updateErr } = await supabaseAdmin
    .from('asset_ledger')
    .update({
      qc_grade: qc_grade || null,
      qc_status: qcStatus,
      qc_notes: qc_notes || null,
      qc_by: sessionUser.id,
      qc_at: new Date().toISOString(),
      status: newStatus,
      battery_health_percent: battery_health_percent ?? null,
      estimated_backup_hours: estimated_backup_hours ?? null,
      screen_condition: screen_condition || null,
      keyboard_condition: keyboard_condition || null,
      body_condition: body_condition || null,
      included_accessories: included_accessories || null,
      ...warrantyUpdate,
    })
    .eq('id', id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'status_change',
    module: 'stock',
    tableName: 'asset_ledger',
    recordId: id,
    metadata: { from: asset.status, to: newStatus, qc_status: qcStatus, qc_grade: qc_grade || null },
  })

  return NextResponse.json({ success: true, qc_status: qcStatus, status: newStatus })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { getAssetPrefix } from '@/lib/stock-intake'
import { recalcPOTotals } from '@/lib/purchase-utils'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- POST: owner attaches existing employee-intake units to an ALREADY-CREATED PO ----------
// Same eligibility rule and asset-numbering mechanics as /api/purchase-orders/from-intake
// (source='employee_intake' && po_id IS NULL, any current status including 'sold' -- QC/sale
// timing and purchase-paperwork timing are independent) -- but that route only ever creates
// a brand-new PO. This is for the "I forgot one unit, the PO already exists" case: it always
// appends a NEW line item per SKU group (never merges into an existing line for the same SKU,
// since a merge would force a single blended price/GST across possibly-different batches --
// multiple lines with the same SKU on one PO is already normal, e.g. the wizard allows it).
// No new stock_movements row -- the unit was already counted as stock at intake time.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id: poId } = await params
  const body = await req.json()
  const { asset_ledger_ids, cost_inputs, confirm_despite_invoice } = body

  if (!Array.isArray(asset_ledger_ids) || asset_ledger_ids.length === 0) {
    return NextResponse.json({ error: 'Select at least one unit.' }, { status: 400 })
  }
  if (!Array.isArray(cost_inputs) || cost_inputs.length === 0) {
    return NextResponse.json({ error: 'cost_inputs (per-SKU cost/GST) is required.' }, { status: 400 })
  }

  const { data: po } = await supabaseAdmin
    .from('purchase_orders')
    .select('po_status, po_number, vendor_id, purchased_by_type, purchased_by_other')
    .eq('id', poId)
    .single()
  if (!po) return NextResponse.json({ error: 'Purchase Order not found' }, { status: 404 })
  if (po.po_status === 'cancelled') {
    return NextResponse.json({ error: 'A cancelled PO cannot be edited.' }, { status: 400 })
  }

  // Same frozen-snapshot guard every other PO-correction endpoint uses.
  const { data: existingInvoices } = await supabaseAdmin
    .from('invoices')
    .select('id, invoice_number')
    .eq('po_id', poId)
    .order('created_at', { ascending: false })
    .limit(1)
  const invoice = existingInvoices?.[0]
  if (invoice && !confirm_despite_invoice) {
    return NextResponse.json({
      error: `This PO is already invoiced (${invoice.invoice_number}) -- adding units will NOT update that invoice, which will then disagree with the live record. Confirm to proceed anyway.`,
      error_code: 'already_invoiced',
    }, { status: 409 })
  }

  const { data: units, error: unitsErr } = await supabaseAdmin
    .from('asset_ledger')
    .select('id, sku_id, serial_number, status, po_id, source')
    .in('id', asset_ledger_ids)
  if (unitsErr) return NextResponse.json({ error: unitsErr.message }, { status: 500 })
  if (!units || units.length !== asset_ledger_ids.length) {
    return NextResponse.json({ error: 'One or more units could not be found.' }, { status: 404 })
  }
  const invalid = units.filter((u) => u.source !== 'employee_intake' || u.po_id !== null)
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `${invalid.length} of the selected units are not eligible (already attached to a PO, or not an intake unit).` },
      { status: 400 }
    )
  }

  const costBySkuId = new Map(cost_inputs.map((c: any) => [c.sku_id, c]))
  const groups = new Map<string, typeof units>()
  for (const unit of units) {
    if (!groups.has(unit.sku_id)) groups.set(unit.sku_id, [])
    groups.get(unit.sku_id)!.push(unit)
  }
  for (const skuId of groups.keys()) {
    if (!costBySkuId.has(skuId)) {
      return NextResponse.json({ error: `Missing cost/GST input for SKU ${skuId}.` }, { status: 400 })
    }
  }

  const { data: maxItem } = await supabaseAdmin
    .from('purchase_order_items')
    .select('line_item_number')
    .eq('po_id', poId)
    .order('line_item_number', { ascending: false })
    .limit(1)
  let lineItemNumber = (maxItem?.[0]?.line_item_number || 0) + 1

  const prefix = getAssetPrefix(po.purchased_by_type, po.purchased_by_other)
  const attachedItemIds: string[] = []

  for (const [skuId, groupUnits] of groups) {
    const costInput: any = costBySkuId.get(skuId)
    const qty = groupUnits.length

    const { data: skuRow } = await supabaseAdmin
      .from('sku_master')
      .select('base_sku_code, variant_number')
      .eq('id', skuId)
      .single()

    const { data: reserved, error: rpcErr } = await supabaseAdmin.rpc('reserve_assets', {
      p_prefix: prefix,
      purchased_by_type: po.purchased_by_type,
      qty,
    })
    if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 })

    const costPrice = costInput.cost_price
    const gstPct = costInput.gst_percentage ?? 18
    const unitTotal = costPrice * qty
    const gstAmount = unitTotal * gstPct / 100
    const lineTotal = unitTotal + gstAmount

    const { data: item, error: itemErr } = await supabaseAdmin
      .from('purchase_order_items')
      .insert({
        po_id: poId,
        line_item_number: lineItemNumber++,
        sku_id: skuId,
        base_sku_code: skuRow?.base_sku_code,
        variant_number: skuRow?.variant_number,
        quantity: qty,
        base_price: costPrice,
        unit_price: costPrice,
        gst_percentage: gstPct,
        gst_amount: gstAmount,
        line_total: lineTotal,
        asset_prefix: prefix,
        asset_numbers_reserved: reserved,
        serial_numbers: groupUnits.map((u) => u.serial_number).filter(Boolean),
      })
      .select('id')
      .single()
    if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 })
    attachedItemIds.push(item.id)

    for (let i = 0; i < groupUnits.length; i++) {
      await supabaseAdmin
        .from('asset_ledger')
        .update({
          asset_number: reserved[i],
          po_id: poId,
          po_item_id: item.id,
          cost_price: costPrice,
          vendor_id: po.vendor_id,
          gst_percentage: gstPct,
          purchased_by_type: po.purchased_by_type,
          reserved_at: new Date().toISOString(),
        })
        .eq('id', groupUnits[i].id)
    }
  }

  await recalcPOTotals(poId)

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'purchase_orders',
    tableName: 'purchase_orders',
    recordId: poId,
    recordLabel: po.po_number,
    reason: `Attached ${units.length} existing unit(s) from stock to this PO.`,
  })

  return NextResponse.json({ success: true, attached_count: units.length, item_ids: attachedItemIds })
}

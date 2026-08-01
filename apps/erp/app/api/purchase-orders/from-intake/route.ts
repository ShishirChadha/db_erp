import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { getAssetPrefix } from '@/lib/stock-intake'
import { recalcPOTotals, getVendorName } from '@/lib/purchase-utils'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- POST: owner attaches existing employee-intake units to a new PO ----------
// This is the only place these units ever get a real asset number -- intake
// deliberately leaves it null (see /api/stock-intake). Units can be in ANY status when
// this runs, including already 'sold': QC/sale timing and purchase-paperwork timing are
// independent, so this never touches status, only numbers + cost/vendor/po linkage.
// No new stock_movements row -- the unit was already counted as stock at intake time.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const {
    asset_ledger_ids,
    vendor_id,
    po_date,
    purchase_type,
    purchased_by_type,
    purchased_by_other,
    cost_inputs, // [{ sku_id, cost_price, gst_percentage }]
  } = body

  if (!Array.isArray(asset_ledger_ids) || asset_ledger_ids.length === 0) {
    return NextResponse.json({ error: 'Select at least one unit.' }, { status: 400 })
  }
  if (!vendor_id) return NextResponse.json({ error: 'vendor_id is required.' }, { status: 400 })
  if (!po_date) return NextResponse.json({ error: 'po_date is required.' }, { status: 400 })
  if (!Array.isArray(cost_inputs) || cost_inputs.length === 0) {
    return NextResponse.json({ error: 'cost_inputs (per-SKU cost/GST) is required.' }, { status: 400 })
  }

  const { data: units, error: unitsErr } = await supabaseAdmin
    .from('asset_ledger')
    .select('id, sku_id, serial_number, status, po_id, source')
    .in('id', asset_ledger_ids)

  if (unitsErr) return NextResponse.json({ error: unitsErr.message }, { status: 500 })
  if (!units || units.length !== asset_ledger_ids.length) {
    return NextResponse.json({ error: 'One or more units could not be found.' }, { status: 404 })
  }
  const invalid = units.filter(u => u.source !== 'employee_intake' || u.po_id !== null)
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `${invalid.length} of the selected units are not eligible (already attached to a PO, or not an intake unit).` },
      { status: 400 }
    )
  }

  const purchasedByType = purchased_by_type || 'Digitalbluez'
  const costBySkuId = new Map(cost_inputs.map((c: any) => [c.sku_id, c]))

  // Group units by sku_id.
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

  const { data: poNumber, error: numErr } = await supabaseAdmin.rpc('generate_po_number')
  if (numErr) return NextResponse.json({ error: numErr.message }, { status: 500 })

  const vendorName = await getVendorName(vendor_id)

  const { data: po, error: poErr } = await supabaseAdmin
    .from('purchase_orders')
    .insert({
      po_number: poNumber,
      po_date,
      vendor_id,
      vendor_name: vendorName,
      purchase_type: purchase_type || 'GST',
      purchased_by_type: purchasedByType,
      purchased_by_other,
      po_status: 'received',
      created_by: sessionUser.id,
    })
    .select()
    .single()

  if (poErr) return NextResponse.json({ error: poErr.message }, { status: 500 })

  let lineItemNumber = 1
  for (const [skuId, groupUnits] of groups) {
    const costInput: any = costBySkuId.get(skuId)
    const qty = groupUnits.length

    const { data: skuRow } = await supabaseAdmin
      .from('sku_master')
      .select('base_sku_code, variant_number')
      .eq('id', skuId)
      .single()

    const prefix = getAssetPrefix(purchasedByType, purchased_by_other)
    const { data: reserved, error: rpcErr } = await supabaseAdmin.rpc('reserve_assets', {
      p_prefix: prefix,
      purchased_by_type: purchasedByType,
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
        po_id: po.id,
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
        serial_numbers: groupUnits.map(u => u.serial_number).filter(Boolean),
      })
      .select('id')
      .single()

    if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 })

    // Pair each reserved number with one unit in this group; status is left untouched.
    for (let i = 0; i < groupUnits.length; i++) {
      await supabaseAdmin
        .from('asset_ledger')
        .update({
          asset_number: reserved[i],
          po_id: po.id,
          po_item_id: item.id,
          cost_price: costPrice,
          vendor_id,
          gst_percentage: gstPct,
          purchased_by_type: purchasedByType,
          reserved_at: new Date().toISOString(),
        })
        .eq('id', groupUnits[i].id)
    }
  }

  await recalcPOTotals(po.id)

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'purchase_orders',
    tableName: 'purchase_orders',
    recordId: po.id,
    recordLabel: poNumber,
  })

  return NextResponse.json({ success: true, po_id: po.id, po_number: poNumber }, { status: 201 })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { getAssetPrefix } from '@/lib/stock-intake'
import { isSerializedCategory } from '@/lib/sku-categories'
import { recalcPOTotals } from '@/lib/purchase-utils'
import { logFieldCorrections } from '@/lib/field-corrections'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- POST: owner moves one already-attached serialized unit from this PO ----------
// ---------- onto a different existing PO ----------
// For the "I mistakenly put the 25th's laptop on the 10th's PO" case -- a pure
// paperwork correction, never touches the unit's own status/asset_number/serial_number.
// Shrinks the source line by exactly this one unit (deleting the line entirely if that
// was its last unit -- a PO line can't have quantity 0) and creates a fresh
// single-quantity line on the target PO, same shape /attach-units already creates.
// Fungible/accessory SKUs have no per-unit identity to move -- that's a quantity
// correction on the two lines directly (already supported by the items PATCH
// endpoint), not this route.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id: sourcePoId } = await params
  const body = await req.json()
  const { asset_number, target_po_id, confirm_despite_invoice } = body

  if (!asset_number) return NextResponse.json({ error: 'asset_number is required.' }, { status: 400 })
  if (!target_po_id) return NextResponse.json({ error: 'target_po_id is required.' }, { status: 400 })
  if (target_po_id === sourcePoId) return NextResponse.json({ error: 'Target PO must be different from the current PO.' }, { status: 400 })

  const { data: asset, error: assetErr } = await supabaseAdmin
    .from('asset_ledger')
    .select('id, po_id, po_item_id, sku_id, serial_number, asset_number, cost_price, gst_percentage, sku:sku_master ( category )')
    .eq('asset_number', asset_number)
    .single()
  if (assetErr || !asset) return NextResponse.json({ error: 'Unit not found.' }, { status: 404 })
  if (asset.po_id !== sourcePoId) return NextResponse.json({ error: 'That unit is not on this PO.' }, { status: 400 })
  if (!isSerializedCategory((asset as any).sku?.category)) {
    return NextResponse.json({ error: 'This SKU is quantity-only -- move accessory stock by correcting the quantity on each PO line instead.' }, { status: 400 })
  }

  const [{ data: sourcePo }, { data: targetPo }] = await Promise.all([
    supabaseAdmin.from('purchase_orders').select('po_status, po_number').eq('id', sourcePoId).single(),
    supabaseAdmin.from('purchase_orders').select('po_status, po_number, vendor_id, purchased_by_type, purchased_by_other').eq('id', target_po_id).single(),
  ])
  if (!sourcePo) return NextResponse.json({ error: 'Source PO not found.' }, { status: 404 })
  if (!targetPo) return NextResponse.json({ error: 'Target PO not found.' }, { status: 404 })
  if (targetPo.po_status === 'cancelled') return NextResponse.json({ error: 'Target PO is cancelled.' }, { status: 400 })

  const { data: invoices } = await supabaseAdmin
    .from('invoices')
    .select('id, invoice_number, po_id')
    .in('po_id', [sourcePoId, target_po_id])
    .order('created_at', { ascending: false })
  if (invoices && invoices.length > 0 && !confirm_despite_invoice) {
    const invoicedPoNumbers = [...new Set(invoices.map((inv) => (inv.po_id === sourcePoId ? sourcePo.po_number : targetPo.po_number)))]
    return NextResponse.json({
      error: `${invoicedPoNumbers.join(' and ')} already has a Purchase Invoice -- moving this unit will NOT update it, which will then disagree with the live record. Confirm to proceed anyway.`,
      error_code: 'already_invoiced',
    }, { status: 409 })
  }

  const { data: sourceItem } = await supabaseAdmin
    .from('purchase_order_items')
    .select('*')
    .eq('id', asset.po_item_id)
    .single()
  if (!sourceItem) return NextResponse.json({ error: 'Source line item not found.' }, { status: 404 })

  // ---- Create a fresh single-quantity line on the target PO for this exact unit ----
  // (before touching the source line -- asset_ledger.po_item_id is repointed onto this
  // new row further down, which must happen before the source line can be safely
  // deleted below, otherwise a still-live FK reference blocks that delete.)
  const { data: skuRow } = await supabaseAdmin
    .from('sku_master')
    .select('base_sku_code, variant_number')
    .eq('id', asset.sku_id)
    .single()
  const { data: maxItem } = await supabaseAdmin
    .from('purchase_order_items')
    .select('line_item_number')
    .eq('po_id', target_po_id)
    .order('line_item_number', { ascending: false })
    .limit(1)
  const lineItemNumber = (maxItem?.[0]?.line_item_number || 0) + 1

  const costPrice = asset.cost_price ?? sourceItem.base_price
  const gstPct = asset.gst_percentage ?? sourceItem.gst_percentage
  const gstAmount = costPrice * gstPct / 100
  const lineTotal = costPrice + gstAmount

  const { data: newItem, error: newItemErr } = await supabaseAdmin
    .from('purchase_order_items')
    .insert({
      po_id: target_po_id,
      line_item_number: lineItemNumber,
      sku_id: asset.sku_id,
      base_sku_code: skuRow?.base_sku_code,
      variant_number: skuRow?.variant_number,
      quantity: 1,
      base_price: costPrice,
      unit_price: costPrice,
      gst_percentage: gstPct,
      gst_amount: gstAmount,
      line_total: lineTotal,
      asset_prefix: getAssetPrefix(targetPo.purchased_by_type, targetPo.purchased_by_other),
      asset_numbers_reserved: [asset_number],
      serial_numbers: asset.serial_number ? [asset.serial_number] : [],
    })
    .select('id')
    .single()
  if (newItemErr) return NextResponse.json({ error: newItemErr.message }, { status: 500 })

  // Paperwork only -- status/asset_number/serial_number never touched.
  const { error: assetUpdateErr } = await supabaseAdmin
    .from('asset_ledger')
    .update({
      po_id: target_po_id,
      po_item_id: newItem.id,
      vendor_id: targetPo.vendor_id,
      purchased_by_type: targetPo.purchased_by_type,
    })
    .eq('id', asset.id)
  if (assetUpdateErr) return NextResponse.json({ error: assetUpdateErr.message }, { status: 500 })

  // ---- Shrink (or delete) the source line by exactly this one unit ----
  // Safe now: the moved unit's asset_ledger row no longer references sourceItem.id.
  const newSourceQty = sourceItem.quantity - 1
  if (newSourceQty <= 0) {
    const { error: delErr } = await supabaseAdmin.from('purchase_order_items').delete().eq('id', sourceItem.id)
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
  } else {
    const unitTotal = sourceItem.base_price * newSourceQty
    const gstAmount = unitTotal * sourceItem.gst_percentage / 100
    const { error: shrinkErr } = await supabaseAdmin
      .from('purchase_order_items')
      .update({
        quantity: newSourceQty,
        gst_amount: gstAmount,
        line_total: unitTotal + gstAmount,
        asset_numbers_reserved: (sourceItem.asset_numbers_reserved || []).filter((a: string) => a !== asset_number),
        serial_numbers: (sourceItem.serial_numbers || []).filter((s: string) => s !== asset.serial_number),
      })
      .eq('id', sourceItem.id)
    if (shrinkErr) return NextResponse.json({ error: shrinkErr.message }, { status: 500 })
  }

  const fieldCorrectionIds = await logFieldCorrections(
    'asset_ledger',
    asset.id,
    [{ field: 'po_id', oldValue: sourcePoId, newValue: target_po_id }],
    sessionUser.id,
    `Moved from ${sourcePo.po_number} to ${targetPo.po_number}`
  )

  await Promise.all([recalcPOTotals(sourcePoId), recalcPOTotals(target_po_id)])

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'purchase_orders',
    tableName: 'asset_ledger',
    recordId: asset.id,
    recordLabel: `${asset_number} (${asset.serial_number || 'no serial'})`,
    fieldCorrectionIds,
    reason: `Moved unit ${asset_number} from ${sourcePo.po_number} to ${targetPo.po_number}`,
  })

  return NextResponse.json({ success: true, target_po_id, new_item_id: newItem.id })
}

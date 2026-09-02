import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { isSerializedCategory } from '@/lib/sku-categories'
import { recalcPOTotals } from '@/lib/purchase-utils'
import { logFieldCorrections } from '@/lib/field-corrections'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- POST: owner removes one serialized unit from a PO entirely ----------
// Sibling of move-unit (same source-line shrink/delete mechanics), except there's no
// target PO -- the unit's fate depends on where it came from:
//   - source='employee_intake' (or 'legacy_purchase'): the unit existed before this PO
//     ever touched it, so removal just reverts every paperwork field this PO's attach
//     step wrote (po_id/po_item_id/asset_number/cost_price/vendor_id/gst_percentage/
//     reserved_at) -- it goes back to exactly the unattached state it was in before,
//     ready to be attached again later. serial_number/status/QC are never touched.
//   - source='purchase_order' with no serial number yet: this unit never existed
//     independently of this PO -- it's just a reserved asset-number placeholder from
//     reserve_assets(), nothing physical behind it -- so removal hard-deletes the row.
//   - source='purchase_order' with a serial number already recorded: a real physical
//     unit whose only paperwork trail is this PO. There's no "unattached" state for it
//     to revert to (asset_number requires a real PO to exist -- business-rules), and
//     deleting it would destroy a real inventory record. Rejected -- use move-unit to
//     put it on a different PO instead.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id: poId } = await params
  const body = await req.json()
  const { asset_number, confirm_despite_invoice } = body

  if (!asset_number) return NextResponse.json({ error: 'asset_number is required.' }, { status: 400 })

  const { data: asset, error: assetErr } = await supabaseAdmin
    .from('asset_ledger')
    .select('id, po_id, po_item_id, sku_id, serial_number, asset_number, source, sku:sku_master ( category )')
    .eq('asset_number', asset_number)
    .single()
  if (assetErr || !asset) return NextResponse.json({ error: 'Unit not found.' }, { status: 404 })
  if (asset.po_id !== poId) return NextResponse.json({ error: 'That unit is not on this PO.' }, { status: 400 })
  if (!isSerializedCategory((asset as any).sku?.category)) {
    return NextResponse.json({ error: 'This SKU is quantity-only -- remove accessory quantity by correcting the PO line instead.' }, { status: 400 })
  }
  if (asset.source === 'purchase_order' && asset.serial_number) {
    return NextResponse.json({
      error: 'This unit has no purchase order of its own to revert to -- it was only ever created for this PO. Move it to a different PO instead of removing it.',
    }, { status: 400 })
  }

  const { data: po } = await supabaseAdmin
    .from('purchase_orders')
    .select('po_status, po_number')
    .eq('id', poId)
    .single()
  if (!po) return NextResponse.json({ error: 'Purchase Order not found' }, { status: 404 })
  if (po.po_status === 'cancelled') {
    return NextResponse.json({ error: 'A cancelled PO cannot be edited.' }, { status: 400 })
  }

  const { data: existingInvoices } = await supabaseAdmin
    .from('invoices')
    .select('id, invoice_number')
    .eq('po_id', poId)
    .order('created_at', { ascending: false })
    .limit(1)
  const invoice = existingInvoices?.[0]
  if (invoice && !confirm_despite_invoice) {
    return NextResponse.json({
      error: `This PO is already invoiced (${invoice.invoice_number}) -- removing a unit will NOT update that invoice, which will then disagree with the live record. Confirm to proceed anyway.`,
      error_code: 'already_invoiced',
    }, { status: 409 })
  }

  const { data: sourceItem } = await supabaseAdmin
    .from('purchase_order_items')
    .select('*')
    .eq('id', asset.po_item_id)
    .single()
  if (!sourceItem) return NextResponse.json({ error: 'Line item not found' }, { status: 404 })

  // Either revert the unit to its pre-attach unattached state, or delete it outright
  // if it never had one -- before touching the source line, same FK-safety ordering
  // move-unit uses (the line can't be deleted while an asset_ledger row still
  // references it).
  if (asset.source === 'purchase_order') {
    const { error: delAssetErr } = await supabaseAdmin.from('asset_ledger').delete().eq('id', asset.id)
    if (delAssetErr) return NextResponse.json({ error: delAssetErr.message }, { status: 500 })
  } else {
    const { error: revertErr } = await supabaseAdmin
      .from('asset_ledger')
      .update({
        po_id: null,
        po_item_id: null,
        asset_number: null,
        cost_price: null,
        vendor_id: null,
        gst_percentage: null,
        purchased_by_type: null,
        reserved_at: null,
      })
      .eq('id', asset.id)
    if (revertErr) return NextResponse.json({ error: revertErr.message }, { status: 500 })
  }

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
    [{ field: 'po_id', oldValue: poId, newValue: null }],
    sessionUser.id,
    `Removed from ${po.po_number}`
  )

  await recalcPOTotals(poId)

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'purchase_orders',
    tableName: 'asset_ledger',
    recordId: asset.id,
    recordLabel: `${asset_number} (${asset.serial_number || 'no serial'})`,
    fieldCorrectionIds,
    reason: `Removed unit ${asset_number} from ${po.po_number}`,
  })

  return NextResponse.json({ success: true })
}

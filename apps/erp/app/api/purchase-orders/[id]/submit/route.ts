import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isManagerOrAbove } from '@/lib/auth/session'
import { isSerializedCategory } from '@/lib/sku-categories'

// Submitting a draft PO is the "approval" step -- it reserves asset numbers and locks in
// the vendor/cost commitment, so managers may do this (per the manager-role requirements)
// even though every other PO action (create/list/edit) stays owner-only.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: poId } = await params

  const sessionUser = await getSessionUser(req)
  if (!isManagerOrAbove(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const user = { id: sessionUser.id }

  const { data: po } = await supabaseAdmin
    .from('purchase_orders')
    .select('purchased_by_type, po_status, vendor_id')
    .eq('id', poId)
    .single()

  if (!po || po.po_status !== 'draft') {
    return NextResponse.json({ error: 'PO not in draft' }, { status: 400 })
  }

  const { data: items } = await supabaseAdmin
    .from('purchase_order_items')
    .select('*')
    .eq('po_id', poId)

  // Guard against null items
  if (!items) {
    return NextResponse.json({ error: 'No line items found' }, { status: 400 })
  }

  // Serialized categories (laptops/desktops/monitors/tablets) reserve one asset number
  // and one asset_ledger row per unit here. Fungible categories (accessories) have no
  // per-unit identity -- they're a single quantity-based line that just moves stock on
  // receipt, so submit is a no-op for them (nothing to reserve). This is what makes
  // buying accessories through the normal PO -> receive -> Purchase-Invoice flow work
  // without minting bogus asset numbers. See docs/decisions.md and lib/sku-categories.ts.
  const skuIds = [...new Set(items.map((i) => i.sku_id))]
  const { data: skuRows } = await supabaseAdmin
    .from('sku_master')
    .select('id, category')
    .in('id', skuIds)
  const categoryById = new Map((skuRows || []).map((s) => [s.id, s.category]))

  for (const item of items) {
    if (!isSerializedCategory(categoryById.get(item.sku_id))) continue // fungible line: nothing to reserve

    let prefix: string
    switch (po.purchased_by_type) {
      case 'Digitalbluez': prefix = 'DBAS'; break
      case 'Techtenth': prefix = 'TTAS'; break
      case 'Cash': prefix = 'CSAS'; break
      default: prefix = 'OTHR'; break
    }

    const { data: assets, error: rpcErr } = await supabaseAdmin.rpc('reserve_assets', {
      p_prefix: prefix,
      purchased_by_type: po.purchased_by_type,
      qty: item.quantity
    })
    if (rpcErr) throw rpcErr

    await supabaseAdmin
      .from('purchase_order_items')
      .update({ asset_prefix: prefix, asset_numbers_reserved: assets })
      .eq('id', item.id)

    const mappings = assets.map((asset: string) => ({
      po_id: poId,
      po_item_id: item.id,
      sku_id: item.sku_id,
      asset_number: asset,
      status: 'reserved',
      reserved_at: new Date().toISOString(),
      source: 'purchase_order',
      vendor_id: po.vendor_id,
      purchased_by_type: po.purchased_by_type,
      cost_price: item.unit_price,
      gst_percentage: item.gst_percentage
    }))
    await supabaseAdmin.from('asset_ledger').insert(mappings)
  }

  // Update PO status and track who submitted
  await supabaseAdmin
    .from('purchase_orders')
    .update({
      po_status: 'submitted',
      updated_by: user.id
    })
    .eq('id', poId)

  return NextResponse.json({ success: true })
}
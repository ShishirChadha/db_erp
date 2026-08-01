import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { recalcPOTotals, getVendorName } from '@/lib/purchase-utils'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- GET: owner's backlog of accessory SKUs with stock received but no PO yet ----------
// Same "needs paperwork" concept as /api/stock-intake's GET, just for quantity-only
// SKUs: sums unattached 'receipt' movements per SKU instead of counting asset_ledger
// rows with po_id IS NULL.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data: movements, error } = await supabaseAdmin
    .from('stock_movements')
    .select('sku_id, quantity_change, sku_master(full_sku_code, sku_description, category)')
    .eq('movement_type', 'receipt')
    .is('po_id', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const bySkuId = new Map<string, { sku_id: string; full_sku_code: string; sku_description: string; category: string; quantity: number }>()
  for (const m of movements || []) {
    const sku: any = m.sku_master
    if (!sku) continue
    const existing = bySkuId.get(m.sku_id)
    if (existing) {
      existing.quantity += m.quantity_change
    } else {
      bySkuId.set(m.sku_id, {
        sku_id: m.sku_id,
        full_sku_code: sku.full_sku_code,
        sku_description: sku.sku_description,
        category: sku.category,
        quantity: m.quantity_change,
      })
    }
  }

  return NextResponse.json([...bySkuId.values()].filter((r) => r.quantity > 0))
}

// ---------- POST: owner attaches a real vendor/PO/cost to an accessory SKU's ----------
// ---------- unattached stock-in movements ----------
// Mirrors /api/purchase-orders/from-intake's "employee stock-in now, owner paperwork
// later" pattern, but for fungible/quantity-only SKUs (RAM/SSD/CPU/GPU/KBD/MOUSE/ACC)
// that have no per-unit asset_ledger row -- so there's no reserve_assets() call and no
// asset numbers to mint, just one purchase_order_items line with quantity = the sum of
// whatever 'receipt' movements are still unattached (po_id IS NULL) for this SKU.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const {
    sku_id, vendor_id, po_date, purchase_type,
    purchased_by_type, purchased_by_other,
    cost_price, gst_percentage,
  } = body

  if (!sku_id) return NextResponse.json({ error: 'sku_id is required.' }, { status: 400 })
  if (!vendor_id) return NextResponse.json({ error: 'vendor_id is required.' }, { status: 400 })
  if (!po_date) return NextResponse.json({ error: 'po_date is required.' }, { status: 400 })
  if (cost_price === undefined || cost_price === null || cost_price < 0) {
    return NextResponse.json({ error: 'A valid cost_price is required.' }, { status: 400 })
  }

  const { data: movements, error: movementsErr } = await supabaseAdmin
    .from('stock_movements')
    .select('id, quantity_change')
    .eq('sku_id', sku_id)
    .eq('movement_type', 'receipt')
    .is('po_id', null)

  if (movementsErr) return NextResponse.json({ error: movementsErr.message }, { status: 500 })
  const qty = (movements || []).reduce((sum, m) => sum + m.quantity_change, 0)
  if (!movements || movements.length === 0 || qty <= 0) {
    return NextResponse.json({ error: 'Nothing unattached to a PO for this SKU.' }, { status: 400 })
  }

  const { data: skuRow, error: skuErr } = await supabaseAdmin
    .from('sku_master')
    .select('base_sku_code, variant_number')
    .eq('id', sku_id)
    .single()
  if (skuErr || !skuRow) return NextResponse.json({ error: 'SKU not found.' }, { status: 404 })

  const purchasedByType = purchased_by_type || 'Digitalbluez'
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

  const gstPct = gst_percentage ?? 18
  const unitTotal = cost_price * qty
  const gstAmount = unitTotal * gstPct / 100
  const lineTotal = unitTotal + gstAmount

  const { data: item, error: itemErr } = await supabaseAdmin
    .from('purchase_order_items')
    .insert({
      po_id: po.id,
      line_item_number: 1,
      sku_id,
      base_sku_code: skuRow.base_sku_code,
      variant_number: skuRow.variant_number,
      quantity: qty,
      base_price: cost_price,
      unit_price: cost_price,
      gst_percentage: gstPct,
      gst_amount: gstAmount,
      line_total: lineTotal,
    })
    .select('id')
    .single()

  if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 })

  // Link every previously-unattached movement to this PO/line so it stops showing
  // up in the "needs PO" backlog, and record the now-known cost on the SKU itself
  // (accessories have no per-unit cost_price to update, unlike asset_ledger).
  await supabaseAdmin
    .from('stock_movements')
    .update({ po_id: po.id, po_item_id: item.id })
    .in('id', movements.map((m) => m.id))

  await supabaseAdmin
    .from('sku_master')
    .update({ base_cost: cost_price })
    .eq('id', sku_id)

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

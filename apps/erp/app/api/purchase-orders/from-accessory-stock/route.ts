import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { recalcPOTotals, getVendorName } from '@/lib/purchase-utils'
import { logAuditEvent } from '@/lib/audit-log'
import { isSerializedCategory } from '@/lib/sku-categories'
import { claimAccessoryBacklog } from '@/lib/accessory-movements'

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
    // Laptops/desktops/etc. also get a 'receipt' movement on intake (sku_master.
    // quantity_in_stock is a universal cache across every category), but they're
    // tracked per-unit via asset_ledger -- their "still needs a PO" backlog is
    // /api/stock-intake's, not this one. Without this filter a serialized SKU could
    // show up here too, colliding with its own asset-based attach flow.
    if (!sku || isSerializedCategory(sku.category)) continue
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
// asset numbers to mint, just one purchase_order_items line per SKU with quantity =
// the sum of whatever 'receipt' movements are still unattached (po_id IS NULL) for it.
//
// Accepts either the original single-SKU shape ({ sku_id, cost_price, gst_percentage })
// -- unchanged, still used by the Accessories page's one-SKU-at-a-time dialog -- or a
// multi-line { sku_inputs: [{ sku_id, cost_price, gst_percentage }] } shape, added so
// one vendor invoice covering several accessory SKUs can land on a single PO (see
// docs/decisions.md, reconciliation invoice-recon commit path) instead of the invoice
// recon flow having to create one PO per accessory SKU, which would then be unable to
// attach a single PI to the invoice's one real invoice_number (globally UNIQUE on
// `invoices`, so it can never be reused across more than one PI/PO).
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const {
    sku_id, cost_price, gst_percentage, quantity, // legacy single-SKU shape
    sku_inputs, // new multi-SKU shape: [{ sku_id, cost_price, gst_percentage, quantity? }]
    vendor_id, po_date, purchase_type,
    purchased_by_type, purchased_by_other,
  } = body

  const lineInputs: { sku_id: string; cost_price: number; gst_percentage?: number; quantity?: number }[] =
    Array.isArray(sku_inputs) && sku_inputs.length > 0
      ? sku_inputs
      : sku_id
        ? [{ sku_id, cost_price, gst_percentage, quantity }]
        : []

  if (lineInputs.length === 0) return NextResponse.json({ error: 'sku_id (or sku_inputs) is required.' }, { status: 400 })
  if (!vendor_id) return NextResponse.json({ error: 'vendor_id is required.' }, { status: 400 })
  if (!po_date) return NextResponse.json({ error: 'po_date is required.' }, { status: 400 })
  for (const li of lineInputs) {
    if (li.cost_price === undefined || li.cost_price === null || li.cost_price < 0) {
      return NextResponse.json({ error: `A valid cost_price is required for SKU ${li.sku_id}.` }, { status: 400 })
    }
  }
  const skuIds = lineInputs.map((li) => li.sku_id)
  const duplicateSkuIds = skuIds.filter((id, i) => skuIds.indexOf(id) !== i)
  if (duplicateSkuIds.length > 0) {
    return NextResponse.json({ error: 'Each SKU can only appear once per call.' }, { status: 400 })
  }

  // Resolve unattached quantity + SKU code per line up front, so the whole request
  // fails before any PO is created if any one SKU has nothing to attach. `quantity`
  // is optional -- omitted (or >= the full backlog) attaches everything unattached,
  // same as before; a smaller value formalizes only part of the backlog, leaving the
  // rest for a later PO.
  const resolvedLines: { sku_id: string; cost_price: number; gst_percentage: number; qty: number; base_sku_code: string; variant_number: number }[] = []
  for (const li of lineInputs) {
    const { data: movements, error: movementsErr } = await supabaseAdmin
      .from('stock_movements')
      .select('quantity_change')
      .eq('sku_id', li.sku_id)
      .eq('movement_type', 'receipt')
      .is('po_id', null)
    if (movementsErr) return NextResponse.json({ error: movementsErr.message }, { status: 500 })
    const available = (movements || []).reduce((sum, m) => sum + m.quantity_change, 0)
    if (!movements || movements.length === 0 || available <= 0) {
      return NextResponse.json({ error: `Nothing unattached to a PO for SKU ${li.sku_id}.` }, { status: 400 })
    }
    const qty = li.quantity ? Number(li.quantity) : available
    if (qty <= 0 || qty > available) {
      return NextResponse.json({ error: `Requested quantity for SKU ${li.sku_id} must be between 1 and ${available}.` }, { status: 400 })
    }

    const { data: skuRow, error: skuErr } = await supabaseAdmin
      .from('sku_master')
      .select('base_sku_code, variant_number')
      .eq('id', li.sku_id)
      .single()
    if (skuErr || !skuRow) return NextResponse.json({ error: `SKU not found: ${li.sku_id}.` }, { status: 404 })

    resolvedLines.push({
      sku_id: li.sku_id,
      cost_price: li.cost_price,
      gst_percentage: li.gst_percentage ?? 18,
      qty,
      base_sku_code: skuRow.base_sku_code,
      variant_number: skuRow.variant_number,
    })
  }

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

  let lineItemNumber = 1
  for (const line of resolvedLines) {
    const unitTotal = line.cost_price * line.qty
    const gstAmount = unitTotal * line.gst_percentage / 100
    const lineTotal = unitTotal + gstAmount

    const { data: item, error: itemErr } = await supabaseAdmin
      .from('purchase_order_items')
      .insert({
        po_id: po.id,
        line_item_number: lineItemNumber++,
        sku_id: line.sku_id,
        base_sku_code: line.base_sku_code,
        variant_number: line.variant_number,
        quantity: line.qty,
        base_price: line.cost_price,
        unit_price: line.cost_price,
        gst_percentage: line.gst_percentage,
        gst_amount: gstAmount,
        line_total: lineTotal,
      })
      .select('id')
      .single()

    if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 })

    // Claim exactly `line.qty` of previously-unattached movements for this PO/line
    // (splitting a movement row if `qty` doesn't land on a row boundary), and record
    // the now-known cost on the SKU itself (accessories have no per-unit cost_price
    // to update, unlike asset_ledger).
    const claim = await claimAccessoryBacklog(line.sku_id, line.qty, { poId: po.id, poItemId: item.id, createdBy: sessionUser.id })
    if (claim.error) return NextResponse.json({ error: claim.error }, { status: 500 })

    await supabaseAdmin
      .from('sku_master')
      .update({ base_cost: line.cost_price })
      .eq('id', line.sku_id)
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

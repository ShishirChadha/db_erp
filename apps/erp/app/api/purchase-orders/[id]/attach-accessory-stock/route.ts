import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { recalcPOTotals } from '@/lib/purchase-utils'
import { logAuditEvent } from '@/lib/audit-log'
import { isSerializedCategory } from '@/lib/sku-categories'

// ---------- POST: owner attaches a fungible/quantity-only SKU's still-unattached ----------
// ---------- stock-in movements onto an ALREADY-CREATED PO ----------
// Fungible sibling of /api/purchase-orders/[id]/attach-units (which is for serialized
// units, keyed off asset_ledger). Accessories have no per-unit row -- backlog here means
// unattached (po_id IS NULL) 'receipt' movements on stock_movements, same accounting
// /api/purchase-orders/from-accessory-stock already uses, just targeting an existing PO
// instead of always minting a new one -- e.g. "the laptops and the RAM were on one vendor
// invoice, put them on one PO." No asset numbers to reserve, no reason to touch anything
// on a 'sale'-type movement -- sold/bundled quantity was a separate movement row and never
// affects how much unattached receipt quantity is still here to formalize.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id: poId } = await params
  const body = await req.json()
  const { sku_id, cost_price, gst_percentage, confirm_despite_invoice } = body

  if (!sku_id) return NextResponse.json({ error: 'sku_id is required.' }, { status: 400 })
  if (cost_price === undefined || cost_price === null || cost_price < 0) {
    return NextResponse.json({ error: 'A valid cost_price is required.' }, { status: 400 })
  }

  const { data: po } = await supabaseAdmin
    .from('purchase_orders')
    .select('po_status, po_number, vendor_id, purchased_by_type')
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
      error: `This PO is already invoiced (${invoice.invoice_number}) -- adding units will NOT update that invoice, which will then disagree with the live record. Confirm to proceed anyway.`,
      error_code: 'already_invoiced',
    }, { status: 409 })
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
    .select('base_sku_code, variant_number, category')
    .eq('id', sku_id)
    .single()
  if (skuErr || !skuRow) return NextResponse.json({ error: 'SKU not found.' }, { status: 404 })
  // Laptops/desktops/etc. are tracked per-unit via asset_ledger -- use /attach-units
  // for those, not this quantity-only endpoint (see from-accessory-stock's GET for
  // the matching backlog-listing filter).
  if (isSerializedCategory(skuRow.category)) {
    return NextResponse.json({ error: 'This SKU is serialized -- use "Add Units from Stock" to attach individual units instead.' }, { status: 400 })
  }

  const { data: maxItem } = await supabaseAdmin
    .from('purchase_order_items')
    .select('line_item_number')
    .eq('po_id', poId)
    .order('line_item_number', { ascending: false })
    .limit(1)
  const lineItemNumber = (maxItem?.[0]?.line_item_number || 0) + 1

  const gstPct = gst_percentage ?? 18
  const unitTotal = cost_price * qty
  const gstAmount = unitTotal * gstPct / 100
  const lineTotal = unitTotal + gstAmount

  const { data: item, error: itemErr } = await supabaseAdmin
    .from('purchase_order_items')
    .insert({
      po_id: poId,
      line_item_number: lineItemNumber,
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

  await supabaseAdmin
    .from('stock_movements')
    .update({ po_id: poId, po_item_id: item.id })
    .in('id', movements.map((m) => m.id))

  await supabaseAdmin.from('sku_master').update({ base_cost: cost_price }).eq('id', sku_id)

  await recalcPOTotals(poId)

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'purchase_orders',
    tableName: 'purchase_orders',
    recordId: poId,
    recordLabel: po.po_number,
    reason: `Attached ${qty} unit(s) of accessory backlog to this PO.`,
  })

  return NextResponse.json({ success: true, attached_quantity: qty, item_id: item.id })
}

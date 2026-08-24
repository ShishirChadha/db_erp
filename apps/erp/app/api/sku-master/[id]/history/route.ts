import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, isOwner } from '@/lib/auth/session'

// ---------- GET: reconciliation summary + purchase history + raw movement ledger ----------
// For a fungible (quantity-only) sku_master row -- the "what did I buy, from whom, at
// what cost, and where did the current stock number come from" view that a single
// overwritten sku_master.base_cost can never answer on its own. Everything here is
// derived from stock_movements (the actual source of truth for quantity_in_stock) and
// purchase_order_items/purchase_orders -- no new tables, no stored aggregates.
//
// Cost/vendor data is owner-only, per the same convention as the rest of this app
// (lib/auth/redact.ts) -- but since this route's core (summary + movement types/dates)
// is legitimately useful to employees too (e.g. "why does this show 9 in stock"), the
// route stays open to anyone with accessories access and simply omits the owner-only
// sections for employees, rather than gating the whole route.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, ['accessories', 'live_stock', 'sku_master'])) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { id } = await params

  const { data: skuRow, error: skuErr } = await supabaseAdmin
    .from('sku_master')
    .select('id, full_sku_code, sku_description, category, brand, model_name, quantity_in_stock, status, selling_price_default, base_cost')
    .eq('id', id)
    .single()
  if (skuErr || !skuRow) return NextResponse.json({ error: 'SKU not found' }, { status: 404 })
  const { base_cost, ...sku } = skuRow

  const { data: movements, error: movErr } = await supabaseAdmin
    .from('stock_movements')
    .select('id, movement_type, quantity_change, quantity_before, quantity_after, po_id, unit_price, notes, created_at, vendors(company_name)')
    .eq('sku_id', id)
    .order('created_at', { ascending: false })
  if (movErr) return NextResponse.json({ error: movErr.message }, { status: 500 })

  // Summary is derived straight from the movement ledger -- never a stored counter --
  // so it can never drift from what quantity_in_stock itself is trigger-computed from.
  let received = 0, sold = 0, adjusted = 0
  for (const m of movements || []) {
    if (m.movement_type === 'receipt') received += m.quantity_change
    else if (m.movement_type === 'sale') sold += Math.abs(m.quantity_change)
    else if (m.movement_type === 'adjustment') adjusted += m.quantity_change
  }

  // PO numbers for the movements list -- a light lookup rather than an embedded join,
  // since most movements have no po_id (receipts are frequently unattached until the
  // owner does so later, see /api/purchase-orders/from-accessory-stock).
  const poIds = [...new Set((movements || []).map((m) => m.po_id).filter(Boolean))]
  const { data: poRows } = poIds.length
    ? await supabaseAdmin.from('purchase_orders').select('id, po_number').in('id', poIds)
    : { data: [] as any[] }
  const poNumberById = new Map((poRows || []).map((p: any) => [p.id, p.po_number]))

  const result: any = {
    sku,
    summary: { received, sold, adjusted, in_stock: sku.quantity_in_stock },
    // vendor_name/unit_price here are the employee-entered "who did we buy this from and
    // at what price" captured optionally at receipt time -- visible to every role by
    // design (see docs/decisions.md), unlike the owner-only formal PO purchases[] below.
    movements: (movements || []).map((m: any) => ({
      id: m.id,
      movement_type: m.movement_type,
      quantity_change: m.quantity_change,
      quantity_before: m.quantity_before,
      quantity_after: m.quantity_after,
      po_number: m.po_id ? poNumberById.get(m.po_id) || null : null,
      vendor_name: m.vendors?.company_name ?? null,
      unit_price: m.unit_price,
      notes: m.notes,
      created_at: m.created_at,
    })),
  }

  // Purchase history (vendor + cost) is owner-only -- never selected for other roles,
  // matching the app-wide convention of not fetching cost-bearing columns for employees.
  if (isOwner(sessionUser)) {
    const { data: items } = await supabaseAdmin
      .from('purchase_order_items')
      .select('quantity, unit_price, gst_percentage, line_total, purchase_orders(po_number, po_date, vendor_name)')
      .eq('sku_id', id)
      .order('created_at', { ascending: false })

    result.purchases = (items || []).map((item: any) => ({
      po_number: item.purchase_orders?.po_number || null,
      po_date: item.purchase_orders?.po_date || null,
      vendor_name: item.purchase_orders?.vendor_name || null,
      quantity: item.quantity,
      unit_price: item.unit_price,
      gst_percentage: item.gst_percentage,
      line_total: item.line_total,
    }))
    result.cost_price = base_cost ?? null
    result.last_vendor = result.purchases[0]?.vendor_name ?? null
  }

  return NextResponse.json(result)
}

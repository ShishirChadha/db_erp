import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner, hasPageAccess } from '@/lib/auth/session'
import { SELLABLE_STATUSES } from '@/lib/sales-entry'
import { insertAccessoryMovement } from '@/lib/accessory-movements'

// ---------- GET: owner's queue of sales still needing a GST invoice ----------
// Inventory-wise these sales are already final (see POST below) -- this is a
// bookkeeping reminder, not a gate.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data, error } = await supabaseAdmin
    .from('sales')
    .select('id, sale_date, customer_name, asset_number, serial_number, accessory_id, accessory_quantity, sale_base_price, sale_gst, sale_total, sale_type, entered_by, sold_by, payment_status, amount_paid, payment_account, created_at')
    .eq('finalized', false)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

// ---------- POST: employee (or owner) records a sale ----------
// Two shapes: a unit sale (asset_ledger_id, optionally with free bundled_accessories),
// or a standalone accessory sale (accessory_id + accessory_quantity, its own price).
// This is final the moment it's submitted -- the unit/accessory leaves stock right now
// (so the Sold Stock list and warranty lookups are always accurate). The GST invoice is
// separate, deferred bookkeeping generated later via POST /api/sales/[id]/finalize.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'new_entry')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const {
    asset_ledger_id, accessory_id, accessory_quantity, customer_id, sale_base_price,
    gst_percentage, sale_type, bundled_accessories,
    payment_status, amount_paid, payment_account, sold_by,
  } = body

  if (!customer_id) return NextResponse.json({ error: 'customer_id is required.' }, { status: 400 })
  if (!sale_base_price || sale_base_price <= 0) return NextResponse.json({ error: 'A valid selling price is required.' }, { status: 400 })
  if (!asset_ledger_id && !accessory_id) {
    return NextResponse.json({ error: 'Either asset_ledger_id or accessory_id is required.' }, { status: 400 })
  }

  const gstPct = gst_percentage ?? 18
  const gstAmount = Math.round(sale_base_price * gstPct) / 100
  const saleTotal = sale_base_price + gstAmount

  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('customer_name')
    .eq('id', customer_id)
    .single()

  const resolvedPaymentStatus = payment_status || 'pending'
  const resolvedAmountPaid = resolvedPaymentStatus === 'paid' ? saleTotal : (amount_paid ?? 0)

  // sold_by is a plain staff name (owner-curated list, see custom_options 'staff_names')
  // rather than a login account -- so someone without their own account can still be
  // credited. Falls back to the entering user's own email if left blank.
  const resolvedSoldBy = sold_by || sessionUser.email || null

  const baseSaleRecord = {
    sale_date: new Date().toISOString().slice(0, 10),
    customer_id,
    customer_name: customer?.customer_name || null,
    sale_base_price,
    sale_gst: gstAmount,
    sale_total: saleTotal,
    sale_type: sale_type || 'GST',
    entered_by: sessionUser.id,
    sold_by: resolvedSoldBy,
    payment_status: resolvedPaymentStatus,
    amount_paid: resolvedAmountPaid,
    payment_account: payment_account || null,
    finalized: false,
  }

  // ---------- Standalone accessory sale (no unit involved) ----------
  if (!asset_ledger_id) {
    const qty = accessory_quantity || 1
    const { data: accessory } = await supabaseAdmin
      .from('accessories')
      .select('id, quantity, review_status')
      .eq('id', accessory_id)
      .single()

    if (!accessory) return NextResponse.json({ error: 'Accessory not found.' }, { status: 404 })
    if (accessory.review_status !== 'active') {
      return NextResponse.json({ error: 'This accessory is still pending owner review and cannot be sold yet.' }, { status: 400 })
    }

    // Create the sales row first so the stock-out movement can reference its id --
    // if the movement then fails (e.g. oversell, caught by the DB trigger), delete
    // the sale row so nothing is left half-done.
    const { data: sale, error: saleErr } = await supabaseAdmin
      .from('sales')
      .insert({ ...baseSaleRecord, accessory_id, accessory_quantity: qty })
      .select('id')
      .single()

    if (saleErr) return NextResponse.json({ error: saleErr.message }, { status: 500 })

    const { error: moveErr } = await insertAccessoryMovement({
      accessoryId: accessory.id,
      movementType: 'out',
      quantityChange: -qty,
      saleId: sale.id,
      notes: 'Standalone accessory sale',
      createdBy: sessionUser.id,
    })
    if (moveErr) {
      await supabaseAdmin.from('sales').delete().eq('id', sale.id)
      return NextResponse.json({ error: moveErr.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, id: sale.id }, { status: 201 })
  }

  // ---------- Unit sale ----------
  const { data: asset } = await supabaseAdmin
    .from('asset_ledger')
    .select('id, status, sku_id, asset_number, serial_number')
    .eq('id', asset_ledger_id)
    .single()

  if (!asset) return NextResponse.json({ error: 'Unit not found.' }, { status: 404 })
  if (!SELLABLE_STATUSES.includes(asset.status)) {
    return NextResponse.json({ error: `This unit is '${asset.status}' and cannot be sold right now.` }, { status: 400 })
  }

  const nowIso = new Date().toISOString()

  // Atomic lock straight to 'sold' -- if this affects 0 rows, someone else already sold
  // it between our read and write above, so we bail out instead of double-selling.
  const { data: sold, error: soldErr } = await supabaseAdmin
    .from('asset_ledger')
    .update({ status: 'sold', sold_at: nowIso })
    .eq('id', asset_ledger_id)
    .in('status', SELLABLE_STATUSES)
    .select('id')
    .maybeSingle()

  if (soldErr) return NextResponse.json({ error: soldErr.message }, { status: 500 })
  if (!sold) return NextResponse.json({ error: 'This unit was just sold by someone else. Please pick another.' }, { status: 409 })

  const { data: sale, error: saleErr } = await supabaseAdmin
    .from('sales')
    .insert({
      ...baseSaleRecord,
      asset_ledger_id,
      asset_number: asset.asset_number,
      serial_number: asset.serial_number,
      bundled_accessories: bundled_accessories || null,
    })
    .select('id')
    .single()

  if (saleErr) {
    // Roll back the sale so the unit isn't stuck 'sold' with no sales row behind it.
    await supabaseAdmin.from('asset_ledger').update({ status: asset.status, sold_at: null }).eq('id', asset_ledger_id)
    return NextResponse.json({ error: saleErr.message }, { status: 500 })
  }

  // sku_master.quantity_in_stock is decremented atomically by the existing
  // trg_sync_sku_stock trigger on this insert -- no manual read-then-write.
  await supabaseAdmin.from('stock_movements').insert({
    sku_id: asset.sku_id,
    movement_type: 'sale',
    quantity_change: -1,
    notes: `Sold to customer -- invoice pending`,
    created_by: sessionUser.id,
  })

  // Bundled accessories are given away with the unit (no separate charge) -- decrement
  // them now too, same as the unit itself.
  const bundled: Array<{ accessory_id: string; quantity: number }> = bundled_accessories || []
  for (const item of bundled) {
    if (!item?.accessory_id || !item?.quantity) continue
    await insertAccessoryMovement({
      accessoryId: item.accessory_id,
      movementType: 'out',
      quantityChange: -item.quantity,
      saleId: sale.id,
      notes: `Bundled with unit sale ${asset.asset_number}`,
      createdBy: sessionUser.id,
    })
  }

  return NextResponse.json({ success: true, id: sale.id }, { status: 201 })
}

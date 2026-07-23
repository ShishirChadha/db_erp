import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner, hasPageAccess } from '@/lib/auth/session'
import { SELLABLE_STATUSES } from '@/lib/sales-entry'
import { insertAccessoryMovement } from '@/lib/accessory-movements'

// Best-effort: if this sale converts one line of a quotation/proforma, mark
// that line converted so it stops showing as open. Never blocks the sale
// itself on failure -- the sale is the primary source of truth and has
// already succeeded by the time this runs.
async function markSourceDocumentItemConverted(sourceDocumentItemId: string | undefined, saleId: string) {
  if (!sourceDocumentItemId) return
  await supabaseAdmin
    .from('sales_document_items')
    .update({ converted: true, sale_id: saleId })
    .eq('id', sourceDocumentItemId)
    .eq('converted', false)
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

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
    gst_percentage, sale_type, bundled_accessories, sale_date,
    payment_status, amount_paid, payment_account, sold_by,
    source_document_item_id,
  } = body

  if (!customer_id) return NextResponse.json({ error: 'customer_id is required.' }, { status: 400 })
  if (!sale_base_price || sale_base_price <= 0) return NextResponse.json({ error: 'A valid selling price is required.' }, { status: 400 })
  if (!asset_ledger_id && !accessory_id) {
    return NextResponse.json({ error: 'Either asset_ledger_id or accessory_id is required.' }, { status: 400 })
  }
  if (sale_date && !/^\d{4}-\d{2}-\d{2}$/.test(sale_date)) {
    return NextResponse.json({ error: 'sale_date must be in YYYY-MM-DD format.' }, { status: 400 })
  }

  // Backdate support: an employee logging a sale that actually happened earlier can
  // supply sale_date; defaults to today. sold_at (asset_ledger) and sale_month/sale_year
  // (used by Reports' year/month filters) are derived from the same value so a backdated
  // sale shows up correctly everywhere rather than only in the sales table itself.
  const resolvedSaleDate: string = sale_date || new Date().toISOString().slice(0, 10)
  const saleDateObj = new Date(`${resolvedSaleDate}T12:00:00.000Z`)
  const saleMonth = MONTHS[saleDateObj.getUTCMonth()]
  const saleYear = saleDateObj.getUTCFullYear()

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

  // A newly-typed name (not yet in the staff_names list) is saved back into
  // custom_options so it shows up in the dropdown for future sales -- otherwise
  // it's only ever usable by re-typing it each time. Best-effort: never blocks
  // the sale itself. Skipped for the email fallback above, since that's not a
  // real staff name to add to the list.
  if (typeof sold_by === 'string' && sold_by.trim()) {
    await supabaseAdmin
      .from('custom_options')
      .upsert(
        { category: 'staff_names', value: sold_by.trim() },
        { onConflict: 'category,value', ignoreDuplicates: true }
      )
  }

  const baseSaleRecord = {
    sale_date: resolvedSaleDate,
    sale_month: saleMonth,
    sale_year: saleYear,
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
  // Accessories are sku_master rows like everything else (see docs/decisions.md,
  // 2026-07-23) -- no per-unit asset_ledger row, just a quantity decrement.
  if (!asset_ledger_id) {
    const qty = accessory_quantity || 1
    const { data: accessorySku } = await supabaseAdmin
      .from('sku_master')
      .select('id, quantity_in_stock, status')
      .eq('id', accessory_id)
      .single()

    if (!accessorySku) return NextResponse.json({ error: 'Accessory not found.' }, { status: 404 })
    if (accessorySku.status !== 'active') {
      return NextResponse.json({ error: 'This item is archived and cannot be sold.' }, { status: 400 })
    }
    if (accessorySku.quantity_in_stock < qty) {
      return NextResponse.json({ error: `Only ${accessorySku.quantity_in_stock} in stock.` }, { status: 400 })
    }

    const { data: sale, error: saleErr } = await supabaseAdmin
      .from('sales')
      .insert({ ...baseSaleRecord, accessory_id, accessory_quantity: qty })
      .select('id')
      .single()

    if (saleErr) return NextResponse.json({ error: saleErr.message }, { status: 500 })

    const { error: moveErr } = await insertAccessoryMovement({
      skuId: accessorySku.id,
      movementType: 'sale',
      quantityChange: -qty,
      notes: 'Standalone accessory sale',
      createdBy: sessionUser.id,
    })
    if (moveErr) {
      await supabaseAdmin.from('sales').delete().eq('id', sale.id)
      return NextResponse.json({ error: moveErr.message }, { status: 400 })
    }

    await markSourceDocumentItemConverted(source_document_item_id, sale.id)

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

  // Atomic lock straight to 'sold' -- if this affects 0 rows, someone else already sold
  // it between our read and write above, so we bail out instead of double-selling.
  // sold_at uses the same (possibly backdated) sale date as the sales row itself.
  const { data: sold, error: soldErr } = await supabaseAdmin
    .from('asset_ledger')
    .update({ status: 'sold', sold_at: saleDateObj.toISOString() })
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

  // Bundled accessories -- free by default, or an extra charge already folded into
  // sale_base_price by the client (see the Sell form's per-item price field) --
  // decrement their stock now too, same as the unit itself.
  const bundled: Array<{ accessory_id: string; quantity: number }> = bundled_accessories || []
  for (const item of bundled) {
    if (!item?.accessory_id || !item?.quantity) continue
    await insertAccessoryMovement({
      skuId: item.accessory_id,
      movementType: 'sale',
      quantityChange: -item.quantity,
      notes: `Bundled with unit sale ${asset.asset_number}`,
      createdBy: sessionUser.id,
    })
  }

  await markSourceDocumentItemConverted(source_document_item_id, sale.id)

  return NextResponse.json({ success: true, id: sale.id }, { status: 201 })
}

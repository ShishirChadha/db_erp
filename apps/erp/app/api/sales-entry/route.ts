import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner, hasPageAccess } from '@/lib/auth/session'
import { reverseSaleInventoryEffects } from '@/lib/sales-entry'
import { CartItemInput, BaseSaleFields, ProcessedSaleRow, validateCartItems, processSingleSaleItem, splitAmountPaid } from '@/lib/sales-cart'

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

// ---------- POST: employee (or owner) records one or more sales for one customer ----------
// Body is a cart: shared customer_id/sale_type/gst_percentage/sale_date/payment fields,
// plus items[], each either a unit line (asset_ledger_id, optionally with free/priced
// bundled_accessories) or a standalone accessory line (accessory_id + accessory_quantity),
// each with its own sale_base_price. The legacy single-item shape (top-level
// asset_ledger_id/accessory_id/sale_base_price/etc., no items[]) still works -- it's
// normalized into a 1-item cart below.
//
// This is final the moment it's submitted -- every item leaves stock right now (so the
// Sold Stock list and warranty lookups are always accurate). The GST invoice is separate,
// deferred bookkeeping generated later via POST /api/sales/[id]/finalize or, for 2+ sales
// sharing the same customer + payment account (which every line in one cart already
// does), POST /api/sales/finalize-batch.
//
// Multi-item commits are sequential, not a single DB transaction (this codebase doesn't
// use Postgres transactions anywhere else for multi-step writes -- see the manual
// rollback idiom already used for the single-item case). Validation runs upfront across
// every item first (see validateCartItems) so the common failure case (stale search
// result, archived SKU, insufficient stock) never needs a rollback at all; the residual
// race (someone else sells the same unit between validation and commit) is caught by the
// atomic status-guarded update inside processSingleSaleItem, and rolled back via
// reverseSaleInventoryEffects for any earlier items already committed in this request.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'new_entry')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const {
    customer_id, sale_type, gst_percentage, sale_date,
    payment_status, amount_paid, payment_account, sold_by,
    source_document_item_id,
  } = body

  const items: CartItemInput[] = Array.isArray(body.items) && body.items.length > 0
    ? body.items
    : [{
        asset_ledger_id: body.asset_ledger_id,
        accessory_id: body.accessory_id,
        accessory_quantity: body.accessory_quantity,
        bundled_accessories: body.bundled_accessories,
        sale_base_price: body.sale_base_price,
      }]

  if (!customer_id) return NextResponse.json({ error: 'customer_id is required.' }, { status: 400 })
  if (sale_date && !/^\d{4}-\d{2}-\d{2}$/.test(sale_date)) {
    return NextResponse.json({ error: 'sale_date must be in YYYY-MM-DD format.' }, { status: 400 })
  }
  for (const item of items) {
    if (!item.asset_ledger_id && !item.accessory_id) {
      return NextResponse.json({ error: 'Every item needs either asset_ledger_id or accessory_id.' }, { status: 400 })
    }
    if (!item.sale_base_price || item.sale_base_price <= 0) {
      return NextResponse.json({ error: 'Every item needs a valid selling price.' }, { status: 400 })
    }
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

  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('customer_name')
    .eq('id', customer_id)
    .single()

  const resolvedPaymentStatus = payment_status || 'pending'

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

  const baseSaleFields: BaseSaleFields = {
    sale_date: resolvedSaleDate,
    sale_month: saleMonth,
    sale_year: saleYear,
    customer_id,
    customer_name: customer?.customer_name || null,
    sale_type: sale_type || 'GST',
    entered_by: sessionUser.id,
    sold_by: resolvedSoldBy,
    payment_status: resolvedPaymentStatus,
    payment_account: payment_account || null,
    finalized: false,
  }

  // Each item's own total, so a partial payment entered once for the whole cart can be
  // split proportionally by each line's share of the cart total (see splitAmountPaid) --
  // a ₹25,000 laptop and a ₹15,000 laptop paid ₹20,000 partial split ₹12,500/₹7,500, not
  // evenly. When fully paid, each row's amount_paid is simply its own total (matches the
  // single-item behavior this replaces); when pending, 0.
  const itemTotals = items.map((item) => {
    const gstAmount = Math.round(item.sale_base_price * gstPct) / 100
    return item.sale_base_price + gstAmount
  })
  const amountsPaidByItem: number[] = resolvedPaymentStatus === 'paid'
    ? itemTotals
    : resolvedPaymentStatus === 'partial'
      ? splitAmountPaid(amount_paid ?? 0, itemTotals)
      : items.map(() => 0)

  // ---------- Phase A: validate every item before writing anything ----------
  const validation = await validateCartItems(items)
  if (!validation.ok) {
    return NextResponse.json({ error: 'One or more items could not be sold.', item_errors: validation.itemErrors }, { status: 400 })
  }

  // ---------- Phase B: commit sequentially, rolling back this request's own earlier
  // commits if a later item fails ----------
  const committed: Array<{ id: string; saleRow: ProcessedSaleRow }> = []

  for (let index = 0; index < items.length; index++) {
    const result = await processSingleSaleItem(items[index], baseSaleFields, gstPct, amountsPaidByItem[index], sessionUser.id)
    if (!result.ok) {
      for (const c of committed.reverse()) {
        await reverseSaleInventoryEffects(c.saleRow, {
          reason: 'Cart checkout rolled back -- a later item in the same sale could not be sold',
          userId: sessionUser.id,
          assetRevertStatus: c.saleRow.priorAssetStatus,
        })
        await supabaseAdmin.from('sales').delete().eq('id', c.id)
      }
      return NextResponse.json({
        error: result.message,
        failed_item_index: index,
        rolled_back_sale_ids: committed.map((c) => c.id),
      }, { status: result.status })
    }
    committed.push({ id: result.saleRow.id, saleRow: result.saleRow })
  }

  await markSourceDocumentItemConverted(source_document_item_id, committed[0].id)

  const saleIds = committed.map((c) => c.id)
  return NextResponse.json({ success: true, id: saleIds[0], sale_ids: saleIds }, { status: 201 })
}

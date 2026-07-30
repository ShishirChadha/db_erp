import { supabaseAdmin } from '@db/db/admin'

// An online order is just another sales channel into the ERP: each
// order_item becomes a real `sales` row via the same rules the ERP's own
// Sell flow uses (see apps/erp/lib/sales-cart.ts's processSingleSaleItem),
// re-implemented here rather than imported since apps/web and apps/erp are
// separately deployed apps -- the truly shared constants (SELLABLE_STATUSES,
// financialYear) already live in @db/shared, not duplicated.
//
// Called only from the Razorpay webhook after signature verification.
// Idempotent: an order_item that already has erp_sale_id set is skipped, and
// an order already 'paid' short-circuits immediately -- a redelivered
// webhook event can never create a duplicate sale.
const GST_PERCENT = 18

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export async function convertOrderToSales(orderId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: order } = await supabaseAdmin.from('orders').select('*').eq('id', orderId).single()
  if (!order) return { ok: false, error: 'Order not found' }
  if (order.status === 'paid') return { ok: true }

  const { data: customerProfile } = await supabaseAdmin
    .from('customer_profiles')
    .select('customer_id')
    .eq('id', order.customer_id)
    .single()
  if (!customerProfile) return { ok: false, error: 'Customer profile not found' }

  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('customer_name')
    .eq('id', customerProfile.customer_id)
    .single()

  const { data: orderItems } = await supabaseAdmin
    .from('order_items')
    .select('id, sku_id, quantity, unit_price, erp_sale_id')
    .eq('order_id', orderId)
  if (!orderItems || orderItems.length === 0) return { ok: false, error: 'No order items on this order' }

  const now = new Date()
  const saleDate = now.toISOString().slice(0, 10)
  const saleMonth = MONTHS[now.getUTCMonth()]
  const saleYear = now.getUTCFullYear()

  for (const item of orderItems) {
    if (item.erp_sale_id) continue

    const { data: reservation } = await supabaseAdmin
      .from('web_reservations')
      .select('id, asset_id')
      .eq('order_item_id', item.id)
      .is('released_at', null)
      .maybeSingle()

    // unit_price is the customer-facing, GST-inclusive price -- derive the
    // pre-GST base as the remainder of what was actually charged so
    // base + gst always equals the real charged total exactly.
    const inclusiveTotal = item.unit_price * item.quantity
    const base = Math.round((inclusiveTotal * 100) / (1 + GST_PERCENT / 100)) / 100
    const gst = Math.round((inclusiveTotal - base) * 100) / 100

    const saleRecord = {
      sale_date: saleDate,
      sale_month: saleMonth,
      sale_year: saleYear,
      customer_id: customerProfile.customer_id,
      customer_name: customer?.customer_name || null,
      sale_type: 'GST',
      entered_by: null,
      sold_by: 'Website',
      payment_status: 'paid',
      amount_paid: inclusiveTotal,
      payment_account: 'Digitalbluez',
      finalized: false,
      sale_base_price: base,
      sale_gst: gst,
      sale_total: inclusiveTotal,
    }

    if (reservation?.asset_id) {
      const { data: asset } = await supabaseAdmin
        .from('asset_ledger')
        .select('id, sku_id, asset_number, serial_number')
        .eq('id', reservation.asset_id)
        .single()
      if (!asset) return { ok: false, error: `Reserved unit missing for order_item ${item.id} -- needs manual reconciliation` }

      // Guarded: only flips a unit that is still exactly 'reserved_web'. If
      // this affects 0 rows, the reservation expired (or was otherwise
      // altered) before payment completed -- surfaced as an error rather
      // than silently double-selling or fabricating a sale for a unit that
      // may already belong to someone else.
      const { data: sold } = await supabaseAdmin
        .from('asset_ledger')
        .update({ status: 'sold', sold_at: new Date(`${saleDate}T12:00:00.000Z`).toISOString() })
        .eq('id', asset.id)
        .eq('status', 'reserved_web')
        .select('id')
        .maybeSingle()
      if (!sold) {
        return {
          ok: false,
          error: `Unit ${asset.id} was no longer reserved when payment arrived for order ${orderId} -- needs manual reconciliation (paid but stock may be gone)`,
        }
      }

      const { data: sale, error: saleErr } = await supabaseAdmin
        .from('sales')
        .insert({ ...saleRecord, asset_ledger_id: asset.id, asset_number: asset.asset_number, serial_number: asset.serial_number })
        .select('id')
        .single()
      if (saleErr) return { ok: false, error: saleErr.message }

      // sku_master.quantity_in_stock is decremented atomically by the
      // existing trg_sync_sku_stock trigger on this insert.
      await supabaseAdmin.from('stock_movements').insert({
        sku_id: asset.sku_id,
        movement_type: 'sale',
        quantity_change: -1,
        notes: `Website order ${orderId}`,
      })

      await supabaseAdmin.from('order_items').update({ erp_sale_id: sale.id }).eq('id', item.id)
      await supabaseAdmin.from('web_reservations').update({ released_at: now.toISOString() }).eq('id', reservation.id)
    } else {
      const { data: sale, error: saleErr } = await supabaseAdmin
        .from('sales')
        .insert({ ...saleRecord, accessory_id: item.sku_id, accessory_quantity: item.quantity })
        .select('id')
        .single()
      if (saleErr) return { ok: false, error: saleErr.message }

      await supabaseAdmin.from('stock_movements').insert({
        sku_id: item.sku_id,
        movement_type: 'sale',
        quantity_change: -item.quantity,
        notes: `Website order ${orderId}`,
      })

      await supabaseAdmin.from('order_items').update({ erp_sale_id: sale.id }).eq('id', item.id)
      if (reservation) {
        await supabaseAdmin.from('web_reservations').update({ released_at: now.toISOString() }).eq('id', reservation.id)
      }
    }
  }

  await supabaseAdmin.from('orders').update({ status: 'paid', paid_at: now.toISOString() }).eq('id', orderId)
  return { ok: true }
}

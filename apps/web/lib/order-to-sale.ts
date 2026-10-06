import crypto from 'node:crypto'
import { supabaseAdmin } from '@db/db/admin'
import { allocatePaymentLegs } from '@db/shared'
import { findOrCreateCustomerByPhone } from './customer-identity'
import { sendEmail } from './email'
import { setPasswordEmailHtml } from './email-templates'

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

// A RAM/SSD upgrade is a real paid physical-modification service performed
// by staff before shipping -- reserve_order_items reserves by sku_id alone
// with no spec-awareness, so there's no automatic mechanism that could ever
// hand the customer an already-upgraded physical unit. The honest way to
// close that gap is a visible fulfillment task in the existing `activities`
// system (never a new task table, per this project's convention), not
// silence. A warranty_months upgrade needs no physical action -- it's just
// the first real writer of asset_ledger's dormant warranty_* columns.
async function fulfillSelectedUpgrades(
  selectedUpgrades: any[],
  assetId: string,
  saleId: string,
  assetLabel: string
) {
  const physicalUpgrades = selectedUpgrades.filter((u) => u?.field_name === 'ram' || u?.field_name === 'ssd')
  const warrantyUpgrade = selectedUpgrades.find((u) => u?.field_name === 'warranty_months')

  if (physicalUpgrades.length > 0) {
    const { data: owner } = await supabaseAdmin.from('profiles').select('id').eq('role', 'owner').limit(1).maybeSingle()
    if (owner) {
      const summary = physicalUpgrades.map((u) => `${u.field_name.toUpperCase()} ${u.from_value} → ${u.to_value}`).join(', ')
      await supabaseAdmin.from('activities').insert({
        user_id: owner.id,
        created_by: owner.id,
        title: `Upgrade before shipping: ${summary} — ${assetLabel}`,
        description: `Paid upgrade purchased on a website order (sale ${saleId}). Perform the physical upgrade before this unit ships.`,
        priority: 'high',
        related_type: 'sale',
        related_id: saleId,
      })
    }
  }

  if (warrantyUpgrade) {
    const months = parseInt(warrantyUpgrade.to_value, 10)
    if (!isNaN(months)) {
      const { data: currentAsset } = await supabaseAdmin.from('asset_ledger').select('warranty_type').eq('id', assetId).single()
      await supabaseAdmin
        .from('asset_ledger')
        .update({
          warranty_duration_months: months,
          warranty_start_date: new Date().toISOString().slice(0, 10),
          warranty_type: currentAsset?.warranty_type || 'in_house',
        })
        .eq('id', assetId)
    }
  }
}

// Append-only ledger insert -- never write amount_paid/payment_status on
// `sales` directly, per CLAUDE.md and sales-cart.ts's identical rule. The
// trigger (sync_sale_payment_totals) derives both from sum(sale_payments)
// immediately after this insert. recorded_by is left null, matching
// sales.entered_by on a website order -- no staff member took this payment.
async function recordSalePayment(saleId: string, amount: number, note: string): Promise<string | null> {
  if (amount <= 0) return null
  const { error } = await supabaseAdmin.from('sale_payments').insert({
    sale_id: saleId,
    amount,
    payment_account: 'Digitalbluez',
    note,
  })
  return error ? `Failed to record payment for sale ${saleId}: ${error.message}` : null
}

export async function convertOrderToSales(orderId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: order } = await supabaseAdmin.from('orders').select('*').eq('id', orderId).single()
  if (!order) return { ok: false, error: 'Order not found' }
  if (order.status === 'paid') return { ok: true }

  const { data: orderItems } = await supabaseAdmin
    .from('order_items')
    .select('id, sku_id, quantity, unit_price, erp_sale_id, selected_upgrades')
    .eq('order_id', orderId)
  if (!orderItems || orderItems.length === 0) return { ok: false, error: 'No order items on this order' }

  // A cod order never reaches status='paid' from this webhook (only the
  // token payment arrives here -- see below), so the check above alone
  // can't short-circuit a redelivered webhook event for it. This is the
  // precise idempotency signal instead: every item already converted means
  // this exact conversion already happened, regardless of what the order's
  // own status string says.
  if (orderItems.every((item) => item.erp_sale_id)) return { ok: true }

  // Customer resolution. A signed-in checkout already has a
  // customer_profiles row; a guest checkout does not -- the CRM customer is
  // created or matched (by phone, same dedupe as /api/auth/signup) only now,
  // because payment has actually succeeded. See apps/web/lib/guest-cart.ts
  // for why this must never happen earlier (at add-to-cart/checkout), and
  // orders.customer_id's column comment for the full reasoning.
  let customerId: string
  let customerName: string | null
  if (order.customer_id) {
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
    customerId = customerProfile.customer_id
    customerName = customer?.customer_name || null
  } else {
    const guest = order.guest_contact as { name?: string; phone?: string; email?: string } | null
    if (!guest?.name || !guest?.phone) return { ok: false, error: 'Guest order has no contact details' }

    const match = await findOrCreateCustomerByPhone({ fullName: guest.name, phone: guest.phone, email: guest.email ?? null })
    if (!match.ok) return { ok: false, error: match.error }
    customerId = match.match.customerId
    customerName = guest.name

    // Best-effort: give the guest a real login for next time, same as a
    // normal signup would. Deliberately non-fatal -- the sale itself must
    // never fail because of this. Most likely failure: the email is already
    // registered (a returning customer who forgot they have an account), in
    // which case they keep using their existing login; this order simply
    // isn't linked to it automatically.
    if (guest.email) {
      try {
        const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.createUser({
          email: guest.email,
          password: crypto.randomUUID(),
          email_confirm: true,
          user_metadata: { full_name: guest.name },
        })
        if (!authErr && authUser.user) {
          const { error: profileErr } = await supabaseAdmin.from('customer_profiles').insert({
            id: authUser.user.id,
            customer_id: customerId,
            full_name: guest.name,
            phone: guest.phone,
          })
          if (!profileErr) {
            // Link this order to the new account so it shows up in their
            // order history once they set a password and log in.
            await supabaseAdmin.from('orders').update({ customer_id: authUser.user.id }).eq('id', orderId)
            // Best-effort "set your password" email -- a GoTrue recovery
            // link is the right primitive for "let this user set a password
            // on an account that has none yet" even though nothing was ever
            // forgotten; sendEmail() itself no-ops cleanly (logged, not
            // thrown) if RESEND_API_KEY/RESEND_FROM_EMAIL aren't set in
            // apps/web's own environment -- the ERP having them does nothing
            // for this app; it's a separate Vercel project.
            const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
              type: 'recovery',
              email: guest.email,
            })
            if (linkErr) {
              console.error(`[order-to-sale] order ${orderId}: could not generate password-set link:`, linkErr.message)
            } else {
              const actionLink = linkData?.properties?.action_link
              if (actionLink) {
                const emailResult = await sendEmail({
                  to: guest.email,
                  subject: 'Set a password for your DigitalBluez account',
                  html: setPasswordEmailHtml({ name: guest.name, actionLink }),
                })
                if (!emailResult.success) {
                  console.error(`[order-to-sale] order ${orderId}: set-password email not sent:`, emailResult.error)
                }
              }
            }
          } else {
            await supabaseAdmin.auth.admin.deleteUser(authUser.user.id)
          }
        }
      } catch (err) {
        console.error(`[order-to-sale] order ${orderId}: best-effort account creation failed:`, err)
      }
    }
  }

  // cod collects only a token amount up front (see checkout/start/route.ts);
  // the rest is cash at delivery, recorded later in the ERP. Every other
  // method collects the full per-line amount now. allocatePaymentLegs gives
  // the same paise-exact proportional split the ERP's own multi-item Sell
  // cart uses, so the token is distributed fairly across sales rows rather
  // than dumping it all onto whichever line converts first.
  const isCod = order.payment_method === 'cod'
  const paymentAllocation = isCod
    ? allocatePaymentLegs(
        [{ amount: Number(order.token_amount) || 0, payment_account: 'Digitalbluez' }],
        orderItems.map((i) => i.unit_price * i.quantity)
      )
    : null

  const now = new Date()
  const saleDate = now.toISOString().slice(0, 10)
  const saleMonth = MONTHS[now.getUTCMonth()]
  const saleYear = now.getUTCFullYear()

  for (let idx = 0; idx < orderItems.length; idx++) {
    const item = orderItems[idx]
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

    // amount_paid/payment_status are deliberately absent here -- both are
    // trigger-derived (sync_sale_payment_totals) from the sum of this sale's
    // own sale_payments rows, same rule as the ERP's own Sell flow
    // (sales-cart.ts). Writing them directly here was the bug fixed
    // 2026-10-06: it worked by accident while every web order was paid in
    // full in one shot, but the moment a delivery-balance payment is ever
    // recorded against one of these sales, the trigger recomputes
    // amount_paid as sum(sale_payments) with zero awareness of a value set
    // here, and this would silently vanish. See the sale_payments insert
    // below instead.
    const saleRecord = {
      sale_date: saleDate,
      sale_month: saleMonth,
      sale_year: saleYear,
      customer_id: customerId,
      customer_name: customerName,
      sale_type: 'GST',
      entered_by: null,
      sold_by: 'Website',
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

      const paidNow = isCod ? (paymentAllocation?.[idx]?.[0]?.amount ?? 0) : inclusiveTotal
      const paymentErr = await recordSalePayment(
        sale.id,
        paidNow,
        isCod
          ? `Razorpay order ${order.razorpay_order_id || orderId} (COD token)`
          : `Razorpay order ${order.razorpay_order_id || orderId}`
      )
      if (paymentErr) return { ok: false, error: paymentErr }

      // sku_master.quantity_in_stock is decremented atomically by the
      // existing trg_sync_sku_stock trigger on this insert.
      await supabaseAdmin.from('stock_movements').insert({
        sku_id: asset.sku_id,
        movement_type: 'sale',
        quantity_change: -1,
        notes: `Website order ${orderId}`,
      })

      await supabaseAdmin.from('order_items').update({ erp_sale_id: sale.id }).eq('id', item.id)
      await supabaseAdmin.from('web_reservations').update({ released_at: now.toISOString(), release_reason: 'converted' }).eq('id', reservation.id)

      if (Array.isArray(item.selected_upgrades) && item.selected_upgrades.length > 0) {
        await fulfillSelectedUpgrades(item.selected_upgrades, asset.id, sale.id, asset.asset_number || asset.serial_number || asset.id)
      }
    } else {
      const { data: sale, error: saleErr } = await supabaseAdmin
        .from('sales')
        .insert({ ...saleRecord, accessory_id: item.sku_id, accessory_quantity: item.quantity })
        .select('id')
        .single()
      if (saleErr) return { ok: false, error: saleErr.message }

      const paidNow = isCod ? (paymentAllocation?.[idx]?.[0]?.amount ?? 0) : inclusiveTotal
      const paymentErr = await recordSalePayment(
        sale.id,
        paidNow,
        isCod
          ? `Razorpay order ${order.razorpay_order_id || orderId} (COD token)`
          : `Razorpay order ${order.razorpay_order_id || orderId}`
      )
      if (paymentErr) return { ok: false, error: paymentErr }

      await supabaseAdmin.from('stock_movements').insert({
        sku_id: item.sku_id,
        movement_type: 'sale',
        quantity_change: -item.quantity,
        notes: `Website order ${orderId}`,
      })

      await supabaseAdmin.from('order_items').update({ erp_sale_id: sale.id }).eq('id', item.id)
      if (reservation) {
        await supabaseAdmin.from('web_reservations').update({ released_at: now.toISOString(), release_reason: 'converted' }).eq('id', reservation.id)
      }
    }
  }

  // cod is only ever partially settled here -- the balance is cash at
  // delivery, recorded later in the ERP's Web Orders page (which is also
  // what moves this to 'paid' and stamps paid_at once the balance lands).
  await supabaseAdmin
    .from('orders')
    .update(isCod ? { status: 'partially_paid' } : { status: 'paid', paid_at: now.toISOString() })
    .eq('id', orderId)

  // Clear the lines the customer actually bought out of their cart.
  //
  // Nothing used to do this -- the only delete in the whole app is a customer
  // clicking remove -- so a purchased item sat in the cart forever, kept
  // showing in the header badge, and made report_web_funnel count every past
  // buyer as having an abandoned cart in perpetuity.
  //
  // Matched per (sku_id, selected_upgrades) rather than wiping the cart by
  // customer, deliberately: the customer has a 15-minute payment window during
  // which they may have added something else, and that must survive.
  //
  // Best-effort and last: a cart that fails to clear is cosmetic, and must
  // never make a paid order look unconverted.
  try {
    for (const item of orderItems) {
      // A promotional free gift was never in the cart (checkout adds it), so
      // it simply matches nothing here -- no need to filter it out, and
      // is_promotional_gift isn't selected above.
      await supabaseAdmin
        .from('cart_items')
        .delete()
        .eq('customer_id', order.customer_id)
        .eq('sku_id', item.sku_id)
        .eq('selected_upgrades', item.selected_upgrades ?? [])
    }
  } catch (err) {
    console.error(`[order-to-sale] order ${orderId} converted but cart not cleared:`, err)
  }

  return { ok: true }
}

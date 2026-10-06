import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-session'
import { supabaseAdmin } from '@db/db/admin'
import { isRazorpayConfigured, createRazorpayOrder } from '@/lib/razorpay'
import { releaseReservationsForOrder } from '@/lib/reservations'
import { resolveApplicablePromotions } from '@/lib/promotions'
import { productDisplayTitle } from '@/lib/product-title'
import { parseCartLines } from '@/lib/cart-lines'

const RESERVATION_TTL_MINUTES = 15

// Three different things produce status='cancelled', and they used to be
// indistinguishable -- which meant "how often does something sell out at
// checkout" was unanswerable. Each path now records its reason, and releases
// the promotion redemptions it optimistically claimed: those rows are inserted
// before payment, so leaving them behind on a cancelled attempt would count
// redemptions that never converted.
async function cancelOrder(
  orderId: string,
  reason: 'sold_out' | 'payment_init_failed' | 'reserve_error',
) {
  await supabaseAdmin.from('promotion_redemptions').delete().eq('order_id', orderId)
  await supabaseAdmin.from('orders').update({ status: 'cancelled', cancel_reason: reason }).eq('id', orderId)
}

type PaymentMethod = 'upi' | 'card' | 'cod'

export async function POST(req: NextRequest) {
  const session = await getCustomerSession()

  if (!isRazorpayConfigured()) {
    return NextResponse.json({ error: 'Online checkout is not available yet. Please check back soon.' }, { status: 503 })
  }

  const { shippingAddress, couponCode, paymentMethod, guestContact, items: buyNowItems } = await req.json()
  if (!shippingAddress?.name || !shippingAddress?.line1 || !shippingAddress?.city || !shippingAddress?.phone) {
    return NextResponse.json({ error: 'A complete shipping address is required.' }, { status: 400 })
  }
  // Pincode and state were accepted but never actually checked before this --
  // an order could be created with an empty pincode despite the client-side
  // `required` attribute.
  if (!shippingAddress?.state || !String(shippingAddress.pincode || '').trim()) {
    return NextResponse.json({ error: 'State and pincode are required.' }, { status: 400 })
  }

  if (paymentMethod !== 'upi' && paymentMethod !== 'card' && paymentMethod !== 'cod') {
    return NextResponse.json({ error: 'Choose a payment method.' }, { status: 400 })
  }
  const method: PaymentMethod = paymentMethod

  const { data: paymentSettings } = await supabaseAdmin.from('website_payment_settings').select('*').maybeSingle()
  if (!paymentSettings) return NextResponse.json({ error: 'Checkout is not configured yet.' }, { status: 503 })
  if (method === 'cod' && !paymentSettings.cod_enabled) {
    return NextResponse.json({ error: 'Cash on Delivery is not available right now.' }, { status: 400 })
  }

  // No account is required to place this order (see apps/web/lib/guest-cart.ts
  // for why anonymous auth is specifically wrong here) -- but there is
  // genuinely no server-side cart to read without one, so the guest path
  // carries its localStorage lines in the request body instead, re-validated
  // exactly like /api/cart/merge already does. A real CRM customer is only
  // ever created once payment actually succeeds (see order-to-sale.ts) --
  // never here, so an abandoned guest checkout costs nothing.
  //
  // `items`, when present, is an ad-hoc line list that takes priority over
  // whichever cart source would otherwise apply -- this is what lets "Buy
  // Now" (lib/buy-now.ts) skip the cart entirely for a single item, for a
  // signed-in customer exactly as much as a guest. A guest's regular
  // checkout (the whole cart, not a single item) also arrives this same
  // way, since there's no DB row to read without a session either way.
  let cartItems: { sku_id: string; quantity: number; selected_upgrades: unknown }[]
  let guestName: string | null = null
  let guestPhone: string | null = null
  let guestEmail: string | null = null

  if (!session) {
    guestName = String(guestContact?.name || '').trim()
    guestPhone = String(guestContact?.phone || '').trim()
    guestEmail = guestContact?.email ? String(guestContact.email).trim() : null
    if (!guestName || !guestPhone) {
      return NextResponse.json({ error: 'Name and phone are required to check out as a guest.' }, { status: 400 })
    }
  }

  if (buyNowItems !== undefined) {
    const parsed = parseCartLines(buyNowItems)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    cartItems = parsed.lines
  } else if (session) {
    const { data } = await supabaseAdmin
      .from('cart_items')
      .select('sku_id, quantity, selected_upgrades')
      .eq('customer_id', session.id)
    cartItems = data ?? []
  } else {
    return NextResponse.json({ error: 'Your cart is empty.' }, { status: 400 })
  }

  if (!cartItems || cartItems.length === 0) {
    return NextResponse.json({ error: 'Your cart is empty.' }, { status: 400 })
  }

  // Re-price and re-check availability from the live catalog server-side --
  // the client's cart is never trusted for price.
  const { data: products } = await supabaseAdmin
    .from('public_products')
    .select('id, web_title, web_price, availability_bucket, category, brand, model_name')
    .in('id', cartItems.map((c) => c.sku_id))
  const productById = new Map((products ?? []).map((p) => [p.id, p]))

  // Re-validate every selected upgrade against the live sku_upgrade_rules
  // table -- the client's price_delta is never trusted, only used to look up
  // which rule was meant (category/field/from/to), same principle as the
  // base product price above.
  const { data: activeRules } = await supabaseAdmin
    .from('sku_upgrade_rules')
    .select('category, field_name, from_value, to_value, price_delta')
    .eq('is_active', true)
  const ruleKey = (r: { category: string; field_name: string; from_value: string; to_value: string }) =>
    `${r.category}:${r.field_name}:${r.from_value}:${r.to_value}`
  const ruleByKey = new Map((activeRules ?? []).map((r) => [ruleKey(r), r]))

  function resolveUpgradeTotal(skuId: string, selectedUpgrades: unknown): number {
    const category = productById.get(skuId)?.category
    if (!category || !Array.isArray(selectedUpgrades)) return 0
    return selectedUpgrades.reduce((sum: number, u: any) => {
      const rule = ruleByKey.get(`${category}:${u?.field_name}:${u?.from_value}:${u?.to_value}`)
      return sum + (rule ? Number(rule.price_delta) : 0)
    }, 0)
  }

  const soldOut = cartItems.filter((c) => {
    const p = productById.get(c.sku_id)
    return !p || p.availability_bucket === 'sold_out'
  })
  if (soldOut.length > 0) {
    return NextResponse.json(
      { error: 'One or more items in your cart just sold out. Please update your cart.', sold_out_sku_ids: soldOut.map((c) => c.sku_id) },
      { status: 409 }
    )
  }

  const { data: order, error: orderErr } = await supabaseAdmin
    .from('orders')
    .insert({
      customer_id: session ? session.id : null,
      guest_contact: session ? null : { name: guestName, phone: guestPhone, email: guestEmail },
      status: 'pending_payment',
      shipping_address: shippingAddress,
      payment_method: method,
    })
    .select()
    .single()
  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 })

  const preDiscountLines = cartItems.map((c) => {
    const product = productById.get(c.sku_id)!
    const upgradeTotal = resolveUpgradeTotal(c.sku_id, c.selected_upgrades)
    const unitPrice = product.web_price + upgradeTotal
    return {
      sku_id: c.sku_id,
      quantity: c.quantity,
      unitPrice,
      lineTotal: unitPrice * c.quantity,
      title_snapshot: productDisplayTitle(product),
      selected_upgrades: c.selected_upgrades,
      category: product.category,
      brand: product.brand ?? null,
    }
  })

  const { discountAmount, appliedPromotionIds, freeGiftPromotionId, freeGiftSkuId } = await resolveApplicablePromotions(
    preDiscountLines.map((l) => ({ skuId: l.sku_id, category: l.category, brand: l.brand, lineTotal: l.lineTotal })),
    couponCode
  )
  const preDiscountTotal = preDiscountLines.reduce((sum, l) => sum + l.lineTotal, 0)

  // Payment-method adjustment -- the prepaid-discount model (owner's decision,
  // 2026-10-06): UPI/card get a discount for paying the full amount now; COD
  // carries a handling fee, because a surcharge on UPI is specifically
  // illegal in India (Payment & Settlement Systems Act s.10A) and card
  // surcharging breaches network rules, while a discount is legal on every
  // method and has the identical economics. Negative = discount, positive =
  // fee, expressed once here so the sign convention can't drift between the
  // two call sites below.
  const adjustmentPct =
    method === 'upi' ? -Number(paymentSettings.upi_discount_pct)
    : method === 'card' ? -Number(paymentSettings.card_discount_pct)
    : Number(paymentSettings.cod_handling_fee_pct)

  // Discount is baked directly into unit_price -- never left only in
  // orders.discount_amount/payment_adjustment_amount metadata -- so order-to-
  // sale's GST math (which only ever reads unit_price * quantity) stays
  // accurate. Promo discount distributed proportionally by each line's share
  // of the pre-discount total (existing behaviour); the payment-method
  // adjustment then applies independently per line, since there is no fixed
  // external total it needs to hit exactly -- whatever the lines sum to after
  // rounding IS the total charged, by construction.
  interface OrderItemRow {
    order_id: string
    sku_id: string
    quantity: number
    unit_price: number
    title_snapshot: string | null
    selected_upgrades: unknown
    is_promotional_gift?: boolean
  }

  const orderItemRows: OrderItemRow[] = preDiscountLines.map((l) => {
    const share = preDiscountTotal > 0 ? l.lineTotal / preDiscountTotal : 0
    const lineDiscount = Math.round(discountAmount * share * 100) / 100
    const discountedUnitPrice = Math.max(0, (l.lineTotal - lineDiscount) / l.quantity)
    const adjustedUnitPrice = Math.round(discountedUnitPrice * (1 + adjustmentPct / 100) * 100) / 100
    return {
      order_id: order.id,
      sku_id: l.sku_id,
      quantity: l.quantity,
      unit_price: adjustedUnitPrice,
      title_snapshot: l.title_snapshot,
      selected_upgrades: l.selected_upgrades,
    }
  })

  // Free-gift promo: a real $0 order_item that flows through the exact same
  // reservation/stock-decrement path as any paid line -- never a silent
  // side-channel. If the gift SKU is out of stock, it's dropped silently
  // rather than failing the whole cart (a real paid item still 409s). A free
  // gift is never adjusted by payment method -- 0 x anything is 0.
  if (freeGiftSkuId) {
    const { data: giftProduct } = await supabaseAdmin
      .from('public_products')
      .select('id, web_title, brand, model_name, category, availability_bucket')
      .eq('id', freeGiftSkuId)
      .maybeSingle()
    if (giftProduct && giftProduct.availability_bucket !== 'sold_out') {
      orderItemRows.push({
        order_id: order.id,
        sku_id: giftProduct.id,
        quantity: 1,
        unit_price: 0,
        title_snapshot: `${productDisplayTitle(giftProduct)} (free gift)`,
        selected_upgrades: [],
        is_promotional_gift: true,
      })
    }
  }

  const { error: itemsErr } = await supabaseAdmin.from('order_items').insert(orderItemRows)
  if (itemsErr) {
    await supabaseAdmin.from('orders').delete().eq('id', order.id)
    return NextResponse.json({ error: itemsErr.message }, { status: 500 })
  }

  if (appliedPromotionIds.length > 0 || freeGiftPromotionId) {
    const allApplied = [...appliedPromotionIds, ...(freeGiftPromotionId ? [freeGiftPromotionId] : [])]
    await supabaseAdmin.from('promotion_redemptions').insert(
      allApplied.map((promotion_id) => ({ promotion_id, customer_id: session?.id ?? null, order_id: order.id }))
    )
  }

  const { data: reservationResults, error: reserveErr } = await supabaseAdmin.rpc('reserve_order_items', {
    p_order_id: order.id,
    p_ttl_minutes: RESERVATION_TTL_MINUTES,
  })
  if (reserveErr) {
    await cancelOrder(order.id, 'reserve_error')
    return NextResponse.json({ error: reserveErr.message }, { status: 500 })
  }

  const failed = (reservationResults ?? []).filter((r: any) => !r.reserved)
  // A free gift going out of stock in the split-second between the earlier
  // stock check and this reservation call must not fail the whole cart --
  // only a real paid item going out of stock does that. Drop the gift line
  // and continue.
  const realFailures = failed.filter((f: any) => {
    const idx = (reservationResults ?? []).indexOf(f)
    return !orderItemRows[idx]?.is_promotional_gift
  })
  if (realFailures.length > 0) {
    await releaseReservationsForOrder(order.id)
    await cancelOrder(order.id, 'sold_out')
    const failedSkuIds = orderItemRows
      .filter((_, i) => realFailures.some((f: any) => f.order_item_id === reservationResults![i].order_item_id))
      .map((r) => r.sku_id)
    return NextResponse.json(
      { error: 'One or more items just sold out during checkout. Please update your cart and try again.', sold_out_sku_ids: failedSkuIds },
      { status: 409 }
    )
  }
  const failedGiftIds = failed.filter((f: any) => !realFailures.includes(f)).map((f: any) => f.order_item_id)
  if (failedGiftIds.length > 0) {
    await supabaseAdmin.from('order_items').delete().in('id', failedGiftIds)
  }

  // Read back the authoritative expiry reserve_order_items actually wrote to
  // web_reservations.expires_at (identical for every row of this order, set
  // once at the top of that RPC) rather than recomputing p_ttl_minutes
  // client-side here -- avoids any drift between what the UI displays and
  // what the DB will actually enforce when the release cron sweeps it.
  const successfulOrderItemIds = (reservationResults ?? [])
    .filter((r: any) => r.reserved)
    .map((r: any) => r.order_item_id)
  let reservedUntil: string | null = null
  if (successfulOrderItemIds.length > 0) {
    const { data: reservationRow } = await supabaseAdmin
      .from('web_reservations')
      .select('expires_at')
      .in('order_item_id', successfulOrderItemIds)
      .is('released_at', null)
      .limit(1)
      .maybeSingle()
    reservedUntil = reservationRow?.expires_at ?? null
  }

  const totalAmount = orderItemRows.reduce((sum, r) => sum + r.unit_price * r.quantity, 0)
  const paymentAdjustmentAmount = Math.round((totalAmount - preDiscountTotal + discountAmount) * 100) / 100

  // COD collects only a token amount up front via Razorpay -- the configured
  // cod_token_amount, capped at the order's own total so a sub-token order
  // never "collects" more than it's worth. Stored on the order (not just read
  // live from settings) so a later settings change can never retroactively
  // change what this specific order is understood to have collected.
  const chargeNow = method === 'cod' ? Math.min(Number(paymentSettings.cod_token_amount), totalAmount) : totalAmount

  let razorpayOrder
  try {
    razorpayOrder = await createRazorpayOrder(chargeNow, order.id, method)
  } catch (err: any) {
    await releaseReservationsForOrder(order.id, 'aborted_payment_init')
    await cancelOrder(order.id, 'payment_init_failed')
    return NextResponse.json({ error: 'Could not initiate payment. Please try again.' }, { status: 502 })
  }

  await supabaseAdmin
    .from('orders')
    .update({
      total_amount: totalAmount,
      razorpay_order_id: razorpayOrder.id,
      discount_amount: discountAmount,
      applied_promotion_ids: appliedPromotionIds,
      payment_adjustment_pct: adjustmentPct,
      payment_adjustment_amount: paymentAdjustmentAmount,
      token_amount: method === 'cod' ? chargeNow : null,
    })
    .eq('id', order.id)

  return NextResponse.json({
    orderId: order.id,
    razorpayOrderId: razorpayOrder.id,
    amount: razorpayOrder.amount,
    totalAmount,
    chargeNow,
    balanceDue: method === 'cod' ? Math.round((totalAmount - chargeNow) * 100) / 100 : 0,
    keyId: process.env.RAZORPAY_KEY_ID,
    reservedUntil,
  })
}

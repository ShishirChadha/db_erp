import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-session'
import { supabaseAdmin } from '@db/db/admin'
import { isRazorpayConfigured, createRazorpayOrder } from '@/lib/razorpay'
import { releaseReservationsForOrder } from '@/lib/reservations'
import { resolveApplicablePromotions } from '@/lib/promotions'

const RESERVATION_TTL_MINUTES = 15

export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Please log in to check out.' }, { status: 401 })

  if (!isRazorpayConfigured()) {
    return NextResponse.json({ error: 'Online checkout is not available yet. Please check back soon.' }, { status: 503 })
  }

  const { shippingAddress, couponCode } = await req.json()
  if (!shippingAddress?.name || !shippingAddress?.line1 || !shippingAddress?.city || !shippingAddress?.phone) {
    return NextResponse.json({ error: 'A complete shipping address is required.' }, { status: 400 })
  }

  const { data: cartItems } = await supabaseAdmin
    .from('cart_items')
    .select('sku_id, quantity, selected_upgrades')
    .eq('customer_id', session.id)
  if (!cartItems || cartItems.length === 0) {
    return NextResponse.json({ error: 'Your cart is empty.' }, { status: 400 })
  }

  // Re-price and re-check availability from the live catalog server-side --
  // the client's cart is never trusted for price.
  const { data: products } = await supabaseAdmin
    .from('public_products')
    .select('id, web_title, web_price, availability_bucket, category, brand')
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
    .insert({ customer_id: session.id, status: 'pending_payment', shipping_address: shippingAddress })
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
      title_snapshot: product.web_title,
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

  // Discount is baked directly into unit_price -- never left only in
  // orders.discount_amount metadata -- so order-to-sale's GST math (which
  // only ever reads unit_price * quantity) stays accurate. Distributed
  // proportionally by each line's share of the pre-discount total.
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
    return {
      order_id: order.id,
      sku_id: l.sku_id,
      quantity: l.quantity,
      unit_price: Math.round(discountedUnitPrice * 100) / 100,
      title_snapshot: l.title_snapshot,
      selected_upgrades: l.selected_upgrades,
    }
  })

  // Free-gift promo: a real $0 order_item that flows through the exact same
  // reservation/stock-decrement path as any paid line -- never a silent
  // side-channel. If the gift SKU is out of stock, it's dropped silently
  // rather than failing the whole cart (a real paid item still 409s).
  if (freeGiftSkuId) {
    const { data: giftProduct } = await supabaseAdmin
      .from('public_products')
      .select('id, web_title, availability_bucket')
      .eq('id', freeGiftSkuId)
      .maybeSingle()
    if (giftProduct && giftProduct.availability_bucket !== 'sold_out') {
      orderItemRows.push({
        order_id: order.id,
        sku_id: giftProduct.id,
        quantity: 1,
        unit_price: 0,
        title_snapshot: `${giftProduct.web_title} (free gift)`,
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
      allApplied.map((promotion_id) => ({ promotion_id, customer_id: session.id, order_id: order.id }))
    )
  }

  const { data: reservationResults, error: reserveErr } = await supabaseAdmin.rpc('reserve_order_items', {
    p_order_id: order.id,
    p_ttl_minutes: RESERVATION_TTL_MINUTES,
  })
  if (reserveErr) {
    await supabaseAdmin.from('orders').update({ status: 'cancelled' }).eq('id', order.id)
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
    await supabaseAdmin.from('orders').update({ status: 'cancelled' }).eq('id', order.id)
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

  const totalAmount = orderItemRows.reduce((sum, r) => sum + r.unit_price * r.quantity, 0)

  let razorpayOrder
  try {
    razorpayOrder = await createRazorpayOrder(totalAmount, order.id)
  } catch (err: any) {
    await releaseReservationsForOrder(order.id)
    await supabaseAdmin.from('orders').update({ status: 'cancelled' }).eq('id', order.id)
    return NextResponse.json({ error: 'Could not initiate payment. Please try again.' }, { status: 502 })
  }

  await supabaseAdmin
    .from('orders')
    .update({
      total_amount: totalAmount,
      razorpay_order_id: razorpayOrder.id,
      discount_amount: discountAmount,
      applied_promotion_ids: appliedPromotionIds,
    })
    .eq('id', order.id)

  return NextResponse.json({
    orderId: order.id,
    razorpayOrderId: razorpayOrder.id,
    amount: razorpayOrder.amount,
    keyId: process.env.RAZORPAY_KEY_ID,
  })
}

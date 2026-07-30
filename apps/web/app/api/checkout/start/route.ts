import { NextRequest, NextResponse } from 'next/server'
import { getCustomerSession } from '@/lib/customer-session'
import { supabaseAdmin } from '@db/db/admin'
import { isRazorpayConfigured, createRazorpayOrder } from '@/lib/razorpay'
import { releaseReservationsForOrder } from '@/lib/reservations'

const RESERVATION_TTL_MINUTES = 15

export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ error: 'Please log in to check out.' }, { status: 401 })

  if (!isRazorpayConfigured()) {
    return NextResponse.json({ error: 'Online checkout is not available yet. Please check back soon.' }, { status: 503 })
  }

  const { shippingAddress } = await req.json()
  if (!shippingAddress?.name || !shippingAddress?.line1 || !shippingAddress?.city || !shippingAddress?.phone) {
    return NextResponse.json({ error: 'A complete shipping address is required.' }, { status: 400 })
  }

  const { data: cartItems } = await supabaseAdmin
    .from('cart_items')
    .select('sku_id, quantity')
    .eq('customer_id', session.id)
  if (!cartItems || cartItems.length === 0) {
    return NextResponse.json({ error: 'Your cart is empty.' }, { status: 400 })
  }

  // Re-price and re-check availability from the live catalog server-side --
  // the client's cart is never trusted for price.
  const { data: products } = await supabaseAdmin
    .from('public_products')
    .select('id, web_title, web_price, availability_bucket')
    .in('id', cartItems.map((c) => c.sku_id))
  const productById = new Map((products ?? []).map((p) => [p.id, p]))

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

  const orderItemRows = cartItems.map((c) => {
    const product = productById.get(c.sku_id)!
    return {
      order_id: order.id,
      sku_id: c.sku_id,
      quantity: c.quantity,
      unit_price: product.web_price,
      title_snapshot: product.web_title,
    }
  })
  const { error: itemsErr } = await supabaseAdmin.from('order_items').insert(orderItemRows)
  if (itemsErr) {
    await supabaseAdmin.from('orders').delete().eq('id', order.id)
    return NextResponse.json({ error: itemsErr.message }, { status: 500 })
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
  if (failed.length > 0) {
    await releaseReservationsForOrder(order.id)
    await supabaseAdmin.from('orders').update({ status: 'cancelled' }).eq('id', order.id)
    const failedSkuIds = (orderItemRows.filter((_, i) => failed.some((f: any) => f.order_item_id === reservationResults[i].order_item_id))).map((r) => r.sku_id)
    return NextResponse.json(
      { error: 'One or more items just sold out during checkout. Please update your cart and try again.', sold_out_sku_ids: failedSkuIds },
      { status: 409 }
    )
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
    .update({ total_amount: totalAmount, razorpay_order_id: razorpayOrder.id })
    .eq('id', order.id)

  return NextResponse.json({
    orderId: order.id,
    razorpayOrderId: razorpayOrder.id,
    amount: razorpayOrder.amount,
    keyId: process.env.RAZORPAY_KEY_ID,
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { verifyRazorpaySignature } from '@/lib/razorpay'
import { convertOrderToSales } from '@/lib/order-to-sale'
import { supabaseAdmin } from '@db/db/admin'

// Razorpay's webhook is the authoritative confirmation of payment -- not the
// client-side checkout.js success callback, which can be spoofed or
// interrupted (browser closed mid-flow). Signature is verified against the
// raw request body using a webhook-specific secret (configured in the
// Razorpay dashboard), never the API key secret.
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-razorpay-signature')
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET

  if (!secret) return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  if (!signature || !verifyRazorpaySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const event = JSON.parse(rawBody)

  if (event.event === 'payment.captured' || event.event === 'order.paid') {
    const payment = event.payload?.payment?.entity
    const razorpayOrderId = payment?.order_id
    if (!razorpayOrderId) return NextResponse.json({ received: true })

    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('id, status')
      .eq('razorpay_order_id', razorpayOrderId)
      .single()
    if (!order) return NextResponse.json({ received: true })

    // Idempotent: a redelivered webhook event for an already-paid order is a
    // no-op, never a second conversion attempt.
    if (order.status === 'paid') return NextResponse.json({ received: true })

    await supabaseAdmin
      .from('orders')
      .update({ razorpay_payment_id: payment.id, razorpay_signature: signature })
      .eq('id', order.id)

    const result = await convertOrderToSales(order.id)
    if (!result.ok) {
      // Payment already succeeded -- this is an inventory/bookkeeping
      // conflict (e.g. the reservation expired moments before payment
      // arrived), not a payment failure. Acknowledge the webhook (200) so
      // Razorpay doesn't retry indefinitely; log loudly for manual
      // reconciliation rather than silently losing a paid order.
      console.error(`[razorpay webhook] order ${order.id} paid but conversion failed: ${result.error}`)
    }
  }

  return NextResponse.json({ received: true })
}

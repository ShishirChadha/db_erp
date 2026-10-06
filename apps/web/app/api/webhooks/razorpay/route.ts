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
      .select('id, status, payment_method, token_amount, total_amount')
      .eq('razorpay_order_id', razorpayOrderId)
      .single()
    if (!order) return NextResponse.json({ received: true })

    // Idempotent: a redelivered webhook event for an already-paid order is a
    // no-op, never a second conversion attempt.
    if (order.status === 'paid') return NextResponse.json({ received: true })

    // The amount Razorpay says it captured must match what we told it to
    // charge -- either the full total (upi/card) or the token (cod). Harmless
    // while every order was full-price (Razorpay enforces its own order
    // amount already), but a real integrity check once amounts vary by
    // method: if this ever disagrees, something has gone wrong with how the
    // order was priced or which order this payment actually belongs to, and
    // this must not be the thing that marks it paid and ships a unit.
    const expectedRupees = order.payment_method === 'cod' ? Number(order.token_amount) : Number(order.total_amount)
    const expectedPaise = Math.round(expectedRupees * 100)
    if (typeof payment.amount === 'number' && Math.abs(payment.amount - expectedPaise) > 1) {
      console.error(
        `[razorpay webhook] order ${order.id}: payment amount ${payment.amount} paise does not match expected ${expectedPaise} paise -- not converting, needs manual review`
      )
      await supabaseAdmin
        .from('orders')
        .update({
          conversion_error: `Amount mismatch: Razorpay reported ${payment.amount} paise, expected ${expectedPaise}`,
          conversion_failed_at: new Date().toISOString(),
        })
        .eq('id', order.id)
      return NextResponse.json({ received: true })
    }

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

      // Persisted as well as logged. The authoritative detector for "money
      // taken, bookkeeping incomplete" stays derived (status='paid' with an
      // order_item still lacking erp_sale_id) so it survives a lost log line;
      // this column is the human-readable reason the ERP's Website Orders
      // page shows next to that flag. A console line nobody reads is not a
      // reconciliation process.
      await supabaseAdmin
        .from('orders')
        .update({ conversion_error: result.error ?? 'unknown', conversion_failed_at: new Date().toISOString() })
        .eq('id', order.id)
    }
  }

  return NextResponse.json({ received: true })
}

import crypto from 'node:crypto'

export function isRazorpayConfigured(): boolean {
  return !!process.env.RAZORPAY_KEY_ID && !!process.env.RAZORPAY_KEY_SECRET
}

export async function createRazorpayOrder(
  amountRupees: number,
  receipt: string
): Promise<{ id: string; amount: number; currency: string }> {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify({
      amount: Math.round(amountRupees * 100), // paise
      currency: 'INR',
      receipt,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Razorpay order creation failed: ${body}`)
  }
  return res.json()
}

// Verifies the X-Razorpay-Signature header against the raw request body using
// the webhook secret (configured separately in the Razorpay dashboard, not
// the API key secret). Uses a constant-time comparison to avoid a timing
// side-channel on signature verification.
export function verifyRazorpaySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const expectedBuf = Buffer.from(expected)
  const signatureBuf = Buffer.from(signature)
  if (expectedBuf.length !== signatureBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, signatureBuf)
}

// Verifies the checkout.js client-side success payload (order_id + payment_id
// + signature) using the API key secret -- a separate, standard Razorpay
// formula from the webhook signature above. Only used for immediate UI
// feedback; the webhook remains the authoritative source of truth for
// actually marking an order paid.
export function verifyRazorpayPaymentSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string
): boolean {
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex')
  const expectedBuf = Buffer.from(expected)
  const signatureBuf = Buffer.from(signature)
  if (expectedBuf.length !== signatureBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, signatureBuf)
}

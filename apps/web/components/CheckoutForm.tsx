'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Script from 'next/script'
import { formatCurrency } from '@db/shared'
import { ReservationCountdown } from './ReservationCountdown'
import { track } from '@/lib/analytics'
import type { GuestLine } from '@/lib/guest-cart'
import type { PaymentSettings } from '@/lib/payment-settings'

declare global {
  interface Window {
    Razorpay: any
  }
}

type PaymentMethod = 'upi' | 'card' | 'cod'

// One form handles both an account checkout (server already knows the cart
// and the signed-in customer) and a guest checkout (no server-side cart --
// the guest's localStorage lines are carried in the request body instead,
// re-validated server-side exactly like /api/cart/merge already does. See
// apps/web/lib/guest-cart.ts for why no account is created until payment
// actually succeeds). The two modes differ only in what's in the body and
// whether name/email need their own fields -- everything else (address,
// payment method, Razorpay flow) is identical.
export function CheckoutForm({
  subtotal,
  customerName,
  customerEmail,
  paymentSettings,
  mode,
  items,
  onSuccess,
}: {
  subtotal: number
  customerName: string
  customerEmail: string
  paymentSettings: PaymentSettings
  mode: 'account' | 'guest'
  // An ad-hoc line list, sent regardless of mode -- this is what both a
  // guest's full cart AND a "Buy Now" single-item express checkout (either
  // mode) use instead of the server reading cart_items. Omit it for the
  // ordinary signed-in "check out my real cart" path, which still relies on
  // /api/checkout/start reading cart_items itself.
  items?: GuestLine[]
  // Called right before navigating to the order page on payment success --
  // callers clear whichever client-side source `items` came from (guest
  // cart vs the Buy Now buffer). Omitted for the ordinary account path,
  // which has nothing client-side to clear.
  onSuccess?: () => void
}) {
  const router = useRouter()
  const [name, setName] = useState(customerName)
  const [email, setEmail] = useState(customerEmail)
  const [phone, setPhone] = useState('')
  const [line1, setLine1] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [pincode, setPincode] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('upi')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [scriptReady, setScriptReady] = useState(false)
  const [reservedUntil, setReservedUntil] = useState<string | null>(null)

  // Client-side preview only -- an estimate shown before submitting, so the
  // customer isn't choosing a method blind. The authoritative amount is
  // always computed server-side in /api/checkout/start from the live
  // catalogue, never trusted from here. Doesn't account for a coupon code
  // (there's no coupon UI on this form today), so it can read slightly high
  // if one applies.
  const preview = useMemo(() => {
    const pct =
      paymentMethod === 'upi' ? -paymentSettings.upi_discount_pct
      : paymentMethod === 'card' ? -paymentSettings.card_discount_pct
      : paymentSettings.cod_handling_fee_pct
    const total = Math.round(subtotal * (1 + pct / 100) * 100) / 100
    const tokenNow = paymentMethod === 'cod' ? Math.min(paymentSettings.cod_token_amount, total) : total
    return { pct, total, tokenNow, balanceDue: Math.round((total - tokenNow) * 100) / 100 }
  }, [subtotal, paymentMethod, paymentSettings])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    // Fired BEFORE the request, deliberately: a checkout that fails because an
    // item sold out in the meantime is still a customer who tried to buy, and
    // that is exactly the drop-off this funnel step exists to measure. Firing
    // it after a 2xx would hide the failures.
    track({ name: 'begin_checkout', params: { currency: 'INR', value: subtotal, items: [] } })

    try {
      const body: Record<string, unknown> = {
        shippingAddress: { name, phone, line1, city, state, pincode },
        paymentMethod,
      }
      if (mode === 'guest') {
        body.guestContact = { name, phone, email }
      }
      if (items !== undefined) {
        body.items = items
      }

      const res = await fetch('/api/checkout/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Checkout failed')
      if (json.reservedUntil) setReservedUntil(json.reservedUntil)

      if (!scriptReady || !window.Razorpay) {
        throw new Error('Payment is still loading — please try again in a moment.')
      }

      const razorpay = new window.Razorpay({
        key: json.keyId,
        amount: json.amount,
        currency: 'INR',
        name: 'DigitalBluez',
        order_id: json.razorpayOrderId,
        prefill: { name, email, contact: phone },
        theme: { color: '#f2672a' },
        // A UI-level nudge toward the method the customer actually picked and
        // the price was computed for -- Razorpay's own hosted widget, not a
        // server-enforced restriction (their Orders API has no such field;
        // see lib/razorpay.ts). The amount itself is fixed before this widget
        // ever opens, which is the guarantee that actually matters.
        method: paymentMethod === 'cod' ? undefined : { upi: paymentMethod === 'upi', card: paymentMethod === 'card' },
        handler: () => {
          if (mode === 'guest') clearGuestCart()
          router.push(`/order/${json.orderId}`)
        },
        modal: {
          ondismiss: () => setSubmitting(false),
        },
      })
      razorpay.open()
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
      setSubmitting(false)
    }
  }

  return (
    <>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" onReady={() => setScriptReady(true)} />
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {reservedUntil && <ReservationCountdown expiresAt={reservedUntil} />}
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Full name</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/25" />
        </div>
        {mode === 'guest' && (
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Email <span className="text-muted-foreground/70">(so we can create your account for next time)</span>
            </label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/25" />
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Phone</label>
          <input required value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/25" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Address</label>
          <input required value={line1} onChange={(e) => setLine1(e.target.value)} className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/25" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-muted-foreground">City</label>
            <input required value={city} onChange={(e) => setCity(e.target.value)} className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/25" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Pincode</label>
            <input required value={pincode} onChange={(e) => setPincode(e.target.value)} className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/25" />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">State</label>
          <input required value={state} onChange={(e) => setState(e.target.value)} className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/25" />
        </div>

        <div>
          <label className="mb-2 block text-xs text-muted-foreground">Payment method</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <PaymentMethodOption
              active={paymentMethod === 'upi'}
              onClick={() => setPaymentMethod('upi')}
              label="UPI"
              note={paymentSettings.upi_discount_pct > 0 ? `${paymentSettings.upi_discount_pct}% off` : 'Pay now'}
            />
            <PaymentMethodOption
              active={paymentMethod === 'card'}
              onClick={() => setPaymentMethod('card')}
              label="Card"
              note={paymentSettings.card_discount_pct > 0 ? `${paymentSettings.card_discount_pct}% off` : 'Pay now'}
            />
            {paymentSettings.cod_enabled && (
              <PaymentMethodOption
                active={paymentMethod === 'cod'}
                onClick={() => setPaymentMethod('cod')}
                label="Cash on Delivery"
                note={paymentSettings.cod_handling_fee_pct > 0 ? `+${paymentSettings.cod_handling_fee_pct}% fee` : 'Pay on delivery'}
              />
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-secondary/30 p-3 text-sm">
          {paymentMethod === 'cod' ? (
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total (incl. COD fee)</span>
                <span className="tabular-nums font-medium">{formatCurrency(preview.total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pay online now</span>
                <span className="tabular-nums font-medium">{formatCurrency(preview.tokenNow)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Due on delivery</span>
                <span className="tabular-nums font-medium">{formatCurrency(preview.balanceDue)}</span>
              </div>
            </div>
          ) : (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total{preview.pct !== 0 ? ` (${preview.pct}% applied)` : ''}</span>
              <span className="tabular-nums font-medium">{formatCurrency(preview.total)}</span>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-full bg-brand-orange px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {submitting
            ? 'Processing…'
            : paymentMethod === 'cod'
              ? `Pay ${formatCurrency(preview.tokenNow)} now`
              : `Pay ${formatCurrency(preview.total)}`}
        </button>
      </form>
    </>
  )
}

function PaymentMethodOption({
  active,
  onClick,
  label,
  note,
}: {
  active: boolean
  onClick: () => void
  label: string
  note: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
        active ? 'border-brand-orange bg-brand-orange/5' : 'border-input hover:border-brand-orange/40'
      }`}
    >
      <span className="block text-sm font-medium text-foreground">{label}</span>
      <span className="block text-xs text-muted-foreground">{note}</span>
    </button>
  )
}

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Script from 'next/script'
import { formatCurrency } from '@db/shared'

declare global {
  interface Window {
    Razorpay: any
  }
}

export function CheckoutForm({
  subtotal,
  customerName,
  customerEmail,
}: {
  subtotal: number
  customerName: string
  customerEmail: string
}) {
  const router = useRouter()
  const [name, setName] = useState(customerName)
  const [phone, setPhone] = useState('')
  const [line1, setLine1] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [pincode, setPincode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [scriptReady, setScriptReady] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/checkout/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shippingAddress: { name, phone, line1, city, state, pincode } }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Checkout failed')

      if (!scriptReady || !window.Razorpay) {
        throw new Error('Payment is still loading — please try again in a moment.')
      }

      const razorpay = new window.Razorpay({
        key: json.keyId,
        amount: json.amount,
        currency: 'INR',
        name: 'DigitalBluez',
        order_id: json.razorpayOrderId,
        prefill: { name, email: customerEmail, contact: phone },
        theme: { color: '#f2672a' },
        handler: () => {
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
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Full name</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/25" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Phone</label>
          <input required value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/25" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Address</label>
          <input required value={line1} onChange={(e) => setLine1(e.target.value)} className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/25" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
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

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-full bg-brand-orange px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Processing…' : `Pay ${formatCurrency(subtotal)}`}
        </button>
      </form>
    </>
  )
}

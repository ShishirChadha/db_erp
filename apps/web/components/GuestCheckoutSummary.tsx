'use client'

import { useEffect, useState } from 'react'
import { readGuestCart, clearGuestCart, type GuestLine } from '@/lib/guest-cart'
import { ClientCheckoutSummary } from './ClientCheckoutSummary'
import type { PaymentSettings } from '@/lib/payment-settings'

// A server component (checkout/page.tsx) can't read localStorage -- this
// defers that one read to client-mount, then hands the resolved lines to
// the shared ClientCheckoutSummary (re-pricing, the actual form).
export function GuestCheckoutSummary({ paymentSettings }: { paymentSettings: PaymentSettings }) {
  const [lines, setLines] = useState<GuestLine[] | null>(null)

  useEffect(() => {
    setLines(readGuestCart())
  }, [])

  if (lines === null) return <p className="mt-6 text-sm text-muted-foreground">Loading your cart…</p>

  return (
    <ClientCheckoutSummary
      lines={lines}
      paymentSettings={paymentSettings}
      mode="guest"
      customerName=""
      customerEmail=""
      onSuccess={clearGuestCart}
      emptyRedirect="/cart"
    />
  )
}

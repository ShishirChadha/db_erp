'use client'

import { useEffect, useState } from 'react'
import { getBuyNowLine, clearBuyNowLine } from '@/lib/buy-now'
import type { GuestLine } from '@/lib/guest-cart'
import { ClientCheckoutSummary } from './ClientCheckoutSummary'
import type { PaymentSettings } from '@/lib/payment-settings'

// "Buy Now" (lib/buy-now.ts) express checkout -- a single ad-hoc line read
// out of sessionStorage, for EITHER a signed-in customer or a guest, never
// the real cart either way. mode/customerName/customerEmail come from the
// server (checkout/page.tsx already knows whether there's a session), since
// that's not something sessionStorage can tell us.
export function BuyNowCheckoutSummary({
  paymentSettings,
  mode,
  customerName,
  customerEmail,
}: {
  paymentSettings: PaymentSettings
  mode: 'account' | 'guest'
  customerName: string
  customerEmail: string
}) {
  const [lines, setLines] = useState<GuestLine[] | null>(null)

  useEffect(() => {
    const line = getBuyNowLine()
    setLines(
      line
        ? [{ sku_id: line.sku_id, quantity: line.quantity, selected_upgrades: line.selected_upgrades, added_at: new Date().toISOString() }]
        : []
    )
  }, [])

  if (lines === null) return <p className="mt-6 text-sm text-muted-foreground">Loading…</p>

  return (
    <ClientCheckoutSummary
      lines={lines}
      paymentSettings={paymentSettings}
      mode={mode}
      customerName={customerName}
      customerEmail={customerEmail}
      onSuccess={clearBuyNowLine}
      emptyRedirect="/"
    />
  )
}

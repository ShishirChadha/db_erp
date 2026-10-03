'use client'

import { useEffect } from 'react'
import { track, type GaItem } from '@/lib/analytics'

// Fires GA4's `purchase` exactly once per order.
//
// Rendered by the order page only when the order has actually reached 'paid',
// which is the point this can be trusted: payment confirmation arrives via the
// Razorpay webhook, NOT the client-side checkout.js callback (see
// OrderStatusPoller's comment -- that callback is unreliable and can be missed
// entirely if the customer closes the tab). So the event is driven by committed
// server state rather than by anything the browser observed.
//
// The order page polls and refreshes itself while pending, so this component
// WILL remount after the status flips. sessionStorage is the dedupe: without
// it, every subsequent refresh or back-navigation would report another sale and
// GA4 revenue would drift upward on its own.
export function TrackPurchase({
  orderId, value, discount, items,
}: {
  orderId: string
  value: number
  discount?: number
  items: GaItem[]
}) {
  useEffect(() => {
    const key = `db_purchase_sent_${orderId}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch {
      // Private mode / blocked storage: fall through and send. A duplicate is
      // better than silently losing every conversion.
    }
    track({
      name: 'purchase',
      params: { transaction_id: orderId, currency: 'INR', value, discount, items },
    })
  }, [orderId, value, discount, items])

  return null
}

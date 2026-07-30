'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Payment confirmation arrives asynchronously via the Razorpay webhook, not
// the client-side checkout.js callback -- this just refreshes the page every
// few seconds so the customer sees "paid" as soon as the webhook lands,
// without needing to manually reload.
export function OrderStatusPoller() {
  const router = useRouter()
  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(interval)
  }, [router])
  return null
}

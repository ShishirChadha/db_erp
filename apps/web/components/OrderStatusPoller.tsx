'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

const POLL_MS = 5000
const MAX_POLLS = 36 // ~3 minutes, generous for a webhook that typically lands in seconds

// Payment confirmation arrives asynchronously via the Razorpay webhook, not
// the client-side checkout.js callback -- this just refreshes the page every
// few seconds so the customer sees "paid" as soon as the webhook lands,
// without needing to manually reload. Stops after MAX_POLLS (a webhook that
// hasn't landed by then needs a human, not more polling) and pauses while
// the tab is hidden so a customer who leaves this tab open all day doesn't
// generate refreshes for it the whole time.
export function OrderStatusPoller() {
  const router = useRouter()
  const countRef = useRef(0)

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      countRef.current += 1
      if (countRef.current > MAX_POLLS) {
        clearInterval(interval)
        return
      }
      router.refresh()
    }, POLL_MS)
    return () => clearInterval(interval)
  }, [router])

  return null
}

'use client'

import { useEffect, useState } from 'react'

// Renders a ticking mm:ss countdown to `expiresAt`, the authoritative expiry
// timestamp the `reserve_order_items` RPC actually wrote to
// `web_reservations.expires_at` (see checkout/start route and order/[id]
// page) -- never a client-computed estimate, so this never drifts from what
// the DB will actually enforce when the TTL cron sweeps expired holds.
export function ReservationCountdown({ expiresAt }: { expiresAt: string | null }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!expiresAt) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [expiresAt])

  if (!expiresAt) return null

  const remainingMs = new Date(expiresAt).getTime() - now
  if (remainingMs <= 0) {
    return (
      <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        Your item reservation has expired. Please start checkout again.
      </p>
    )
  }

  const totalSeconds = Math.floor(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const urgent = totalSeconds <= 120

  return (
    <p className={`text-sm font-medium tabular-nums ${urgent ? 'text-red-600' : 'text-muted-foreground'}`}>
      Your items are reserved for {minutes}:{String(seconds).padStart(2, '0')}
    </p>
  )
}

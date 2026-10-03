'use client'

import { useEffect, useRef } from 'react'
import { track, type GaItem } from '@/lib/analytics'

// GA4 `view_cart`. Client island because /cart is a server component.
// Ref-guarded against Strict Mode's double mount in development.
export function TrackViewCart({ items }: { items: GaItem[] }) {
  const sent = useRef(false)
  useEffect(() => {
    if (sent.current) return
    sent.current = true
    const value = items.reduce((sum, i) => sum + i.price * i.quantity, 0)
    track({ name: 'view_cart', params: { currency: 'INR', value, items } })
  }, [items])
  return null
}

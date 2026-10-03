'use client'

import { useEffect, useRef } from 'react'
import { track, type GaItem } from '@/lib/analytics'

// Fires GA4's `view_item` for a product page.
//
// A client island because the product page is a server component (and ISR-
// cached, `revalidate = 60`) -- it cannot fire a browser event itself. Renders
// nothing.
//
// The ref guard matters in development: React Strict Mode mounts effects twice,
// which would double-count every product view.
export function TrackViewItem({ item }: { item: GaItem }) {
  const sent = useRef(false)
  useEffect(() => {
    if (sent.current) return
    sent.current = true
    track({ name: 'view_item', params: { currency: 'INR', value: item.price * item.quantity, items: [item] } })
  }, [item])
  return null
}

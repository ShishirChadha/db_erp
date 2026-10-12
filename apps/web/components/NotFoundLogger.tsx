'use client'

import { useEffect } from 'react'

// Reports the address that produced this 404 page (see /api/seo/404).
export function NotFoundLogger() {
  useEffect(() => {
    fetch('/api/seo/404', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: window.location.pathname, referrer: document.referrer || null }),
      keepalive: true,
    }).catch(() => undefined)
  }, [])
  return null
}

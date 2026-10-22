'use client'

import { useReportWebVitals } from 'next/web-vitals'

// Real-visitor speed for every page: Next measures Core Web Vitals in the
// browser, and this beacons them to /api/vitals so the daily health report can
// see actual load times per page (Vercel's own Speed Insights data can't be
// exported on this plan). Anonymous: path pattern, metric, value, device class
// only -- the server strips ids and query strings (packages/db/src/web-vitals.ts).
//
// Batched per page and sent with sendBeacon when the tab is hidden or the page
// changes, so it never competes with the page's own requests.
type Pending = { route: string; metrics: Array<{ name: string; value: number; rating?: string; navigationType?: string }> }

let pending: Pending | null = null

function device(): 'mobile' | 'desktop' {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop'
}

function flush() {
  if (!pending || pending.metrics.length === 0) return
  const body = JSON.stringify({ ...pending, device: device() })
  pending = null
  try {
    if (!navigator.sendBeacon?.('/api/vitals', new Blob([body], { type: 'application/json' }))) {
      fetch('/api/vitals', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {})
    }
  } catch { /* never let reporting break the page */ }
}

if (typeof window !== 'undefined') {
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
  addEventListener('pagehide', flush)
}

// Defined outside the component so its reference never changes -- the hook
// re-reports everything if it receives a new callback.
const report: Parameters<typeof useReportWebVitals>[0] = metric => {
  if (!['TTFB', 'FCP', 'LCP', 'INP', 'CLS'].includes(metric.name)) return
  const route = location.pathname
  if (pending && pending.route !== route) flush()
  if (!pending) pending = { route, metrics: [] }
  pending.metrics.push({ name: metric.name, value: metric.value, rating: metric.rating, navigationType: metric.navigationType })
  if (pending.metrics.length >= 10) flush()
}

export function WebVitalsReporter() {
  useReportWebVitals(report)
  return null
}

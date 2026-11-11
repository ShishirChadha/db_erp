import { after } from 'next/server'

// Tells the storefront (apps/web) that something it shows has changed, so its
// long-cached pages refresh straight away instead of waiting out the hour.
// See apps/web/app/api/revalidate/route.ts.
//
// Fire-and-forget by design: a website hiccup must never fail or slow an ERP
// save, and the worst case of a missed call is a page an hour out of date --
// checkout re-prices and reserves real stock, so nothing can be oversold.
// Does nothing when WEB_REVALIDATE_SECRET isn't set (local dev).
const STOREFRONT = (process.env.NEXT_PUBLIC_STOREFRONT_URL || 'https://www.digitalbluez.com').replace(/\/+$/, '')

export function revalidateWeb(target: { skuIds: (string | null | undefined)[] } | { all: true }): void {
  const secret = process.env.WEB_REVALIDATE_SECRET?.trim()
  if (!secret) return
  let body: { all: true } | { skuIds: string[] }
  if ('all' in target) body = { all: true }
  else {
    const skuIds = [...new Set(target.skuIds.filter((id): id is string => !!id))]
    if (skuIds.length === 0) return
    body = { skuIds }
  }

  const send = () => fetch(`${STOREFRONT}/api/revalidate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': secret },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  }).then(() => {}, () => {})

  // after() keeps a Vercel function alive to finish this once the response has
  // gone out; a bare un-awaited fetch can be cut off when the function freezes.
  // Outside a request (a script), after() throws, so just send it.
  try { after(send) } catch { void send() }
}

'use client'

// GA4 e-commerce events.
//
// Deliberately a thin typed wrapper, not a tracking framework. Three rules:
//
//   1. It calls `window.gtag` -- the global gtag.js installs, whose body is
//      `dataLayer.push(arguments)`. Never a local helper that pushes a plain
//      Array: gtag.js only interprets arguments-shaped dataLayer entries, and
//      that exact mistake in components/Analytics.tsx silently discarded every
//      consent grant for weeks. One correct call site, here.
//   2. No consent branching. Consent Mode inside gtag.js already decides what
//      to suppress; re-implementing that in app code gives two sources of truth
//      and one of them will drift.
//   3. No queueing or retry. If gtag has not loaded (blocked, or the component
//      rendered before the script), the event is dropped. Analytics is not
//      allowed to be the reason a page breaks.
//
// Field names match GA4's recommended-event schema exactly (`item_id`,
// `item_name`, `currency`, `value`, ...) so GA4's built-in monetisation and
// funnel reports populate without any custom dimensions. Renaming them would
// mean rebuilding those reports by hand.

export interface GaItem {
  item_id: string
  item_name: string
  item_category?: string
  item_brand?: string
  price: number
  quantity: number
}

type ItemsPayload = { currency: 'INR'; value: number; items: GaItem[] }

export type GaEvent =
  | { name: 'view_item'; params: ItemsPayload }
  | { name: 'add_to_cart'; params: ItemsPayload }
  | { name: 'view_cart'; params: ItemsPayload }
  | { name: 'begin_checkout'; params: ItemsPayload & { coupon?: string } }
  | {
      name: 'purchase'
      params: {
        transaction_id: string
        currency: 'INR'
        value: number
        discount?: number
        items: GaItem[]
      }
    }
  | { name: 'search'; params: { search_term: string; results_count: number } }
  | { name: 'view_search_results'; params: { search_term: string; results_count: number } }

export function track(e: GaEvent): void {
  if (typeof window === 'undefined') return
  if (typeof window.gtag !== 'function') return
  try {
    window.gtag('event', e.name, e.params)
  } catch {
    // Never let an analytics failure surface to the customer.
  }
}

// Convenience for the common single-line case.
export function itemsValue(items: GaItem[]): number {
  return items.reduce((sum, i) => sum + i.price * i.quantity, 0)
}

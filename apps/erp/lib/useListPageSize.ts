'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

// Global, owner-configurable rows-per-page used by every paginated list page
// (Stock, Sales, Customers, Vendors, Invoices, Purchases, Purchase Orders, etc.)
// -- see app/api/settings/list-page-size/route.ts and
// components/ListPageSizeManager.tsx. Module-level cache (same idiom as
// lib/useCustomOptions.ts) so the ~20 pages that read this don't each fire their
// own request -- one fetch, shared, refreshed on save from Settings.
export const DEFAULT_LIST_PAGE_SIZE = 50

let cached: number | null = null
let cachedAt = 0
let inFlight: Promise<number> | null = null
const CACHE_TTL_MS = 60_000

function getCached(): number | null {
  if (cached !== null && Date.now() - cachedAt < CACHE_TTL_MS) return cached
  return null
}

async function fetchPageSize(): Promise<number> {
  if (inFlight) return inFlight
  inFlight = (async () => {
    const res = await apiFetch('/api/settings/list-page-size')
    const pageSize = res.ok ? (await res.json()).page_size : DEFAULT_LIST_PAGE_SIZE
    cached = pageSize
    cachedAt = Date.now()
    return pageSize
  })().finally(() => { inFlight = null })
  return inFlight
}

// Synchronous getter for a page's initial useState -- returns the last-known value
// (falling back to the default) so a page never renders with a wrong page size that
// then jarringly changes once the fetch resolves, on every render after the first.
export function getCachedListPageSize(): number {
  return getCached() ?? DEFAULT_LIST_PAGE_SIZE
}

export function useListPageSize(): number {
  const [pageSize, setPageSize] = useState<number>(() => getCachedListPageSize())

  useEffect(() => {
    let cancelled = false
    const cachedValue = getCached()
    if (cachedValue !== null) {
      setPageSize(cachedValue)
      return
    }
    fetchPageSize().then((value) => { if (!cancelled) setPageSize(value) })
    return () => { cancelled = true }
  }, [])

  return pageSize
}

// Called after a successful PATCH in Settings -- clears the cache so the next
// page navigation/fetch picks up the new value (a page already mounted elsewhere
// keeps its current page size until it next mounts, same as any other cached
// setting in this app).
export function invalidateListPageSizeCache() {
  cached = null
}

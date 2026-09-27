'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'

export interface CustomOption {
  id: string
  category: string
  value: string
  is_active: boolean
  sort_order: number
}

// Module-level cache, shared by every component using this hook -- previously
// every single mount (a page can easily mount 2-3 dropdowns backed by this)
// fetched fresh from /api/custom-options, with no cache at all. TTL matches
// lib/auth/redact.ts's redaction_rules cache idiom; the in-flight map collapses
// N simultaneous mounts for the same category into one network request instead
// of N.
const CACHE_TTL_MS = 60_000
const cache = new Map<string, { options: CustomOption[]; at: number }>()
const inFlight = new Map<string, Promise<CustomOption[]>>()

function getCached(category: string): CustomOption[] | null {
  const entry = cache.get(category)
  if (entry && Date.now() - entry.at < CACHE_TTL_MS) return entry.options
  return null
}

async function fetchOptions(category: string): Promise<CustomOption[]> {
  const existing = inFlight.get(category)
  if (existing) return existing

  const promise = (async () => {
    const res = await apiFetch(`/api/custom-options?category=${encodeURIComponent(category)}`)
    const options: CustomOption[] = res.ok ? await res.json() : []
    cache.set(category, { options, at: Date.now() })
    return options
  })().finally(() => { inFlight.delete(category) })

  inFlight.set(category, promise)
  return promise
}

// Generic dropdown-values hook, backed by the `custom_options` table -- any page can
// pull a named list (category) of owner-curated values. Reads work for any signed-in
// role; only the owner can actually add/edit values (enforced server-side).
export function useCustomOptions(category: string) {
  const [options, setOptions] = useState<CustomOption[]>(() => getCached(category) ?? [])
  const [loading, setLoading] = useState<boolean>(() => getCached(category) === null)

  useEffect(() => {
    let cancelled = false
    const cached = getCached(category)
    if (cached) {
      setOptions(cached)
      setLoading(false)
      return
    }
    setLoading(true)
    fetchOptions(category).then((opts) => {
      if (!cancelled) { setOptions(opts); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [category])

  // Bypasses the cache -- used after addOption, and available for any caller
  // that knows the underlying data just changed elsewhere.
  const refresh = useCallback(async () => {
    setLoading(true)
    cache.delete(category)
    const opts = await fetchOptions(category)
    setOptions(opts)
    setLoading(false)
  }, [category])

  const addOption = async (value: string) => {
    const res = await apiFetch('/api/custom-options', {
      method: 'POST',
      body: JSON.stringify({ category, value }),
    })
    if (res.ok) await refresh()
    return res.ok
  }

  return { options, values: options.map(o => o.value), loading, addOption, refresh }
}

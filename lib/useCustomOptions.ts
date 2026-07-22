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

// Generic dropdown-values hook, backed by the `custom_options` table -- any page can
// pull a named list (category) of owner-curated values. Reads work for any signed-in
// role; only the owner can actually add/edit values (enforced server-side).
export function useCustomOptions(category: string) {
  const [options, setOptions] = useState<CustomOption[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch(`/api/custom-options?category=${encodeURIComponent(category)}`)
    if (res.ok) setOptions(await res.json())
    setLoading(false)
  }, [category])

  useEffect(() => { refresh() }, [refresh])

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

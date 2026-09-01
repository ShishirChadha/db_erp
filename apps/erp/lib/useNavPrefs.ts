'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRole, type UiPreferences } from '@/lib/auth/useRole'
import { apiFetch } from '@/lib/api-client'

export const MAX_PINNED_ITEMS = 6

// Personal sidebar customization (hide/pin/reorder) -- a display-layer preference
// only, never a substitute for canSee()'s role-based filtering in sidebar.tsx. A
// hidden-but-still-allowed item stays reachable via ⌘K search and "Reset to default".
export function useNavPrefs() {
  const { uiPreferences, loading } = useRole()
  const [prefs, setPrefs] = useState<UiPreferences>({})

  useEffect(() => {
    if (!loading) setPrefs(uiPreferences)
  }, [loading, uiPreferences])

  const save = useCallback((patch: Partial<UiPreferences>) => {
    setPrefs(prev => ({ ...prev, ...patch }))
    apiFetch('/api/profile/preferences', { method: 'PATCH', body: JSON.stringify(patch) }).catch(() => {})
  }, [])

  const toggleHidden = useCallback((key: string) => {
    const hidden = new Set(prefs.hiddenItems || [])
    if (hidden.has(key)) hidden.delete(key)
    else hidden.add(key)
    save({ hiddenItems: Array.from(hidden) })
  }, [prefs.hiddenItems, save])

  const togglePinned = useCallback((key: string) => {
    const pinned = new Set(prefs.pinnedItems || [])
    if (pinned.has(key)) {
      pinned.delete(key)
    } else {
      if (pinned.size >= MAX_PINNED_ITEMS) return
      pinned.add(key)
    }
    save({ pinnedItems: Array.from(pinned) })
  }, [prefs.pinnedItems, save])

  const setGroupOrder = useCallback((order: string[]) => save({ groupOrder: order }), [save])

  const reset = useCallback(() => save({ hiddenItems: [], pinnedItems: [], groupOrder: [] }), [save])

  return {
    prefs,
    hiddenItems: prefs.hiddenItems || [],
    pinnedItems: prefs.pinnedItems || [],
    groupOrder: prefs.groupOrder || [],
    toggleHidden,
    togglePinned,
    setGroupOrder,
    reset,
  }
}

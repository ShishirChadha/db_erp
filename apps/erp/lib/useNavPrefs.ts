'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRole, type UiPreferences } from '@/lib/auth/useRole'
import { apiFetch } from '@/lib/api-client'

export const MAX_PINNED_ITEMS = 6

// Stable fallbacks -- `prefs.hiddenItems || []` etc. below must never mint a
// fresh [] / {} literal on every render: sidebar.tsx's effect depends on a
// value derived from these (visibleGroups), and a new reference each render
// re-fires that effect every render forever ("Maximum update depth exceeded"),
// which only ever showed up for an account with no saved prefs yet -- i.e.
// every default employee login -- since an account that already has a real
// stored array/object there never hit the `|| fallback` branch at all.
const EMPTY_ARRAY: readonly string[] = []
const EMPTY_PARENTS: Readonly<Record<string, string>> = {}

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

  // parentKey is either another top-level entry's key (nest under it) or
  // NAV_TOP_LEVEL to stand alone -- see lib/nav-tree.ts for how this is
  // actually applied to the menu tree.
  const setItemParent = useCallback((itemKey: string, parentKey: string) => {
    const next = { ...(prefs.itemParents || {}) }
    next[itemKey] = parentKey
    save({ itemParents: next })
  }, [prefs.itemParents, save])

  const clearItemParent = useCallback((itemKey: string) => {
    const next = { ...(prefs.itemParents || {}) }
    delete next[itemKey]
    save({ itemParents: next })
  }, [prefs.itemParents, save])

  const reset = useCallback(() => save({ hiddenItems: [], pinnedItems: [], groupOrder: [], itemParents: {} }), [save])

  return {
    prefs,
    hiddenItems: prefs.hiddenItems || [],
    pinnedItems: prefs.pinnedItems || [],
    groupOrder: prefs.groupOrder || [],
    itemParents: prefs.itemParents || {},
    toggleHidden,
    togglePinned,
    setGroupOrder,
    setItemParent,
    clearItemParent,
    reset,
  }
}

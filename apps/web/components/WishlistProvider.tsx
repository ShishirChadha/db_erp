'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createBrowserSupabaseClient } from '@db/db/browser'
import { useCustomerSession } from './CustomerSessionProvider'

interface WishlistContextValue {
  ready: boolean
  loggedIn: boolean
  isSaved: (skuId: string) => boolean
  isPending: (skuId: string) => boolean
  toggle: (skuId: string) => Promise<'login-required' | void>
}

const WishlistContext = createContext<WishlistContextValue | null>(null)

// One wishlist_items query for the whole page, shared by every WishlistButton
// via context -- previously each button (one per product card, so 60-100 per
// category grid) independently called supabase.auth.getUser() plus its own DB
// read just to paint a heart icon. The session itself (loggedIn/userId) is now
// resolved once, higher up, by <CustomerSessionProvider> (shared with
// HeaderAccountState) -- this provider only adds the wishlist-specific query.
export function WishlistProvider({ children }: { children: ReactNode }) {
  const { ready: sessionReady, loggedIn, userId } = useCustomerSession()
  const [ready, setReady] = useState(false)
  const [ids, setIds] = useState<Set<string>>(new Set())
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!sessionReady) return
    if (!loggedIn || !userId) {
      setReady(true)
      return
    }
    let cancelled = false
    ;(async () => {
      const supabase = createBrowserSupabaseClient()
      const { data } = await supabase.from('wishlist_items').select('sku_id').eq('customer_id', userId)
      if (!cancelled) {
        setIds(new Set((data || []).map((r: any) => r.sku_id)))
        setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionReady, loggedIn, userId])

  const toggle = useCallback(
    async (skuId: string) => {
      if (!loggedIn || !userId) return 'login-required' as const
      setPendingIds((prev) => new Set(prev).add(skuId))
      try {
        const supabase = createBrowserSupabaseClient()
        if (ids.has(skuId)) {
          await supabase.from('wishlist_items').delete().eq('customer_id', userId).eq('sku_id', skuId)
          setIds((prev) => {
            const next = new Set(prev)
            next.delete(skuId)
            return next
          })
        } else {
          await supabase.from('wishlist_items').insert({ customer_id: userId, sku_id: skuId })
          setIds((prev) => new Set(prev).add(skuId))
        }
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev)
          next.delete(skuId)
          return next
        })
      }
    },
    [loggedIn, userId, ids]
  )

  const value = useMemo<WishlistContextValue>(
    () => ({
      ready,
      loggedIn,
      isSaved: (skuId: string) => ids.has(skuId),
      isPending: (skuId: string) => pendingIds.has(skuId),
      toggle,
    }),
    [ready, loggedIn, ids, pendingIds, toggle]
  )

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>
}

export function useWishlist(): WishlistContextValue {
  const ctx = useContext(WishlistContext)
  if (!ctx) {
    throw new Error('useWishlist() must be called within <WishlistProvider> (mounted in app/layout.tsx)')
  }
  return ctx
}

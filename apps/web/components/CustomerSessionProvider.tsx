'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createBrowserSupabaseClient } from '@db/db/browser'

interface CustomerSessionContextValue {
  ready: boolean
  loggedIn: boolean
  userId: string | null
}

const CustomerSessionContext = createContext<CustomerSessionContextValue | null>(null)

// One supabase.auth.getUser() call per page load, shared by WishlistProvider
// and HeaderAccountState -- both previously resolved the customer session
// independently on every single page mount (including fully static pages
// like /faq, /terms, /blog/...), doubling the redundant round trip. This
// provider owns only the session-identity lookup; each consumer still does
// its own additional data fetch (wishlist_items query / the header-state
// route's cart count + display name) since those need genuinely different
// shapes/sources that can't cleanly share one fetch.
export function CustomerSessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const supabase = createBrowserSupabaseClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (cancelled) return
      if (user) {
        setUserId(user.id)
        setLoggedIn(true)
      }
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo<CustomerSessionContextValue>(
    () => ({ ready, loggedIn, userId }),
    [ready, loggedIn, userId]
  )

  return <CustomerSessionContext.Provider value={value}>{children}</CustomerSessionContext.Provider>
}

export function useCustomerSession(): CustomerSessionContextValue {
  const ctx = useContext(CustomerSessionContext)
  if (!ctx) {
    throw new Error('useCustomerSession() must be called within <CustomerSessionProvider> (mounted in app/layout.tsx)')
  }
  return ctx
}

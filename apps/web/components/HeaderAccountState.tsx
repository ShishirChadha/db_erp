'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useCustomerSession } from './CustomerSessionProvider'

interface HeaderState {
  loggedIn: boolean
  firstName: string | null
  cartCount: number
}

const INITIAL: HeaderState = { loggedIn: false, firstName: null, cartCount: 0 }

// Fetched client-side after hydration so SiteHeader itself never reads
// cookies -- that's what keeps the root layout, and every storefront page
// under it, statically cacheable. See app/api/account/header-state/route.ts.
//
// The customer session itself is now resolved once, up in
// <CustomerSessionProvider> (shared with WishlistProvider). When that
// resolves to "not logged in" this skips the /api/account/header-state round
// trip entirely -- an anonymous visitor's session there can only come back as
// the same INITIAL shape. When logged in, the route call still runs: it
// needs data (display name from customer_profiles, a live cart_items count)
// that only a server-side, RLS-scoped query can provide, so that lookup
// stays separate rather than forcing an awkward merge.
export function HeaderAccountState() {
  const { ready: sessionReady, loggedIn: sessionLoggedIn } = useCustomerSession()
  const [state, setState] = useState<HeaderState>(INITIAL)

  useEffect(() => {
    if (!sessionReady) return
    if (!sessionLoggedIn) {
      setState(INITIAL)
      return
    }
    let cancelled = false
    fetch('/api/account/header-state')
      .then((res) => (res.ok ? res.json() : INITIAL))
      .then((data: HeaderState) => {
        if (!cancelled) setState(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sessionReady, sessionLoggedIn])

  return (
    <>
      <Link
        href="/cart"
        className="relative shrink-0 text-muted-foreground transition-colors hover:text-brand-orange"
        aria-label="Cart"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
          <path d="M5 9h14l-1.2 9.5a2 2 0 01-2 1.5H8.2a2 2 0 01-2-1.5L5 9z" />
          <path d="M8 9V6.5a4 4 0 018 0V9" />
        </svg>
        {state.cartCount > 0 && (
          <span className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-brand-orange text-[10px] font-bold text-white">
            {state.cartCount}
          </span>
        )}
      </Link>
      {state.loggedIn ? (
        <Link href="/account" className="shrink-0 text-sm font-medium text-muted-foreground hover:text-brand-orange">
          {state.firstName || 'Account'}
        </Link>
      ) : (
        <Link
          href="/login"
          className="shrink-0 rounded-full bg-foreground px-3.5 py-1.5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
        >
          Log in
        </Link>
      )}
    </>
  )
}

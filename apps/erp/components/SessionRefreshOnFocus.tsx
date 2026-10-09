'use client'

import { useEffect } from 'react'
import { createBrowserSupabaseClient } from '@db/db/browser'

// Keeps the session's access token fresh across idle periods that a
// backgrounded tab's own autoRefreshToken ticker can miss -- browsers
// throttle/suspend JS timers in background tabs, and a laptop sleeping pauses
// them outright. Without this, the FIRST server-rendered request after the
// ~1hr access token has gone stale (a new tab, a hard reload, or just
// reopening the ERP after the laptop woke up) gets bounced straight to
// /login by getLayoutSessionUser() (lib/auth/session.ts) -- which
// deliberately never tries to refresh the token itself, since a Server
// Component can't persist a rotated cookie back to the browser. This closes
// that race in the overwhelmingly common case: the tab regains focus before
// anything in it is clicked.
//
// supabase-js's getSession() already refreshes automatically when the stored
// access token is expired/near-expiry and a valid refresh token is present
// -- no network call at all if the token is still fresh, so polling this on
// every focus/visibility change costs nothing in the common case.
export function SessionRefreshOnFocus() {
  useEffect(() => {
    const supabase = createBrowserSupabaseClient()
    const check = () => {
      if (document.visibilityState !== 'visible') return
      supabase.auth.getSession().catch(() => {})
    }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    check() // also covers the tab already being open/visible when this mounts
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [])

  return null
}

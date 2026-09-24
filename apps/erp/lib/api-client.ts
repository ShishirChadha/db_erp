// lib/api-client.ts
import { createClient } from '@/lib/supabase/client'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function apiFetch(url: string, options: RequestInit = {}) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const method = (options.method || 'GET').toUpperCase()

  // A transient network hiccup on the way to a busy API route (which itself makes
  // several outbound Supabase calls, e.g. /api/stock and /api/sales's search/
  // enrichment lookups) throws here as a raw TypeError ("Failed to fetch") rather
  // than an HTTP error -- confirmed reproducible against this app's own dev server,
  // and reported by real users on flaky mobile/wifi connections (2026-09-18: "Unable
  // to Fetch" recurring across Sales/Live Stock/most list pages). GET requests are
  // safe to retry (nothing was mutated); a mutating request is not, so it's left to
  // surface the failure immediately rather than risk a double-submit. Tuned down to
  // two attempts with a flat, shorter backoff (2026-09-23) -- three attempts at
  // 500ms*attempt could stack up to 1.5s of pure sleep on top of each attempt's own
  // network time, turning a brief blip into a multi-second stall on a flaky mobile
  // connection; this keeps a retry for real transient failures while shrinking the
  // worst case.
  const maxAttempts = method === 'GET' ? 2 : 1
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { ...options, headers })
      // 401 here always means "no valid session" (every route's convention -- 403 is
      // "signed in but not allowed," which is left alone). Before this feature, a
      // session basically never went invalid mid-use; now device-limit kicks and
      // force-logoff from Settings > Active Devices make that a routine event, and
      // without this a revoked session just showed every page's own generic fetch-
      // failed error forever instead of a clean bounce back to sign-in.
      if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        supabase.auth.signOut().finally(() => {
          window.location.href = '/login?reason=signed_out'
        })
      }
      return res
    } catch (err) {
      lastErr = err
      if (attempt === maxAttempts) throw err
      await sleep(400)
    }
  }
  throw lastErr
}
// lib/api-client.ts
import { createClient } from '@/lib/supabase/client'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

const supabase = createClient()

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Cached separately from Supabase's own in-memory session so apiFetch doesn't
// pay a getSession() call (cookie read + potential refresh-check) on every one
// of the several requests a single page load fires. Invalidated by the
// onAuthStateChange listener below, not by a TTL -- Supabase tells us exactly
// when the token changes, so there's no need to guess a skew window.
let cachedToken: string | null = null
let primed = false
let primingPromise: Promise<void> | null = null

async function primeToken() {
  const { data: { session } } = await supabase.auth.getSession()
  cachedToken = session?.access_token ?? null
  primed = true
}

if (typeof window !== 'undefined') {
  supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
    cachedToken = event === 'SIGNED_OUT' ? null : (session?.access_token ?? null)
    primed = true
  })
}

async function getToken(forceRefresh = false): Promise<string | null> {
  if (forceRefresh) {
    primed = false
    cachedToken = null
  }
  if (primed) return cachedToken
  if (!primingPromise) primingPromise = primeToken().finally(() => { primingPromise = null })
  await primingPromise
  return cachedToken
}

// GET requests get a longer budget than mutations since several of this app's
// list endpoints fan out into multiple Supabase queries server-side (see
// /api/sales, /api/stock's enrichment batches) -- a mutation hanging this long
// is much more likely to be a real backend problem than transient latency.
const DEFAULT_TIMEOUT_MS = { GET: 15_000, MUTATE: 30_000 }
// Statuses worth retrying once for a GET -- all are transient by definition
// (rate-limited, timed-out gateway, or a backend temporarily unavailable),
// never a 4xx that reflects a real client-side problem.
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])

export interface ApiFetchOptions extends RequestInit {
  timeoutMs?: number
}

// A transient network hiccup on the way to a busy API route (which itself makes
// several outbound Supabase calls) throws here as a raw TypeError ("Failed to
// fetch") rather than an HTTP error -- confirmed reproducible against this app's
// own dev server, and reported by real users on flaky mobile/wifi connections.
// GET requests are safe to retry (nothing was mutated); a mutating request is
// not, so it's left to surface the failure immediately rather than risk a
// double-submit. Also retries a GET once on a transient HTTP status
// (RETRYABLE_STATUSES) -- previously only a thrown exception was retried, so a
// 504 timeout (this app's most common real failure under load) was never
// retried at all.
async function doFetch(url: string, init: RequestInit, method: string, signal: AbortSignal): Promise<Response> {
  const maxAttempts = method === 'GET' ? 2 : 1
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal })
      if (RETRYABLE_STATUSES.has(res.status) && attempt < maxAttempts) {
        await sleep(300 + Math.random() * 200)
        continue
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

export async function apiFetch(url: string, options: ApiFetchOptions = {}) {
  const { timeoutMs, ...init } = options
  const method = (init.method || 'GET').toUpperCase()

  const budget = timeoutMs ?? (method === 'GET' ? DEFAULT_TIMEOUT_MS.GET : DEFAULT_TIMEOUT_MS.MUTATE)
  // AbortSignal.any combines the caller's own signal (e.g. a component
  // unmount abort) with our timeout, so neither cancellation path is lost.
  const timeoutSignal = AbortSignal.timeout(budget)
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal

  const buildHeaders = (token: string | null) => ({
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  })

  const token = await getToken()
  let res = await doFetch(url, { ...init, headers: buildHeaders(token) }, method, signal)

  // 401 here always means "no valid session" (every route's convention -- 403 is
  // "signed in but not allowed," which is left alone). A single 401 can be the
  // stale-cached-token race (the memoized client refreshed after we read the
  // cache) rather than a genuinely revoked session -- re-prime the token and
  // retry exactly once, for any method, before treating it as a real sign-out.
  // Safe to retry a mutation here specifically because a 401 means the request
  // was rejected before it ever reached the route's mutation logic -- unlike
  // the network-error case above, there's no ambiguity about whether it executed.
  if (res.status === 401) {
    const fresh = await getToken(true)
    if (fresh && fresh !== token) {
      res = await doFetch(url, { ...init, headers: buildHeaders(fresh) }, method, signal)
    }
  }

  if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    // Before this feature, a session basically never went invalid mid-use; now
    // device-limit kicks and force-logoff from Settings > Active Devices make
    // that a routine event, and without this a revoked session just showed
    // every page's own generic fetch-failed error forever instead of a clean
    // bounce back to sign-in.
    supabase.auth.signOut().finally(() => {
      window.location.href = '/login?reason=signed_out'
    })
  }

  return res
}

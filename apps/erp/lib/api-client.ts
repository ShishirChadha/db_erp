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
// Raised from 15s after a real "Signal timeout" report on Sold Stock traced to
// Supabase's free-tier connection-pool cold-start behavior (see docs/decisions.md,
// 2026-09-28 stock-perf entry) occasionally taking 10-13s on its own -- 15s left
// almost no room for a cold-started request to actually finish.
const DEFAULT_TIMEOUT_MS = { GET: 20_000, MUTATE: 30_000 }
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
//
// `budget` is passed through rather than a single pre-built AbortSignal -- a
// timeout signal is a one-shot object that stays aborted forever once it fires,
// so the previous version's "retry" on a GET timeout reused the *same* already-
// fired signal on attempt 2, which made fetch() reject instantly with the exact
// same TimeoutError ("signal timed out" / "Signal timeout" to the user) instead
// of actually giving the retry its own fresh time budget. A fresh
// AbortSignal.timeout(budget) is built per attempt below so a retry is a real
// second chance, not a guaranteed instant repeat of the same failure -- and
// since the pool having just been hit once makes it more likely to be warm by
// the second attempt, this materially improves the odds a cold-start burst
// self-heals instead of surfacing to the user.
async function doFetch(url: string, init: RequestInit, method: string, budget: number, callerSignal?: AbortSignal | null): Promise<Response> {
  const maxAttempts = method === 'GET' ? 2 : 1
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timeoutSignal = AbortSignal.timeout(budget)
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal
    try {
      const res = await fetch(url, { ...init, signal })
      if (RETRYABLE_STATUSES.has(res.status) && attempt < maxAttempts) {
        await sleep(300 + Math.random() * 200)
        continue
      }
      return res
    } catch (err) {
      lastErr = err
      // The caller's own signal firing (e.g. component unmount) means the
      // response is no longer wanted -- retrying would be pure waste.
      if (callerSignal?.aborted || attempt === maxAttempts) throw err
      await sleep(400)
    }
  }
  throw lastErr
}

export async function apiFetch(url: string, options: ApiFetchOptions = {}) {
  const { timeoutMs, ...init } = options
  const method = (init.method || 'GET').toUpperCase()

  const budget = timeoutMs ?? (method === 'GET' ? DEFAULT_TIMEOUT_MS.GET : DEFAULT_TIMEOUT_MS.MUTATE)

  // A FormData body (e.g. the processed-image upload route) must NOT get a
  // manual Content-Type -- the browser sets its own multipart boundary, and
  // overriding it here would break the upload.
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData
  const buildHeaders = (token: string | null) => ({
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(init.headers as Record<string, string>),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  })

  const token = await getToken()
  let res = await doFetch(url, { ...init, headers: buildHeaders(token) }, method, budget, init.signal)

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
      res = await doFetch(url, { ...init, headers: buildHeaders(fresh) }, method, budget, init.signal)
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

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
  // surface the failure immediately rather than risk a double-submit. Bumped from a
  // single retry to two, with a longer backoff, after one retry proved insufficient
  // for blips longer than ~400ms.
  const maxAttempts = method === 'GET' ? 3 : 1
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetch(url, { ...options, headers })
    } catch (err) {
      lastErr = err
      if (attempt === maxAttempts) throw err
      await sleep(500 * attempt)
    }
  }
  throw lastErr
}
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

  try {
    return await fetch(url, { ...options, headers })
  } catch (err) {
    // A transient network hiccup on the way to a busy API route (which itself makes
    // several outbound Supabase calls, e.g. /api/stock and /api/sales's search/
    // enrichment lookups) throws here as a raw TypeError ("Failed to fetch") rather
    // than an HTTP error -- confirmed reproducible against this app's own dev server.
    // GET requests are safe to retry once (nothing was mutated); a mutating request
    // is not, so it's left to surface the failure immediately rather than risk a
    // double-submit. One short retry is what turns an occasional real network blip
    // into a normal page load instead of a visible "unable to fetch" error.
    if (method !== 'GET') throw err
    await sleep(400)
    return fetch(url, { ...options, headers })
  }
}
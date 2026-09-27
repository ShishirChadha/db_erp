import { createBrowserClient } from '@supabase/ssr'

let client: ReturnType<typeof createBrowserClient> | null = null

// A memoized singleton -- every call site used to construct its own client,
// which meant N independent GoTrueClient instances each running their own
// autoRefreshToken ticker over the same cookie storage. Two instances racing
// to refresh a near-expiry token both call Supabase's refresh endpoint; since
// refresh tokens rotate, the loser gets `invalid_refresh_token`, its session
// clears, and the next request goes out with no Authorization header at all --
// this is the root cause of the intermittent "failed to fetch" / spurious
// sign-outs. One client, one ticker, no race.
export function createBrowserSupabaseClient() {
  // Guard against an accidental server-side import sharing state across
  // requests -- always hand back a fresh, unmemoized client there.
  if (typeof window === 'undefined') {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return client
}

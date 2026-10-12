import { createBrowserClient } from '@supabase/ssr'

let client: ReturnType<typeof createBrowserClient> | null = null

// apps/erp (staff login) and apps/web (customer accounts) share one Supabase
// project and this one package, so without a distinct cookie name per app
// they'd both write the SAME cookie (@supabase/ssr defaults to
// `sb-<project-ref>-auth-token`, derived purely from the URL). Cookies are
// never port-scoped, so in dev both apps run on "localhost" and collide for
// real: each app's own autoRefreshToken ticker refreshes that shared cookie
// independently, refresh tokens rotate on every refresh, and the LOSER of
// that race gets `invalid_refresh_token` and is signed out -- this was the
// actual cause of "the dev server signs off after a while" (production
// never showed it, because erp.digitalbluez.com and digitalbluez.com are
// different hostnames and so get naturally separate, non-colliding cookies).
// NEXT_PUBLIC_SUPABASE_COOKIE_NAME (set per app, see .env.local) fixes this
// even in production, rather than relying on hostnames alone to keep it safe.
const cookieName = process.env.NEXT_PUBLIC_SUPABASE_COOKIE_NAME
const cookieOptions = cookieName ? { name: cookieName } : undefined

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
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookieOptions }
    )
  }
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookieOptions }
    )
  }
  return client
}

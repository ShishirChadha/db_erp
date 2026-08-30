import { createClient } from '@supabase/supabase-js'

// Stateless anon client for publicly-readable data (public_* views, published
// blog posts, etc). Deliberately does not touch cookies/next-headers, unlike
// server.ts's createServerSupabaseClient -- so callers that only ever read
// public data stay static/ISR-eligible instead of opting the whole route
// (and, if called from a shared layout, the whole site) into dynamic
// rendering just because cookies() was read.
export function createPublicSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

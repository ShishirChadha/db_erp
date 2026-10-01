// Force IPv4 when connecting to the Supabase backend.
//
// Why this exists: the self-hosted backend is published through Cloudflare,
// which adds AAAA records to db.digitalbluez.com. Hosted Supabase
// (*.supabase.co) is IPv4-only, so this code path never existed before the
// self-host migration. IPv6 is not actually routable from the Vercel runtime
// (nor from several of our own networks), so Node's "Happy Eyeballs"
// dual-stack connect (net.autoSelectFamily, on by default since Node 20)
// intermittently picks the IPv6 address on a fresh TCP connection, burns
// autoSelectFamilyAttemptTimeout, and fetch() rejects with
// `TypeError: fetch failed / AggregateError (ETIMEDOUT)` after ~500ms.
//
// The failure is invisible server-side -- the connection never completes, so
// nothing reaches Envoy/PostgREST and no error appears in their logs. What it
// *looked* like was being signed out at random: supabase-js returns
// `{ data: null, error }`, getSessionUser() reads the null profile as "no
// session", the route answers 401, and lib/api-client.ts's 401 handler calls
// supabase.auth.signOut(). See docs/decisions.md.
//
// Only bursts of parallel requests were affected, because a warm keep-alive
// socket is reused, and only a *new* connection re-runs family selection --
// which is why one click that fans out into a dozen requests triggered it and
// a quiet page did not.
export async function register() {
  // node:dns/node:net do not exist in the Edge runtime.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const dns = await import('node:dns')
  const net = await import('node:net')

  // Order DNS results IPv4-first instead of the resolver's default order.
  dns.setDefaultResultOrder('ipv4first')

  // ipv4first alone still leaves Happy Eyeballs racing both families, so also
  // turn it off and connect strictly in resolved order. Guarded because this
  // API only exists on Node >= 20.
  net.setDefaultAutoSelectFamily?.(false)
}

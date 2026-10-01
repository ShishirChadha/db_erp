// Node.js-runtime half of instrumentation.ts -- kept in its own module so the
// node:dns / node:net imports are never pulled into the Edge bundle. Importing
// them behind a `process.env.NEXT_RUNTIME` check inside register() is not
// enough: the bundler cannot see through the runtime branch and warns
// "A Node.js module is loaded which is not supported in the Edge Runtime".
// Splitting the file is the pattern Next documents for this.
import dns from 'node:dns'
import net from 'node:net'

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

// Order DNS results IPv4-first instead of the resolver's default order.
dns.setDefaultResultOrder('ipv4first')

// ipv4first alone still leaves Happy Eyeballs racing both families, so also
// turn it off and connect strictly in resolved order. Guarded because this
// API only exists on Node >= 20.
net.setDefaultAutoSelectFamily?.(false)

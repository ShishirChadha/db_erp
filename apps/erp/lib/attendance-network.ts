import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'

// Office-network gate for self-service punching.
//
// SCOPE AND HONEST LIMITS -- read this before relying on it.
//
// This stops a staff member casually punching in from home or from mobile data.
// It is a deterrent, not a cryptographic guarantee, and the reason is worth
// stating plainly: the client IP can only ever be learned from an HTTP header,
// and a header is only trustworthy if the proxy in front of this app
// OVERWRITES whatever the client sent under that name.
//
// getTrustedClientIp() below therefore reads only x-vercel-forwarded-for (which
// Vercel's edge sets and overwrites on every request -- this app deploys to
// Vercel, see apps/erp/vercel.json), or a header named by
// ATTENDANCE_TRUSTED_IP_HEADER for some other deployment. It does NOT fall back
// to x-forwarded-for, because that header is client-settable and a fallback
// would be reachable exactly when nothing is sanitising it. If this app is ever
// moved off Vercel without setting that env var, enforcement stops being able
// to verify anyone and refuses self-punches rather than trusting a forgeable
// value -- loud, not silent.
//
// Say this to the owner rather than implying the rule is unbreakable:
// docs/bible/processes/configure-office-punch-networks.md.
//
// Supervisor marking and corrections are deliberately exempt (they are
// owner/manager-gated, require a written reason, and are fully audited), so the
// owner can still fix a record from home.

const ENFORCEMENT_CATEGORY = 'attendance_settings'
const ENFORCEMENT_ON = 'ip_enforcement_on'

// Read fresh on every call, deliberately NOT cached.
//
// The obvious optimisation here is a module-level TTL cache (the idiom
// lib/auth/redact.ts uses) with an invalidate() that the Settings write path
// calls. That is WRONG for this particular check, and it was a real bug caught
// by scripts/verify-attendance.mjs: module state is per-instance, so the
// invalidate() running inside /api/settings/attendance-networks can never
// reach the copy of this module loaded by /api/attendance/punch -- separate
// serverless functions on Vercel, separate bundles under Turbopack in dev.
// Turning enforcement on would then appear to do nothing until the TTL
// happened to lapse, which is exactly the kind of "security setting silently
// not in effect" behaviour worth paying two trivial queries to avoid.
//
// And the cost genuinely is trivial: punching happens a few dozen times a day
// across the whole shop, not per page view.
async function getState(): Promise<{ enforced: boolean; activeCount: number }> {
  const [{ data: toggle }, { count }] = await Promise.all([
    supabaseAdmin
      .from('custom_options')
      .select('value')
      .eq('category', ENFORCEMENT_CATEGORY)
      .eq('value', ENFORCEMENT_ON)
      .eq('is_active', true)
      .maybeSingle(),
    supabaseAdmin
      .from('attendance_networks')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true),
  ])
  return { enforced: !!toggle, activeCount: count || 0 }
}

export type IpVerdict =
  | { ok: true; check: 'allowed' | 'not_enforced'; ip: string | null }
  | { ok: false; ip: string | null; reason: 'off_network' | 'no_ip' }

export async function checkPunchNetwork(req: NextRequest): Promise<IpVerdict> {
  const ip = getTrustedClientIp(req)
  const { enforced, activeCount } = await getState()

  // Fail OPEN when enforcement is off, and also when it is on but no active
  // range exists. The second case is deliberate: the alternative is an owner who
  // flips the toggle before adding a range and instantly bricks punching for the
  // whole shop. The Settings tab shows a warning banner in that state instead.
  if (!enforced || activeCount === 0) return { ok: true, check: 'not_enforced', ip }

  // An unverifiable origin is exactly what the rule exists to exclude.
  if (!ip) return { ok: false, ip: null, reason: 'no_ip' }

  // Containment is tested by Postgres, not in JS: the inet/cidr operators
  // handle IPv4, IPv6 and prefix lengths correctly, and a hand-rolled subnet
  // match is where this kind of check usually breaks. An unparseable IP makes
  // the cast raise, which is caught below and treated as off-network.
  try {
    const { data, error } = await supabaseAdmin.rpc('attendance_ip_allowed', { p_ip: ip })
    if (error) throw error
    return data === true
      ? { ok: true, check: 'allowed', ip }
      : { ok: false, ip, reason: 'off_network' }
  } catch {
    return { ok: false, ip, reason: 'off_network' }
  }
}

export function offNetworkMessage(reason: 'off_network' | 'no_ip'): string {
  return reason === 'no_ip'
    ? 'Could not verify your network. Punch in from the shop wifi.'
    : 'You can only punch in or out from the office network.'
}

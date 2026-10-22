import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'

// Machine auth for the daily health-report cloud routines (/api/ops/health/**).
// They run in Anthropic's cloud with no staff login, so they present a shared
// token instead -- in the x-ops-token header, never a query parameter, so it
// does not end up in access logs (unlike HEALTH_ALERT_TOKEN's ?token=).
//
// What this token can reach is deliberately small: read the health snapshot
// (stats and timings only, no business rows) and read/write health reports and
// findings. It never runs SQL that comes from a request.
export function hasOpsToken(req: NextRequest): boolean {
  const expected = process.env.OPS_REPORT_TOKEN?.trim()
  const given = req.headers.get('x-ops-token')?.trim()
  if (!expected || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  // timingSafeEqual throws on unequal lengths, and the length itself is not a
  // secret worth protecting.
  return a.length === b.length && timingSafeEqual(a, b)
}

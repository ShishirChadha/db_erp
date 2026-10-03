import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { getTrustedClientIp } from '@/lib/attendance-network'
import { getClientIp } from '@/lib/auth/device-sessions'

// Powers the "Use this device's IP" button in Settings > Attendance & Staff >
// Office networks -- the realistic way the owner adds the shop range, since
// nobody knows their own public IP offhand.
//
// Returns BOTH the trusted IP (the one enforcement actually compares against,
// null when this deployment has no proxy-set header to trust) and the
// best-effort observed IP. Surfacing the difference matters: saving an
// unverifiable address would produce a range that silently never matches, so
// the UI only offers the button when `verifiable` is true and explains the
// situation otherwise.
//
// Session-only: it reveals the caller's own IP and nothing else.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const trusted = getTrustedClientIp(req)
  return NextResponse.json({
    ip: trusted,
    observed_ip: getClientIp(req),
    verifiable: !!trusted,
  })
}

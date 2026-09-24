import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { SESSION_COOKIE_NAME, registerSession, isSessionRevoked } from '@/lib/auth/device-sessions'

// Backfill point for a browser session that predates this feature (device-limit +
// Settings > Active Devices) -- called once, quietly, from the dashboard shell on
// mount if no db_session_id cookie is present yet. Deliberately separate from
// /api/auth/log-event's 'login' event so this doesn't add a fake login row to the
// audit log for a session that was already open.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req, { skipSessionCheck: true })
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = req.cookies.get(SESSION_COOKIE_NAME)?.value
  if (existing && !(await isSessionRevoked(existing))) {
    return NextResponse.json({ success: true, already_registered: true })
  }

  const { sessionId, kickedCount } = await registerSession(sessionUser.id, sessionUser.role, req)
  const res = NextResponse.json({ success: true, kicked_other_device: kickedCount > 0 })
  res.cookies.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  return res
}

import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { SESSION_COOKIE_NAME, registerSession, revokeSession } from '@/lib/auth/device-sessions'

// No Supabase Auth Hooks are used in this project -- login/logout are plain
// client-side supabase-js calls (app/login/page.tsx, components/sidebar.tsx),
// so the client calls this endpoint right after each succeeds, while its token
// is still valid. Also doubles as the device-session register/revoke point
// (Settings > Active Devices) -- one call site instead of a second new route,
// since login/logout already reliably hit this endpoint.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const event = body.event

  if (event !== 'login' && event !== 'logout') {
    return NextResponse.json({ error: 'event must be "login" or "logout"' }, { status: 400 })
  }

  // skipSessionCheck: see lib/auth/session.ts -- this route is where a session's
  // own cookie gets (re)established, so it must not be gated by whatever stale
  // cookie the browser happens to already be holding.
  const sessionUser = await getSessionUser(req, { skipSessionCheck: true })
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: event,
    module: 'auth',
    metadata: { user_agent: req.headers.get('user-agent') },
  })

  if (event === 'login') {
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

  // logout
  const sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value
  if (sessionId) await revokeSession(sessionId, 'logout')
  return NextResponse.json({ success: true })
}

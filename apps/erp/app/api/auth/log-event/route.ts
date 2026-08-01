import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// No Supabase Auth Hooks are used in this project -- login/logout are plain
// client-side supabase-js calls (app/login/page.tsx, components/sidebar.tsx),
// so the client calls this endpoint right after each succeeds, while its token
// is still valid.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const event = body.event

  if (event !== 'login' && event !== 'logout') {
    return NextResponse.json({ error: 'event must be "login" or "logout"' }, { status: 400 })
  }

  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: event,
    module: 'auth',
    metadata: { user_agent: req.headers.get('user-agent') },
  })

  return NextResponse.json({ success: true })
}

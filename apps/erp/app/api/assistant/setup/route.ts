import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { isDbMaster } from '@/lib/assistant/settings'
import { logAuditEvent } from '@/lib/audit-log'
import { getDbAgentStatus, setUpDbAgent } from '@/lib/assistant/identity'

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser || !(await isDbMaster(sessionUser))) return NextResponse.json({ error: 'DB is private to her owner.' }, { status: 403 })
  return NextResponse.json(await getDbAgentStatus())
}

// Creates DB's account on first use, or gives her a new device session after
// she was logged off. A deactivated DB stays deactivated -- undo that in Users.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser || !(await isDbMaster(sessionUser))) return NextResponse.json({ error: 'DB is private to her owner.' }, { status: 403 })
  try {
    const status = await setUpDbAgent()
    await logAuditEvent({
      actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
      actionType: 'status_change', module: 'settings', tableName: 'profiles', recordLabel: 'DB assistant set up / woken',
    })
    return NextResponse.json(status)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

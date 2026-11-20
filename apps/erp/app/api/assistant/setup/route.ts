import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { getDbAgentStatus, setUpDbAgent } from '@/lib/assistant/identity'

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  return NextResponse.json(await getDbAgentStatus())
}

// Creates DB's account on first use, or gives her a new device session after
// she was logged off. A deactivated DB stays deactivated -- undo that in Users.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
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

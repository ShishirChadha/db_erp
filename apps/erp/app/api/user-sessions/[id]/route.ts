import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { revokeSession } from '@/lib/auth/device-sessions'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- DELETE: owner force-logs-off one device ----------
// Just marks the session row revoked -- the device's next request re-checks
// user_sessions via lib/auth/session.ts and is treated as signed out.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  await revokeSession(id, 'manual_owner')

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'settings',
    tableName: 'user_sessions',
    recordId: id,
    recordLabel: 'Force logout',
  })

  return NextResponse.json({ success: true })
}

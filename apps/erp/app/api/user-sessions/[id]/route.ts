import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { revokeSession } from '@/lib/auth/device-sessions'
import { logAuditEvent } from '@/lib/audit-log'
import { supabaseAdmin } from '@/lib/supabase/service'
import { accountProtection, dbMasterIds, PROTECTED_MESSAGE } from '@/lib/assistant/permissions'

// ---------- DELETE: owner force-logs-off one device ----------
// Just marks the session row revoked -- the device's next request re-checks
// user_sessions via lib/auth/session.ts and is treated as signed out.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  // DB's master's devices, and DB's own server session (her off switch), can
  // only be logged off by the master (lib/assistant/permissions.ts).
  const { data: session } = await supabaseAdmin.from('user_sessions').select('profile_id').eq('id', id).maybeSingle()
  if (session) {
    const { data: owner } = await supabaseAdmin.from('profiles').select('username').eq('id', session.profile_id).maybeSingle()
    if (accountProtection({ id: session.profile_id, username: owner?.username ?? null }, sessionUser.id, await dbMasterIds()) === 'locked') {
      return NextResponse.json({ error: PROTECTED_MESSAGE.locked }, { status: 403 })
    }
  }
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

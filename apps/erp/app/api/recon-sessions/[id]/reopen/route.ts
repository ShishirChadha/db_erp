import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- POST: reopen a closed session -- an audited action, per the plan's ----------
// ---------- "closing locks it; reopening is audited" rule ----------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { data: session } = await supabaseAdmin.from('recon_sessions').select('status').eq('id', id).single()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.status !== 'closed') return NextResponse.json({ error: 'This session is not closed.' }, { status: 409 })

  const { data: updated, error } = await supabaseAdmin
    .from('recon_sessions')
    .update({ status: 'in_progress', reopened_by: sessionUser.id, reopened_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'reconciliation', tableName: 'recon_sessions', recordId: id,
    recordLabel: `Reopened${body.reason ? `: ${body.reason}` : ''}`,
    reason: body.reason || null,
  })

  return NextResponse.json(updated)
}

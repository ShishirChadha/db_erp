import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { computeSessionSummary } from '@/lib/recon/session-summary'

// ---------- POST: close a session -- only when every transaction is matched or explained ----------
// The actual close condition (open_count === 0) is recomputed fresh here, never
// trusted from the session row's cached counts, so a transaction added/unmatched
// after the last summary call can't let a session close while genuinely still open.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data: session } = await supabaseAdmin.from('recon_sessions').select('*').eq('id', id).single()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.status === 'closed') return NextResponse.json({ error: 'Already closed.' }, { status: 409 })

  const summary = await computeSessionSummary(session.bank_account_id, session.period_start, session.period_end)
  if (summary.open_count > 0) {
    return NextResponse.json({ error: `${summary.open_count} transaction(s) are still open. Match or explain every row before closing.`, open_count: summary.open_count }, { status: 409 })
  }

  const { data: updated, error } = await supabaseAdmin
    .from('recon_sessions')
    .update({
      status: 'closed', closed_by: sessionUser.id, closed_at: new Date().toISOString(),
      open_count: 0, matched_count: summary.matched_count, total_count: summary.total_count, updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'reconciliation', tableName: 'recon_sessions', recordId: id,
    recordLabel: `Closed (${summary.matched_count} of ${summary.total_count} matched)`,
  })

  return NextResponse.json(updated)
}

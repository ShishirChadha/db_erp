import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- POST: no candidate matched this debit -- raise a task instead ----------
// The other half of "recon repeats until everything matches" (see docs/decisions.md):
// a genuine purchase that hasn't been papered yet (no PO raised, no stock received)
// shouldn't sit unmatched forever with no forcing function. Creates a real activities
// task via the existing POST /api/activities route (reused, not duplicated, so it
// gets the same notification/assignee plumbing as any other task) and marks the
// transaction 'explained' with a note pointing at it -- the same terminal state an
// owner reaches manually via /explain, just paired with a task instead of a bare
// note, so the session can still close without permanently losing track of the debit.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data: txn, error: txnErr } = await supabaseAdmin.from('bank_transactions').select('*').eq('id', id).single()
  if (txnErr || !txn) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const vendorId: string | null = body.vendor_id || null
  const amount = txn.debit || txn.credit || 0
  const dueDate = new Date(new Date(txn.txn_date).getTime() + 5 * 86400000).toISOString().slice(0, 10)

  const activityRes = await fetch(new URL('/api/activities', req.url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: req.headers.get('authorization') || '' },
    body: JSON.stringify({
      title: `Raise a PO for bank debit: ${txn.narration.slice(0, 60)}`,
      description: `A bank debit of ₹${amount.toFixed(2)} on ${txn.txn_date} (narration: "${txn.narration}") didn't match any existing PO or stock receipt during reconciliation. Raise a Purchase Order (and receive the stock, if not already done) for this, then come back and match this bank line against it.`,
      priority: 'normal',
      due_date: dueDate,
      related_type: vendorId ? 'vendor' : null,
      related_id: vendorId,
      tags: ['bank-recon'],
    }),
  })
  const activityJson = await activityRes.json()
  if (!activityRes.ok) return NextResponse.json({ error: activityJson.error || 'Failed to create task.' }, { status: activityRes.status })

  const { data: updatedTxn, error: updateErr } = await supabaseAdmin
    .from('bank_transactions')
    .update({ recon_status: 'explained', category: `PO task raised (activity ${activityJson.id})` })
    .eq('id', id)
    .select()
    .single()
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'reconciliation', tableName: 'bank_transactions', recordId: id,
    recordLabel: `Raised PO task (activity ${activityJson.id}) for unmatched debit ₹${amount.toFixed(2)}`,
  })

  return NextResponse.json({ activity_id: activityJson.id, transaction: updatedTxn })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- DELETE: unmatch -- every match must be reversible (owners mis-match) ----------
// Deletes the match row; trg_sync_bank_transaction_recon_status recomputes
// recon_status automatically. Does NOT delete an expense created alongside an
// 'expense' match (that expense is now a real ledger entry in its own right --
// unmatching just detaches it from this bank line, same posture as detaching any
// other linked record rather than destroying it). A transfer_pair unmatch removes
// only the counterpart-linked row on its own transaction; the caller unmatches the
// other leg separately if both sides need reopening.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; matchId: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id, matchId } = await params
  const { data: existing } = await supabaseAdmin.from('bank_transaction_matches').select('*').eq('id', matchId).eq('bank_transaction_id', id).single()
  if (!existing) return NextResponse.json({ error: 'Match not found' }, { status: 404 })

  const { error } = await supabaseAdmin.from('bank_transaction_matches').delete().eq('id', matchId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: updatedTxn } = await supabaseAdmin.from('bank_transactions').select('recon_status').eq('id', id).single()

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'hard_delete', module: 'reconciliation', tableName: 'bank_transaction_matches', recordId: matchId,
    recordLabel: `Unmatched (${existing.match_type}, ₹${existing.amount_applied})`,
    snapshot: { kind: 'row', table: 'bank_transaction_matches', row: existing },
    restoreStatus: 'not_applicable', // re-matching is a fresh POST, not a snapshot restore -- the linked
    // sale_payment/vendor_payment/expense row itself is untouched and still findable
  })

  return NextResponse.json({ recon_status: updatedTxn?.recon_status })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- POST: mark a transaction 'explained' or 'ignored' without a linked record ----------
// For rows that aren't a sale/vendor payment/expense/transfer at all (a bank fee
// already accounted for elsewhere, an interest credit, a reversal) -- an owner
// decision that this row needs no further matching, not a match. These are the only
// two states the match-insert/delete trigger deliberately never overrides (see
// sync_bank_transaction_recon_status), so this route is also how an owner reverses
// its own decision (pass status: 'open' to hand the row back to normal matching).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const { status, note } = body
  if (!['explained', 'ignored', 'open'].includes(status)) {
    return NextResponse.json({ error: "status must be 'explained', 'ignored', or 'open'." }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('bank_transactions')
    .update({ recon_status: status, category: note || null })
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'reconciliation', tableName: 'bank_transactions', recordId: id,
    recordLabel: `Set to ${status}${note ? `: ${note}` : ''}`,
  })

  return NextResponse.json(data)
}

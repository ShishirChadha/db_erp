import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { dedupeHash, checkContinuity, type BankTxnInput } from '@/lib/recon/bank-import'

// ---------- POST: ingest a parsed+mapped statement (rows already structured by the client) ----------
// The client owns CSV parsing and column mapping (papaparse + the saved column
// profile) -- this route receives already-normalized rows, computes the real dedup
// key server-side from each row's own values (never trusts a client-supplied hash),
// and runs the balance-continuity check.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const { bank_account_id, period_start, period_end, opening_balance, closing_balance, transactions, document_id } = body

  if (!bank_account_id) return NextResponse.json({ error: 'bank_account_id is required.' }, { status: 400 })
  if (!period_start || !period_end) return NextResponse.json({ error: 'period_start and period_end are required.' }, { status: 400 })
  if (!Array.isArray(transactions) || transactions.length === 0) return NextResponse.json({ error: 'At least one transaction row is required.' }, { status: 400 })

  for (const t of transactions as BankTxnInput[]) {
    if (!t.txn_date || !t.narration?.trim()) return NextResponse.json({ error: 'Every row needs a txn_date and narration.' }, { status: 400 })
  }

  const continuity = checkContinuity(transactions, opening_balance ?? null, closing_balance ?? null)

  const { data: statement, error: stmtErr } = await supabaseAdmin
    .from('bank_statements')
    .insert({
      bank_account_id, document_id: document_id || null, period_start, period_end,
      opening_balance: opening_balance ?? null, closing_balance: closing_balance ?? null,
      continuity_status: continuity.status, continuity_notes: Object.keys(continuity.notes).length ? continuity.notes : null,
      row_count: transactions.length, uploaded_by: sessionUser.id,
    })
    .select()
    .single()
  if (stmtErr) return NextResponse.json({ error: stmtErr.message }, { status: 500 })

  const rows = (transactions as BankTxnInput[]).map((t) => ({
    bank_account_id, bank_statement_id: statement.id,
    txn_date: t.txn_date, value_date: t.value_date || null, narration: t.narration.trim(),
    reference: t.reference || null, debit: t.debit ?? null, credit: t.credit ?? null,
    running_balance: t.running_balance ?? null, dedupe_hash: dedupeHash(t),
  }))

  // Insert only genuinely-new rows -- pre-check existing hashes for this account
  // rather than relying on an upsert-ignore, so the duplicate count is exact and no
  // partial-failure ambiguity from a bulk upsert needs to be reasoned about.
  const { data: existing } = await supabaseAdmin
    .from('bank_transactions')
    .select('dedupe_hash')
    .eq('bank_account_id', bank_account_id)
    .in('dedupe_hash', rows.map((r) => r.dedupe_hash))
  const existingHashes = new Set((existing || []).map((e) => e.dedupe_hash))
  const newRows = rows.filter((r) => !existingHashes.has(r.dedupe_hash))

  if (newRows.length > 0) {
    const { error: insertErr } = await supabaseAdmin.from('bank_transactions').insert(newRows)
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  const insertedCount = newRows.length
  const duplicateCount = rows.length - newRows.length

  await supabaseAdmin.from('bank_statements').update({ inserted_count: insertedCount, duplicate_count: duplicateCount }).eq('id', statement.id)

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create', module: 'reconciliation', tableName: 'bank_statements', recordId: statement.id,
    recordLabel: `${insertedCount} new, ${duplicateCount} duplicate rows, continuity: ${continuity.status}`,
  })

  return NextResponse.json({
    statement_id: statement.id,
    inserted_count: insertedCount,
    duplicate_count: duplicateCount,
    continuity_status: continuity.status,
    continuity_notes: continuity.notes,
  })
}

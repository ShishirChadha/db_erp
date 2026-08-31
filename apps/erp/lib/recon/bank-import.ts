import { createHash } from 'crypto'

// Bank statement ingestion helpers (Phase 6, see docs/decisions.md). Two rules,
// non-negotiable: dedup on re-upload (overlapping date ranges are normal -- an owner
// re-downloading "this month plus a few days of last month" must never double the
// ledger), and a balance-continuity check per statement (the only thing that catches
// a silently dropped row -- a naive sum-of-transactions check alone can net to the
// right total even with a row missing).

export interface BankTxnInput {
  txn_date: string
  value_date?: string | null
  narration: string
  reference?: string | null
  debit?: number | null
  credit?: number | null
  running_balance?: number | null
}

// Hash of the row's own values, computed server-side -- never trust a client-supplied
// dedup key. Deliberately excludes bank_account_id from the hash itself (that's
// enforced instead by the (bank_account_id, dedupe_hash) unique constraint), so the
// same hash logic can't accidentally treat two different accounts' identical-looking
// rows as needing separate treatment.
export function dedupeHash(txn: BankTxnInput): string {
  const parts = [
    txn.txn_date,
    (txn.debit ?? 0).toFixed(2),
    (txn.credit ?? 0).toFixed(2),
    txn.narration.trim().toLowerCase(),
    txn.running_balance != null ? txn.running_balance.toFixed(2) : '',
  ]
  return createHash('sha256').update(parts.join('|')).digest('hex')
}

export interface ContinuityResult {
  status: 'ok' | 'gap' | 'mismatch'
  notes: Record<string, any>
}

const TOLERANCE = 0.5

// Two independent checks, both must pass for 'ok':
// 1. opening + net(credits - debits) == closing (the direct spec of a statement).
// 2. Running-balance chain, where the export prints one -- catches a MID-statement
//    row dropped during parsing even when the opening/closing totals still net out
//    correctly by coincidence (rare, but exactly the failure mode a total-only check
//    would miss).
export function checkContinuity(txns: BankTxnInput[], openingBalance: number | null, closingBalance: number | null): ContinuityResult {
  const notes: Record<string, any> = {}
  let status: 'ok' | 'gap' | 'mismatch' = 'ok'

  if (openingBalance != null && closingBalance != null) {
    const net = txns.reduce((sum, t) => sum + (t.credit ?? 0) - (t.debit ?? 0), 0)
    const derivedClosing = openingBalance + net
    if (Math.abs(derivedClosing - closingBalance) > TOLERANCE) {
      status = 'mismatch'
      notes.balance_mismatch = { expected: derivedClosing, stated: closingBalance, delta: derivedClosing - closingBalance }
    }
  }

  let prevBalance: number | null = null
  const chainBreaks: any[] = []
  for (let i = 0; i < txns.length; i++) {
    const t = txns[i]
    if (t.running_balance == null) continue
    if (prevBalance != null) {
      const expected = prevBalance + (t.credit ?? 0) - (t.debit ?? 0)
      if (Math.abs(expected - t.running_balance) > TOLERANCE) {
        chainBreaks.push({ row: i, expected, stated: t.running_balance, narration: t.narration })
      }
    }
    prevBalance = t.running_balance
  }
  if (chainBreaks.length > 0) {
    status = 'gap'
    notes.chain_breaks = chainBreaks
  }

  return { status, notes }
}

'use client'

import { useEffect, useState, useCallback } from 'react'
import { Loader2, Check, X, ArrowLeftRight, Lock, LockOpen } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'
import RequireOwner from '@/components/RequireOwner'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/StatusBadge'
import { useCustomOptions } from '@/lib/useCustomOptions'
import { SearchableSelect } from '@/components/SearchableSelect'

interface BankAccount { id: string; label: string; entity_key: string }
interface CreditCandidate { sale_payment_id: string; sale_id: string; amount: number; customer_name: string | null; date_delta_days: number }
interface Txn {
  id: string; txn_date: string; narration: string; debit: number | null; credit: number | null
  recon_status: string; credit_candidates?: CreditCandidate[]
}
interface SessionRow { id: string; status: string; open_count: number; matched_count: number; total_count: number; period_start: string; period_end: string }

function monthBounds(monthStr: string): { start: string; end: string } {
  const [y, m] = monthStr.split('-').map(Number)
  const start = `${monthStr}-01`
  const end = new Date(y, m, 0).toISOString().slice(0, 10)
  return { start, end }
}

function SessionsPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [accountId, setAccountId] = useState('')
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [session, setSession] = useState<SessionRow | null>(null)
  const [summary, setSummary] = useState<any>(null)
  const [txns, setTxns] = useState<Txn[]>([])
  const [err, setErr] = useState('')
  const { values: expenseTypes } = useCustomOptions('expense_types')
  const [expenseForm, setExpenseForm] = useState<Record<string, { type: string; description: string }>>({})

  useEffect(() => { apiFetch('/api/bank-accounts').then((r) => r.ok && r.json()).then((d) => { if (d) { setAccounts(d); if (!accountId && d[0]) setAccountId(d[0].id) } }) }, [])

  const loadSessionAndTxns = useCallback(async () => {
    if (!accountId) return
    setErr('')
    const { start, end } = monthBounds(month)
    const res = await apiFetch('/api/recon-sessions', { method: 'POST', body: JSON.stringify({ bank_account_id: accountId, period_start: start, period_end: end }) })
    const sess = await res.json()
    if (!res.ok) { setErr(sess.error || 'Could not open session.'); return }
    setSession(sess)

    const sumRes = await apiFetch(`/api/recon-sessions/${sess.id}/summary`)
    if (sumRes.ok) setSummary(await sumRes.json())

    const txnRes = await apiFetch(`/api/bank-transactions?bank_account_id=${accountId}&with_candidates=true&page=1&limit=100`)
    if (txnRes.ok) {
      const { data } = await txnRes.json()
      setTxns((data || []).filter((t: Txn) => t.txn_date >= start && t.txn_date <= end))
    }
  }, [accountId, month])
  useEffect(() => { loadSessionAndTxns() }, [loadSessionAndTxns])

  const matchCredit = async (txnId: string, candidate: CreditCandidate) => {
    const res = await apiFetch(`/api/bank-transactions/${txnId}/match`, {
      method: 'POST', body: JSON.stringify({ match_type: 'sale_payment', sale_payment_id: candidate.sale_payment_id, amount_applied: candidate.amount }),
    })
    if (res.ok) await loadSessionAndTxns()
    else setErr((await res.json().catch(() => ({}))).error || 'Match failed.')
  }

  const createExpenseMatch = async (txn: Txn) => {
    const form = expenseForm[txn.id]
    if (!form?.type) { setErr('Pick an expense type first.'); return }
    const res = await apiFetch(`/api/bank-transactions/${txn.id}/match`, {
      method: 'POST',
      body: JSON.stringify({ match_type: 'expense', expense: { type: form.type, description: form.description || txn.narration }, amount_applied: txn.debit }),
    })
    if (res.ok) { await loadSessionAndTxns(); return }
    setErr((await res.json().catch(() => ({}))).error || 'Failed to create expense.')
  }

  const matchTransfer = async (txn: Txn) => {
    setErr('')
    const otherAccounts = accounts.filter((a) => a.id !== accountId)
    if (otherAccounts.length === 0) { setErr('No other bank account to transfer against.'); return }
    const labelList = otherAccounts.map((a, i) => `${i + 1}. ${a.label}`).join('\n')
    const choice = prompt(`Which account is the other leg of this transfer?\n${labelList}\n\nEnter a number:`)
    const idx = choice ? parseInt(choice, 10) - 1 : -1
    if (idx < 0 || idx >= otherAccounts.length) return
    const counterpartAccount = otherAccounts[idx]

    const amount = txn.debit || txn.credit || 0
    const res = await apiFetch(`/api/bank-transactions?bank_account_id=${counterpartAccount.id}&recon_status=open&page=1&limit=100`)
    const { data: candidateTxns } = await res.json()
    const nearby = (candidateTxns || []).filter((c: Txn) => {
      const cAmount = c.debit || c.credit || 0
      const dateDelta = Math.abs((new Date(c.txn_date).getTime() - new Date(txn.txn_date).getTime()) / 86400000)
      // The other leg is the opposite direction: our debit is their credit, and vice versa.
      const oppositeDirection = txn.debit ? !!c.credit : !!c.debit
      return oppositeDirection && Math.abs(cAmount - amount) < 0.5 && dateDelta <= 5
    })
    if (nearby.length === 0) { setErr(`No matching open transaction found in ${counterpartAccount.label} within 5 days and the same amount.`); return }

    let counterpart = nearby[0]
    if (nearby.length > 1) {
      const list = nearby.map((c: Txn, i: number) => `${i + 1}. ${c.txn_date} · ${c.narration} · ₹${(c.debit || c.credit)?.toFixed(2)}`).join('\n')
      const pick = prompt(`Multiple candidates found:\n${list}\n\nEnter a number:`)
      const pickIdx = pick ? parseInt(pick, 10) - 1 : -1
      if (pickIdx < 0 || pickIdx >= nearby.length) return
      counterpart = nearby[pickIdx]
    }

    if (!confirm(`Link this transaction to ${counterpart.txn_date} · ${counterpart.narration} in ${counterpartAccount.label}?`)) return
    const matchRes = await apiFetch(`/api/bank-transactions/${txn.id}/match`, {
      method: 'POST', body: JSON.stringify({ match_type: 'transfer_pair', counterpart_txn_id: counterpart.id, amount_applied: amount }),
    })
    if (matchRes.ok) await loadSessionAndTxns()
    else setErr((await matchRes.json().catch(() => ({}))).error || 'Transfer match failed.')
  }

  const explainTxn = async (txnId: string, status: 'explained' | 'ignored') => {
    const note = prompt(`Note for this ${status} transaction (optional):`) || undefined
    const res = await apiFetch(`/api/bank-transactions/${txnId}/explain`, { method: 'POST', body: JSON.stringify({ status, note }) })
    if (res.ok) await loadSessionAndTxns()
  }

  const { run: closeSession, pending: closing } = useAsyncAction(async () => {
    if (!session) return
    setErr('')
    const res = await apiFetch(`/api/recon-sessions/${session.id}/close`, { method: 'POST' })
    const json = await res.json()
    if (!res.ok) { setErr(json.error || 'Could not close.'); return }
    setSession(json)
  })

  const { run: reopenSession, pending: reopening } = useAsyncAction(async () => {
    if (!session) return
    const res = await apiFetch(`/api/recon-sessions/${session.id}/reopen`, { method: 'POST' })
    if (res.ok) setSession(await res.json())
  })

  const openTxns = txns.filter((t) => ['open', 'split'].includes(t.recon_status))

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reconciliation Sessions</h1>
        <p className="text-sm text-muted-foreground">Match every bank line for a period — a session closes only when nothing is left open.</p>
      </div>

      {err && <div className="text-destructive text-sm border border-destructive/20 bg-destructive/10 rounded p-3">{err}</div>}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-muted-foreground block">Account</label>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="border rounded px-2 py-1 text-sm">
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block">Month</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
        {session && (
          <div className="ml-auto flex items-center gap-3">
            <StatusBadge tone={session.status === 'closed' ? 'success' : 'warning'}>{session.status}</StatusBadge>
            {session.status === 'closed' ? (
              <Button size="sm" variant="outline" onClick={() => reopenSession()} disabled={reopening}>
                {reopening && <Loader2 className="size-4 animate-spin mr-1" />} <LockOpen className="size-4 mr-1" /> Reopen
              </Button>
            ) : (
              <Button size="sm" onClick={() => closeSession()} disabled={closing || openTxns.length > 0}>
                {closing && <Loader2 className="size-4 animate-spin mr-1" />} <Lock className="size-4 mr-1" /> Close Session
              </Button>
            )}
          </div>
        )}
      </div>

      {summary && (
        <div className="grid sm:grid-cols-4 gap-3">
          <div className="border rounded p-3"><div className="text-xs text-muted-foreground">Total transactions</div><div className="text-xl font-bold">{summary.total_count}</div></div>
          <div className="border rounded p-3"><div className="text-xs text-muted-foreground">Open</div><div className="text-xl font-bold text-warning">{summary.open_count}</div></div>
          <div className="border rounded p-3"><div className="text-xs text-muted-foreground">Total debits</div><div className="text-xl font-bold tabular-nums">₹{summary.total_debit?.toFixed(2)}</div></div>
          <div className="border rounded p-3"><div className="text-xs text-muted-foreground">Total credits</div><div className="text-xl font-bold tabular-nums">₹{summary.total_credit?.toFixed(2)}</div></div>
        </div>
      )}

      {summary?.recurring_expense_watch?.length > 0 && (
        <div className="border border-warning/20 bg-warning/15 rounded p-3 text-sm">
          <div className="font-medium mb-1">Recurring expenses expected but not seen this period:</div>
          <ul className="list-disc pl-5">
            {summary.recurring_expense_watch.map((w: any) => <li key={w.type}>{w.type} — last seen {w.last_seen_period}</li>)}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        {openTxns.map((t) => (
          <div key={t.id} className="border rounded p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="tabular-nums text-muted-foreground">{t.txn_date}</span> · {t.narration}
                <span className="ml-2 font-medium tabular-nums">{t.debit ? `Dr ₹${t.debit.toFixed(2)}` : `Cr ₹${t.credit?.toFixed(2)}`}</span>
              </div>
              <StatusBadge tone="warning">{t.recon_status}</StatusBadge>
            </div>

            {t.credit && t.credit_candidates && t.credit_candidates.length > 0 && (
              <div className="space-y-1">
                {t.credit_candidates.slice(0, 3).map((c) => (
                  <div key={c.sale_payment_id} className="flex items-center justify-between text-sm p-1.5 rounded hover:bg-muted">
                    <span>₹{c.amount.toFixed(2)} · {c.customer_name || 'unknown customer'} · {Math.round(c.date_delta_days)}d away</span>
                    <Button size="sm" variant="outline" onClick={() => matchCredit(t.id, c)}><Check className="size-4 mr-1" /> Match</Button>
                  </div>
                ))}
              </div>
            )}

            {t.debit && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <SearchableSelect
                  options={expenseTypes}
                  value={expenseForm[t.id]?.type || ''}
                  onChange={(val) => setExpenseForm((prev) => ({ ...prev, [t.id]: { ...prev[t.id], type: val, description: prev[t.id]?.description || '' } }))}
                  placeholder="Expense type..."
                />
                <Button size="sm" variant="outline" onClick={() => createExpenseMatch(t)}>Create Expense</Button>
              </div>
            )}

            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => explainTxn(t.id, 'explained')}>Explain</Button>
              <Button size="sm" variant="ghost" onClick={() => explainTxn(t.id, 'ignored')}><X className="size-4 mr-1" /> Ignore</Button>
              <Button size="sm" variant="ghost" onClick={() => matchTransfer(t)}><ArrowLeftRight className="size-4 mr-1" /> Transfer</Button>
            </div>
          </div>
        ))}
        {openTxns.length === 0 && txns.length > 0 && <div className="text-sm text-muted-foreground border rounded p-4 text-center">Everything in this period is matched or explained.</div>}
        {txns.length === 0 && <div className="text-sm text-muted-foreground border rounded p-4 text-center">No transactions in this period. Import a statement on the Bank Reconciliation page first.</div>}
      </div>
    </div>
  )
}

export default function SessionsPageGuarded() {
  return (
    <RequireOwner>
      <SessionsPage />
    </RequireOwner>
  )
}

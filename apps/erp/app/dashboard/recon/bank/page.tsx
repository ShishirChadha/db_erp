'use client'

import { useEffect, useState, useCallback } from 'react'
import Papa from 'papaparse'
import { Loader2, Upload, Plus } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'
import RequireOwner from '@/components/RequireOwner'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/StatusBadge'

const ENTITIES = [
  { key: 'digitalbluez', label: 'Digitalbluez' },
  { key: 'techtenth', label: 'Techtenth' },
  { key: 'cash', label: 'Cash' },
]
const TARGET_FIELDS = [
  { key: 'txn_date', label: 'Date', required: true },
  { key: 'narration', label: 'Narration / Description', required: true },
  { key: 'reference', label: 'Reference / Cheque No.', required: false },
  { key: 'debit', label: 'Debit (or leave blank if single Amount column)', required: false },
  { key: 'credit', label: 'Credit (or leave blank if single Amount column)', required: false },
  { key: 'amount', label: 'Amount (signed, if bank uses one column)', required: false },
  { key: 'running_balance', label: 'Running Balance', required: false },
]

interface BankAccount { id: string; entity_key: string; label: string; bank_name: string | null; account_number_last4: string | null }
interface Txn { id: string; txn_date: string; narration: string; reference: string | null; debit: number | null; credit: number | null; running_balance: number | null; recon_status: string }

function BankReconPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null)
  const [txns, setTxns] = useState<Txn[]>([])
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [newAccount, setNewAccount] = useState({ entity_key: 'digitalbluez', label: '', bank_name: '', account_number_last4: '' })
  const [err, setErr] = useState('')

  // Upload/mapping state
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [dateFormat, setDateFormat] = useState('DD/MM/YYYY')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [openingBalance, setOpeningBalance] = useState<number | ''>('')
  const [closingBalance, setClosingBalance] = useState<number | ''>('')
  const [saveMapping, setSaveMapping] = useState(true)

  const loadAccounts = useCallback(async () => {
    const res = await apiFetch('/api/bank-accounts')
    if (res.ok) {
      const data = await res.json()
      setAccounts(data)
      if (!activeAccountId && data.length > 0) setActiveAccountId(data[0].id)
    }
  }, [activeAccountId])
  useEffect(() => { loadAccounts() }, [loadAccounts])

  const loadTxns = useCallback(async (accountId: string) => {
    const res = await apiFetch(`/api/bank-transactions?bank_account_id=${accountId}&page=1&limit=50`)
    if (res.ok) setTxns((await res.json()).data)
  }, [])
  useEffect(() => { if (activeAccountId) loadTxns(activeAccountId) }, [activeAccountId, loadTxns])

  const { run: addAccount, pending: addingAccount } = useAsyncAction(async () => {
    setErr('')
    if (!newAccount.label.trim()) { setErr('Give this account a label (e.g. "ICICI Current").'); return }
    const res = await apiFetch('/api/bank-accounts', { method: 'POST', body: JSON.stringify(newAccount) })
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error || 'Failed to add account.'); return }
    setShowAddAccount(false)
    setNewAccount({ entity_key: 'digitalbluez', label: '', bank_name: '', account_number_last4: '' })
    await loadAccounts()
  })

  const parseFile = (file: File) => {
    setErr('')
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const headers = results.meta.fields || []
        setCsvHeaders(headers)
        setCsvRows(results.data)
        // Try the saved profile for this account first.
        if (activeAccountId) {
          const profRes = await apiFetch(`/api/bank-accounts/${activeAccountId}/column-profile`)
          if (profRes.ok) {
            const prof = await profRes.json()
            if (prof && prof.column_map) {
              const validMap: Record<string, string> = {}
              for (const [field, header] of Object.entries(prof.column_map as Record<string, string>)) {
                if (headers.includes(header)) validMap[field] = header
              }
              setMapping(validMap)
              setDateFormat(prof.date_format)
              setSaveMapping(false)
              return
            }
          }
        }
        setMapping({})
      },
    })
  }

  const parseAmount = (v: string | undefined) => {
    if (!v) return null
    const n = parseFloat(v.replace(/[,₹\s]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  const parseDate = (v: string | undefined): string | null => {
    if (!v) return null
    if (dateFormat === 'DD/MM/YYYY') {
      const m = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
      if (m) { const yr = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${yr}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` }
    }
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }

  const mappedRows = csvRows.map((r) => ({
    txn_date: parseDate(r[mapping.txn_date]),
    narration: r[mapping.narration] || '',
    reference: mapping.reference ? r[mapping.reference] || null : null,
    debit: mapping.amount ? (parseAmount(r[mapping.amount]) || 0) < 0 ? Math.abs(parseAmount(r[mapping.amount])!) : null : (mapping.debit ? parseAmount(r[mapping.debit]) : null),
    credit: mapping.amount ? (parseAmount(r[mapping.amount]) || 0) > 0 ? parseAmount(r[mapping.amount]) : null : (mapping.credit ? parseAmount(r[mapping.credit]) : null),
    running_balance: mapping.running_balance ? parseAmount(r[mapping.running_balance]) : null,
  })).filter((r) => r.txn_date && r.narration)

  const mappingComplete = mapping.txn_date && mapping.narration && (mapping.amount || mapping.debit || mapping.credit)

  const { run: importStatement, pending: importing } = useAsyncAction(async () => {
    if (!activeAccountId) return
    setErr('')
    if (!periodStart || !periodEnd) { setErr('Set the statement period start/end.'); return }
    const res = await apiFetch('/api/bank-statements', {
      method: 'POST',
      body: JSON.stringify({
        bank_account_id: activeAccountId, period_start: periodStart, period_end: periodEnd,
        opening_balance: openingBalance === '' ? null : openingBalance,
        closing_balance: closingBalance === '' ? null : closingBalance,
        transactions: mappedRows,
      }),
    })
    const json = await res.json()
    if (!res.ok) { setErr(json.error || 'Import failed.'); return }

    if (saveMapping) {
      await apiFetch(`/api/bank-accounts/${activeAccountId}/column-profile`, {
        method: 'POST',
        body: JSON.stringify({ column_map: mapping, date_format: dateFormat, amount_style: mapping.amount ? 'signed' : 'split_dr_cr', header_fingerprint: csvHeaders.join(',') }),
      })
    }

    let msg = `Imported ${json.inserted_count} new rows (${json.duplicate_count} already present).`
    if (json.continuity_status !== 'ok') msg += `\n\nContinuity check: ${json.continuity_status}. ${JSON.stringify(json.continuity_notes)}`
    alert(msg)
    setCsvHeaders([]); setCsvRows([]); setMapping({})
    await loadTxns(activeAccountId)
  })

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Bank Reconciliation</h1>
        <p className="text-sm text-muted-foreground">Import a bank statement CSV. Map columns once per account — every later statement from that account reuses the mapping.</p>
      </div>

      {err && <div className="text-destructive text-sm border border-destructive/20 bg-destructive/10 rounded p-3 whitespace-pre-wrap">{err}</div>}

      <div className="grid md:grid-cols-[16rem_1fr] gap-4">
        <div className="space-y-2">
          <div className="border rounded divide-y">
            {accounts.map((a) => (
              <button key={a.id} onClick={() => setActiveAccountId(a.id)} className={`w-full text-left p-3 text-sm hover:bg-muted ${activeAccountId === a.id ? 'bg-muted' : ''}`}>
                <div className="font-medium">{a.label}</div>
                <div className="text-xs text-muted-foreground">{a.entity_key} {a.account_number_last4 ? `· ...${a.account_number_last4}` : ''}</div>
              </button>
            ))}
            {accounts.length === 0 && <div className="p-3 text-sm text-muted-foreground">No accounts yet.</div>}
          </div>
          <Button size="sm" variant="outline" className="w-full" onClick={() => setShowAddAccount((v) => !v)}>
            <Plus className="size-4 mr-1" /> Add account
          </Button>
          {showAddAccount && (
            <div className="border rounded p-3 space-y-2 text-sm">
              <select value={newAccount.entity_key} onChange={(e) => setNewAccount({ ...newAccount, entity_key: e.target.value })} className="border rounded px-2 py-1 w-full">
                {ENTITIES.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
              </select>
              <input placeholder="Label (e.g. ICICI Current)" value={newAccount.label} onChange={(e) => setNewAccount({ ...newAccount, label: e.target.value })} className="border rounded px-2 py-1 w-full" />
              <input placeholder="Bank name" value={newAccount.bank_name} onChange={(e) => setNewAccount({ ...newAccount, bank_name: e.target.value })} className="border rounded px-2 py-1 w-full" />
              <input placeholder="Last 4 digits" value={newAccount.account_number_last4} onChange={(e) => setNewAccount({ ...newAccount, account_number_last4: e.target.value })} className="border rounded px-2 py-1 w-full" />
              <Button size="sm" onClick={() => addAccount()} disabled={addingAccount} className="w-full">
                {addingAccount && <Loader2 className="size-4 animate-spin mr-1" />} Save
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {activeAccountId && (
            <div className="border rounded p-4 space-y-3">
              <h2 className="font-medium">Import statement (CSV)</h2>
              <input type="file" accept=".csv" onChange={(e) => e.target.files?.[0] && parseFile(e.target.files[0])} className="text-sm" />

              {csvHeaders.length > 0 && (
                <div className="space-y-3 border-t pt-3">
                  <div className="grid sm:grid-cols-2 gap-2">
                    {TARGET_FIELDS.map((f) => (
                      <div key={f.key}>
                        <label className="text-xs text-muted-foreground block">{f.label}{f.required ? ' *' : ''}</label>
                        <select value={mapping[f.key] || ''} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })} className="border rounded px-2 py-1 text-sm w-full">
                          <option value="">—</option>
                          {csvHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-muted-foreground">Date format</label>
                    <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value)} className="border rounded px-2 py-1 text-sm">
                      <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                      <option value="ISO">YYYY-MM-DD (ISO)</option>
                    </select>
                  </div>

                  <div className="grid sm:grid-cols-4 gap-2">
                    <div><label className="text-xs text-muted-foreground block">Period start</label><input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="border rounded px-2 py-1 text-sm w-full" /></div>
                    <div><label className="text-xs text-muted-foreground block">Period end</label><input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="border rounded px-2 py-1 text-sm w-full" /></div>
                    <div><label className="text-xs text-muted-foreground block">Opening balance</label><input type="number" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value === '' ? '' : Number(e.target.value))} className="border rounded px-2 py-1 text-sm w-full" /></div>
                    <div><label className="text-xs text-muted-foreground block">Closing balance</label><input type="number" value={closingBalance} onChange={(e) => setClosingBalance(e.target.value === '' ? '' : Number(e.target.value))} className="border rounded px-2 py-1 text-sm w-full" /></div>
                  </div>

                  {mappingComplete && (
                    <div className="text-xs text-muted-foreground">
                      Preview: {mappedRows.length} of {csvRows.length} rows parsed successfully.
                      <div className="border rounded mt-1 max-h-40 overflow-y-auto">
                        {mappedRows.slice(0, 5).map((r, i) => (
                          <div key={i} className="p-1.5 border-b last:border-0">{r.txn_date} · {r.narration} · Dr ₹{r.debit ?? '—'} · Cr ₹{r.credit ?? '—'}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={saveMapping} onChange={(e) => setSaveMapping(e.target.checked)} />
                    Save this mapping for future statements from this account
                  </label>

                  <Button onClick={() => importStatement()} disabled={importing || !mappingComplete || mappedRows.length === 0}>
                    {importing && <Loader2 className="size-4 animate-spin mr-1" />}
                    <Upload className="size-4 mr-1" /> Import {mappedRows.length} rows
                  </Button>
                </div>
              )}
            </div>
          )}

          {activeAccountId && (
            <div className="border rounded overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted text-xs text-muted-foreground">
                  <tr><th className="text-left p-2">Date</th><th className="text-left p-2">Narration</th><th className="text-right p-2">Debit</th><th className="text-right p-2">Credit</th><th className="text-left p-2">Status</th></tr>
                </thead>
                <tbody className="divide-y">
                  {txns.map((t) => (
                    <tr key={t.id}>
                      <td className="p-2 tabular-nums">{t.txn_date}</td>
                      <td className="p-2 truncate max-w-xs">{t.narration}</td>
                      <td className="p-2 text-right tabular-nums">{t.debit ? `₹${t.debit.toFixed(2)}` : ''}</td>
                      <td className="p-2 text-right tabular-nums">{t.credit ? `₹${t.credit.toFixed(2)}` : ''}</td>
                      <td className="p-2"><StatusBadge tone={t.recon_status === 'matched' ? 'success' : t.recon_status === 'open' ? 'warning' : 'neutral'}>{t.recon_status}</StatusBadge></td>
                    </tr>
                  ))}
                  {txns.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No transactions imported yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function BankReconPageGuarded() {
  return (
    <RequireOwner>
      <BankReconPage />
    </RequireOwner>
  )
}

'use client'

import { useEffect, useState, useCallback } from 'react'
import Papa from 'papaparse'
import { Loader2, Upload, Plus, Sparkles, RefreshCw, Check, Trash2 } from 'lucide-react'
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

interface BankExtractionTxn { txn_date: string; value_date?: string | null; narration: string; reference?: string | null; debit?: number | null; credit?: number | null; running_balance?: number | null }
interface BankExtraction { account_number_last4: string | null; period_start: string; period_end: string; opening_balance: number | null; closing_balance: number | null; transactions: BankExtractionTxn[] }
interface PdfDoc {
  id: string
  file_name: string
  extraction_tier: string | null
  extraction_status: string
  page_count: number | null
  text_layer_chars: number | null
  validation_errors: any
  raw_extraction: BankExtraction | null
  created_at: string
}

// Mirrors the vendor-recon page's status tones -- same `uploaded_documents.extraction_status`
// enum drives both pipelines.
const DOC_STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  probed: 'info',
  parsed: 'success',
  needs_review: 'warning',
  ai_pending_approval: 'warning',
  failed: 'danger',
  confirmed: 'success',
}

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
  const [importMode, setImportMode] = useState<'csv' | 'pdf'>('csv')

  // PDF upload/extraction state (Tier 0 probe -> Tier 1 template -> Tier 2 AI,
  // same pipeline the vendor-invoice recon page already uses).
  const [pdfDocs, setPdfDocs] = useState<PdfDoc[]>([])
  const [activePdfDoc, setActivePdfDoc] = useState<PdfDoc | null>(null)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pdfPeriodStart, setPdfPeriodStart] = useState('')
  const [pdfPeriodEnd, setPdfPeriodEnd] = useState('')
  const [pdfOpeningBalance, setPdfOpeningBalance] = useState<number | ''>('')
  const [pdfClosingBalance, setPdfClosingBalance] = useState<number | ''>('')
  const [pdfTargetAccountId, setPdfTargetAccountId] = useState<string | null>(null)

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
  useEffect(() => { if (activeAccountId && !pdfTargetAccountId) setPdfTargetAccountId(activeAccountId) }, [activeAccountId, pdfTargetAccountId])

  const loadPdfDocs = useCallback(async () => {
    const res = await apiFetch('/api/documents?doc_kind=bank_statement')
    if (res.ok) setPdfDocs(await res.json())
  }, [])
  useEffect(() => { loadPdfDocs() }, [loadPdfDocs])

  const { run: addAccount, pending: addingAccount } = useAsyncAction(async () => {
    setErr('')
    if (!newAccount.label.trim()) { setErr('Give this account a label (e.g. "ICICI Current").'); return }
    const res = await apiFetch('/api/bank-accounts', { method: 'POST', body: JSON.stringify(newAccount) })
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error || 'Failed to add account.'); return }
    setShowAddAccount(false)
    setNewAccount({ entity_key: 'digitalbluez', label: '', bank_name: '', account_number_last4: '' })
    await loadAccounts()
  })

  // Real bank CSV exports (ICICI's "Detailed Statement" included) carry a metadata
  // preamble -- account name/address/A/C no/period -- before the actual transaction
  // table starts, so naively treating row 1 as the header row (as this used to)
  // misreads that preamble as headers instead, producing Papaparse's auto-generated
  // "_1"/"_2"/"_3" placeholder names for the mostly-empty first row and losing every
  // real transaction. Scan for the row that actually looks like a transaction-table
  // header (several non-empty cells, at least two recognizable column-name words)
  // instead of assuming it's row 1.
  const HEADER_HINTS = ['date', 'narration', 'description', 'particular', 'debit', 'credit', 'withdrawal', 'deposit', 'balance', 'amount', 'reference', 'cheque', 'remarks']
  const findHeaderRowIndex = (rows: string[][]): number => {
    for (let i = 0; i < Math.min(rows.length, 60); i++) {
      const cells = (rows[i] || []).map((c) => (c || '').trim().toLowerCase())
      const nonEmpty = cells.filter((c) => c !== '')
      if (nonEmpty.length < 4) continue
      const hintMatches = cells.filter((c) => HEADER_HINTS.some((h) => c.includes(h))).length
      if (hintMatches >= 2) return i
    }
    return 0 // nothing matched -- fall back to the old assumption so a plain, already-clean CSV still works
  }

  const parseFile = (file: File) => {
    setErr('')
    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: true,
      complete: async (raw) => {
        const rows = raw.data
        const headerIdx = findHeaderRowIndex(rows)
        const rawHeaders = (rows[headerIdx] || []).map((h) => (h || '').trim())
        // Dedupe/backfill blank column names the same way Papaparse's own header:true
        // mode does, so downstream mapping keys are always unique and non-empty.
        const seen: Record<string, number> = {}
        const headers = rawHeaders.map((h, i) => {
          const base = h || `_${i + 1}`
          seen[base] = (seen[base] || 0) + 1
          return seen[base] > 1 ? `${base}_${seen[base]}` : base
        })

        const dataRows: Record<string, string>[] = []
        for (let i = headerIdx + 1; i < rows.length; i++) {
          const r = rows[i]
          if (!r || r.every((c) => !c || !c.trim())) continue
          const obj: Record<string, string> = {}
          headers.forEach((h, idx) => { obj[h] = r[idx] ?? '' })
          dataRows.push(obj)
        }

        // Bonus: this same preamble/footer format usually prints "Opening Bal:" /
        // "Closing Bal:" rows -- auto-fill them so the owner doesn't have to retype
        // numbers that are already right there in the file.
        for (const r of rows) {
          const label = (r[0] || '').trim().toLowerCase()
          const value = parseAmount(r[1])
          if (value == null) continue
          if (label.startsWith('opening bal')) setOpeningBalance(value)
          if (label.startsWith('closing bal')) setClosingBalance(value)
        }

        setCsvHeaders(headers)
        setCsvRows(dataRows)
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

  const openPdfDoc = useCallback((doc: PdfDoc) => {
    setErr('')
    setActivePdfDoc(doc)
    const ext = doc.raw_extraction
    setPdfPeriodStart(ext?.period_start || '')
    setPdfPeriodEnd(ext?.period_end || '')
    setPdfOpeningBalance(ext?.opening_balance ?? '')
    setPdfClosingBalance(ext?.closing_balance ?? '')
    if (activeAccountId) setPdfTargetAccountId(activeAccountId)
  }, [activeAccountId])

  const { run: uploadPdf, pending: uploadingPdf } = useAsyncAction(async () => {
    setErr('')
    if (!pdfFile) { setErr('Choose a PDF statement to upload.'); return }

    const upRes = await apiFetch('/api/storage/upload-url', {
      method: 'POST',
      body: JSON.stringify({ fileName: pdfFile.name, contentType: pdfFile.type, folder: 'bank-statements', fileType: 'statement', bucket: 'documents' }),
    })
    if (!upRes.ok) { setErr('Could not get an upload URL.'); return }
    const { uploadUrl, key } = await upRes.json()
    const putRes = await fetch(uploadUrl, { method: 'PUT', body: pdfFile, headers: { 'Content-Type': pdfFile.type } })
    if (!putRes.ok) { setErr('File upload failed.'); return }

    const regRes = await apiFetch('/api/documents', {
      method: 'POST',
      body: JSON.stringify({ key, file_name: pdfFile.name, mime_type: pdfFile.type, doc_kind: 'bank_statement' }),
    })
    const regJson = await regRes.json()
    if (!regRes.ok) { setErr(regJson.error || 'Failed to register document.'); return }
    if (regJson.duplicate) {
      setErr(`This exact file was already uploaded (${regJson.document.file_name}, status: ${regJson.document.extraction_status}).`)
      await loadPdfDocs()
      return
    }

    setPdfFile(null)
    await loadPdfDocs()

    // Tier 1 -- free, always attempted before ever surfacing the AI option.
    await apiFetch(`/api/documents/${regJson.document.id}/parse`, { method: 'POST' })
    const refreshed: PdfDoc[] = await apiFetch('/api/documents?doc_kind=bank_statement').then((r) => r.json())
    const updatedDoc = refreshed.find((d) => d.id === regJson.document.id) || regJson.document
    setPdfDocs(refreshed)
    openPdfDoc(updatedDoc)
  })

  const { run: readWithAi, pending: aiPending } = useAsyncAction(async () => {
    if (!activePdfDoc) return
    setErr('')
    const res = await apiFetch(`/api/documents/${activePdfDoc.id}/parse-ai`, { method: 'POST', body: JSON.stringify({ confirm: true }) })
    const json = await res.json()
    if (!res.ok) { setErr(json.error || 'AI extraction failed.'); return }
    await loadPdfDocs()
    openPdfDoc(json.document)
  })

  const { run: confirmPdfReview, pending: confirmingPdf } = useAsyncAction(async () => {
    if (!activePdfDoc) return
    setErr('')
    const res = await apiFetch(`/api/documents/${activePdfDoc.id}`, { method: 'PATCH', body: JSON.stringify({ confirm_review: true }) })
    const json = await res.json()
    if (!res.ok) { setErr(json.error || 'Could not confirm this extraction.'); return }
    await loadPdfDocs()
    openPdfDoc(json.document)
  })

  const { run: deletePdfDoc, pending: deletingPdf } = useAsyncAction(async (doc: PdfDoc) => {
    if (!confirm(`Delete "${doc.file_name}"? This cannot be undone.`)) return
    setErr('')
    const res = await apiFetch(`/api/documents/${doc.id}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setErr(json.error || 'Could not delete this document.'); return }
    if (activePdfDoc?.id === doc.id) setActivePdfDoc(null)
    await loadPdfDocs()
  })

  const pdfExtraction = activePdfDoc?.raw_extraction
  const pdfMappedRows = (pdfExtraction?.transactions || [])
    .map((t) => ({
      txn_date: t.txn_date || null,
      value_date: t.value_date || null,
      narration: (t.narration || '').trim(),
      reference: t.reference || null,
      debit: t.debit ?? null,
      credit: t.credit ?? null,
      running_balance: t.running_balance ?? null,
    }))
    .filter((r) => r.txn_date && r.narration)

  const { run: importPdfStatement, pending: importingPdf } = useAsyncAction(async () => {
    if (!activePdfDoc || !pdfTargetAccountId) return
    setErr('')
    if (!pdfPeriodStart || !pdfPeriodEnd) { setErr('Set the statement period start/end.'); return }
    const res = await apiFetch('/api/bank-statements', {
      method: 'POST',
      body: JSON.stringify({
        bank_account_id: pdfTargetAccountId, period_start: pdfPeriodStart, period_end: pdfPeriodEnd,
        opening_balance: pdfOpeningBalance === '' ? null : pdfOpeningBalance,
        closing_balance: pdfClosingBalance === '' ? null : pdfClosingBalance,
        transactions: pdfMappedRows,
        document_id: activePdfDoc.id,
      }),
    })
    const json = await res.json()
    if (!res.ok) { setErr(json.error || 'Import failed.'); return }

    let msg = `Imported ${json.inserted_count} new rows (${json.duplicate_count} already present).`
    if (json.continuity_status !== 'ok') msg += `\n\nContinuity check: ${json.continuity_status}. ${JSON.stringify(json.continuity_notes)}`
    alert(msg)
    setActivePdfDoc(null)
    await loadPdfDocs()
    await loadTxns(pdfTargetAccountId)
  })

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Bank Reconciliation</h1>
        <p className="text-sm text-muted-foreground">Import a bank statement as a CSV export or a PDF — a PDF is read via a text-layer template first (free), with AI-assisted extraction as a fallback for layouts that aren't recognized yet.</p>
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
            <div className="flex gap-1 text-sm">
              <button onClick={() => setImportMode('csv')} className={`px-3 py-1.5 rounded-t border-b-2 ${importMode === 'csv' ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`}>CSV</button>
              <button onClick={() => setImportMode('pdf')} className={`px-3 py-1.5 rounded-t border-b-2 ${importMode === 'pdf' ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`}>PDF</button>
            </div>
          )}

          {activeAccountId && importMode === 'csv' && (
            <div className="border rounded p-4 space-y-3">
              <h2 className="font-medium">Import statement (CSV)</h2>
              <p className="text-xs text-muted-foreground">Map columns once per account — every later statement from that account reuses the mapping.</p>
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

          {activeAccountId && importMode === 'pdf' && (
            <div className="border rounded p-4 space-y-3">
              <h2 className="font-medium">Import statement (PDF)</h2>
              <p className="text-xs text-muted-foreground">Upload the bank's PDF export. A text-layer PDF (not a scan) parses deterministically; otherwise AI-assisted extraction is offered as an explicit, confirm-gated step.</p>
              <div className="flex items-center gap-3">
                <input type="file" accept="application/pdf" onChange={(e) => setPdfFile(e.target.files?.[0] || null)} className="text-sm" />
                <Button size="sm" onClick={() => uploadPdf()} disabled={uploadingPdf || !pdfFile}>
                  {uploadingPdf && <Loader2 className="size-4 animate-spin mr-1" />}
                  <Upload className="size-4 mr-1" /> Upload &amp; Parse
                </Button>
              </div>

              {pdfDocs.length > 0 && (
                <div className="border rounded divide-y max-h-40 overflow-y-auto">
                  {pdfDocs.map((d) => (
                    <div key={d.id} className={`group flex items-center justify-between px-2 py-1.5 text-sm ${activePdfDoc?.id === d.id ? 'bg-muted' : ''}`}>
                      <button onClick={() => openPdfDoc(d)} className="flex-1 text-left min-w-0">
                        <span className="truncate">{d.file_name}</span>
                        <span className="text-xs text-muted-foreground ml-2">{d.created_at?.slice(0, 10)}</span>
                      </button>
                      <StatusBadge tone={DOC_STATUS_TONE[d.extraction_status] || 'neutral'}>{d.extraction_status.replace(/_/g, ' ')}</StatusBadge>
                      <button onClick={() => deletePdfDoc(d)} disabled={deletingPdf} title="Delete" className="p-1.5 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {activePdfDoc && (
                <div className="border-t pt-3 space-y-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{activePdfDoc.page_count ?? '—'} page(s) · {activePdfDoc.text_layer_chars ?? 0} chars extracted · tier {activePdfDoc.extraction_tier || 'none yet'}</span>
                    <StatusBadge tone={DOC_STATUS_TONE[activePdfDoc.extraction_status] || 'neutral'}>{activePdfDoc.extraction_status.replace(/_/g, ' ')}</StatusBadge>
                  </div>

                  {activePdfDoc.extraction_status === 'ai_pending_approval' && (
                    <div className="border border-primary/20 bg-info/15 rounded p-3 text-sm flex items-center justify-between gap-3">
                      <span>No saved layout matched this statement.</span>
                      <Button size="sm" onClick={() => readWithAi()} disabled={aiPending}>
                        {aiPending && <Loader2 className="size-4 animate-spin mr-1" />}
                        <Sparkles className="size-4 mr-1" /> Read with AI
                      </Button>
                    </div>
                  )}

                  {activePdfDoc.extraction_status === 'failed' && (
                    <div className="border border-destructive/20 bg-destructive/10 rounded p-3 text-sm flex items-center justify-between gap-3">
                      <span>{activePdfDoc.validation_errors?.[0]?.message || 'The AI read of this statement failed.'}</span>
                      <Button size="sm" variant="outline" onClick={() => readWithAi()} disabled={aiPending}>
                        {aiPending && <Loader2 className="size-4 animate-spin mr-1" />}
                        <RefreshCw className="size-4 mr-1" /> Retry
                      </Button>
                    </div>
                  )}

                  {activePdfDoc.extraction_status === 'needs_review' && activePdfDoc.validation_errors && (
                    <div className="border border-warning/20 bg-warning/15 rounded p-3 text-sm space-y-2">
                      <div className="font-medium">This extraction's own balances don't add up — review before trusting it:</div>
                      <ul className="list-disc pl-5 space-y-0.5">
                        {activePdfDoc.validation_errors.map((issue: any, i: number) => (
                          <li key={i}>{issue.field}: expected ₹{issue.expected?.toFixed?.(2)}, extracted ₹{issue.extracted?.toFixed?.(2)}</li>
                        ))}
                      </ul>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => readWithAi()} disabled={aiPending}>
                          {aiPending && <Loader2 className="size-4 animate-spin mr-1" />}
                          <Sparkles className="size-4 mr-1" /> Read with AI instead
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => confirmPdfReview()} disabled={confirmingPdf}>
                          {confirmingPdf && <Loader2 className="size-4 animate-spin mr-1" />}
                          <Check className="size-4 mr-1" /> Reviewed — this is correct
                        </Button>
                      </div>
                    </div>
                  )}

                  {pdfExtraction && (
                    <div className="space-y-3">
                      <div className="grid sm:grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-muted-foreground block">Import into account</label>
                          <select value={pdfTargetAccountId || ''} onChange={(e) => setPdfTargetAccountId(e.target.value)} className="border rounded px-2 py-1 text-sm w-full">
                            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}{a.account_number_last4 ? ` (...${a.account_number_last4})` : ''}</option>)}
                          </select>
                        </div>
                        <div className="text-xs text-muted-foreground self-end pb-1">
                          Statement A/C: {pdfExtraction.account_number_last4 ? `...${pdfExtraction.account_number_last4}` : 'not printed'}
                        </div>
                      </div>

                      <div className="grid sm:grid-cols-4 gap-2">
                        <div><label className="text-xs text-muted-foreground block">Period start</label><input type="date" value={pdfPeriodStart} onChange={(e) => setPdfPeriodStart(e.target.value)} className="border rounded px-2 py-1 text-sm w-full" /></div>
                        <div><label className="text-xs text-muted-foreground block">Period end</label><input type="date" value={pdfPeriodEnd} onChange={(e) => setPdfPeriodEnd(e.target.value)} className="border rounded px-2 py-1 text-sm w-full" /></div>
                        <div><label className="text-xs text-muted-foreground block">Opening balance</label><input type="number" value={pdfOpeningBalance} onChange={(e) => setPdfOpeningBalance(e.target.value === '' ? '' : Number(e.target.value))} className="border rounded px-2 py-1 text-sm w-full" /></div>
                        <div><label className="text-xs text-muted-foreground block">Closing balance</label><input type="number" value={pdfClosingBalance} onChange={(e) => setPdfClosingBalance(e.target.value === '' ? '' : Number(e.target.value))} className="border rounded px-2 py-1 text-sm w-full" /></div>
                      </div>

                      <div className="text-xs text-muted-foreground">
                        Preview: {pdfMappedRows.length} of {pdfExtraction.transactions.length} rows read successfully.
                        <div className="border rounded mt-1 max-h-40 overflow-y-auto">
                          {pdfMappedRows.slice(0, 5).map((r, i) => (
                            <div key={i} className="p-1.5 border-b last:border-0">{r.txn_date} · {r.narration} · Dr ₹{r.debit ?? '—'} · Cr ₹{r.credit ?? '—'}</div>
                          ))}
                        </div>
                      </div>

                      <Button onClick={() => importPdfStatement()} disabled={importingPdf || !pdfTargetAccountId || pdfMappedRows.length === 0}>
                        {importingPdf && <Loader2 className="size-4 animate-spin mr-1" />}
                        <Upload className="size-4 mr-1" /> Import {pdfMappedRows.length} rows
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeAccountId && (
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">This list is read-only — matching/explaining transactions happens on Recon Sessions, one calendar month at a time.</div>
              <a href="/dashboard/recon/sessions"><Button size="sm" variant="outline">Go to Recon Sessions →</Button></a>
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

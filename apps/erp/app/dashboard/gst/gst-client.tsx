'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { setOff } from '@/lib/gst-setoff'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { apiFetch } from '@/lib/api-client'
import { formatCurrency, STATE_CODE_TO_NAME } from '@db/shared'
import { ErrorBanner } from '@/components/ErrorBanner'
import { RecordZohoInvoiceDialog } from '@/components/RecordZohoInvoiceDialog'
import { EditSaleDialog } from '@/components/EditSaleDialog'
import { GstNewsPanel } from './gst-news-panel'
import { EmptyTableRow } from '@/components/EmptyTableRow'
import {
  GST_SECTIONS, sectionCsv, gstCsvFilename, downloadCsv, type GstSectionKey,
  worksheetCsv, worksheetFilename,
  buildGstr1Json, gstr1JsonFilename, downloadJson,
} from '@/lib/gst-returns'

interface EntityOption {
  key: string
  legal_name: string
  gstin: string | null
  state_code: string | null
}

interface ExceptionRow {
  entity_key: string
  period_month: string | null
  check_code: string
  severity: 'blocker' | 'warning'
  check_group: 'transactions' | 'hsn_summary' | 'document_summary'
  record_type: string
  record_id: string | null
  record_label: string | null
  detail: string
  // Populated only for check_code === 'doc_series_gap' -- what
  // gst_acknowledge_series_gap needs. record_label can't be split back into
  // these (series_key and seq are both pure digit runs with nothing between
  // them once concatenated).
  series_key: string | null
  seq: number | null
}

// BUSY groups its pre-export checks exactly this way, and the grouping maps
// onto how the portal rejects an upload, so it is worth keeping.
const GROUPS: { key: ExceptionRow['check_group']; label: string }[] = [
  { key: 'transactions', label: 'Transactions' },
  { key: 'hsn_summary', label: 'HSN Summary' },
  { key: 'document_summary', label: 'Document Summary' },
]

function monthOptions(count = 18) {
  const out: { value: string; label: string; from: string; to: string }[] = []
  const now = new Date()
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const y = d.getFullYear()
    const m = d.getMonth()
    const pad = (n: number) => String(n).padStart(2, '0')
    const from = `${y}-${pad(m + 1)}-01`
    const to = `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`
    out.push({
      value: from,
      label: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
      from,
      to,
    })
  }
  return out
}

type StepStatus = 'green' | 'yellow' | 'red'
interface Step {
  step: number
  group: 'gstr1' | 'gstr3b'
  title: string
  status: StepStatus
  reason: string | null
  blockers: number
  warnings: number
  fingerprint: string
  signoff_applicable: boolean
  signed_off: boolean
  signed_off_at: string | null
  signed_off_note: string | null
  detail: any
}

const TONE: Record<StepStatus, { box: string; text: string; dot: string; label: string }> = {
  green: { box: 'border-success/40 bg-success/10', text: 'text-success', dot: 'bg-success', label: 'Done' },
  yellow: { box: 'border-warning/40 bg-warning/10', text: 'text-warning', dot: 'bg-warning', label: 'Pending' },
  red: { box: 'border-destructive/40 bg-destructive/10', text: 'text-destructive', dot: 'bg-destructive', label: 'Blocked' },
}

const STEP_SHORT: Record<number, string> = {
  1: 'Zoho match', 2: 'Sales', 3: 'Invoices', 4: 'HSN & numbering', 5: 'Tax heads',
  6: 'Approve', 7: 'File & lock', 8: 'Purchases / ITC', 9: 'Approve 3B', 10: 'File 3B',
}

// Which exception codes each step shows (mirrors the mapping inside gst_period_steps).
const STEP_CODES: Record<number, string[]> = {
  2: ['voided_sale_with_live_invoice'],
  3: ['zero_gst_on_gst_entity', 'tax_computation_mismatch', 'value_mismatch', 'wrong_tax_type', 'missing_place_of_supply',
    'eway_bill_missing', 'invalid_gstin_format', 'gstin_state_mismatch', 'gstin_has_whitespace', 'customer_missing_state',
    'b2b_missing_gstin', 'line_gst_rate_mismatch', 'invoice_customer_gstin_stale', 'invalid_gst_slab_rate'],
  4: ['missing_hsn', 'hsn_too_short', 'hsn_not_numeric', 'service_without_sac', 'invoice_line_hsn_unresolvable',
    'hsn_inconsistent_for_sku', 'doc_series_gap', 'invoice_number_too_long', 'invoice_number_bad_chars', 'duplicate_invoice_number'],
  8: ['rcm_credit_unclaimed'],
}

const STEP_WHY: Record<number, string> = {
  1: 'Upload your Zoho invoice register for the month (export Invoices as CSV from Zoho). The ERP checks that every invoice Zoho issued is here with the same value and date. A missing one would be silently under-reported — the portal never complains about an invoice it was never given.',
  2: 'Every sale this month that carries GST should have its Zoho invoice number recorded here. Under GST law (Sec 31) the tax invoice for goods is due when the goods are delivered, not when you are paid, so a delivered sale with no invoice is a compliance gap, not just a bookkeeping one.',
  3: 'Checks each invoice and customer: GSTIN valid, CGST+SGST versus IGST correct for the state, the tax matches a real GST rate, totals add up, e-way bill on goods over ₹50,000. Fix blockers at the source record (the Record column links to it). Warnings can be signed off once you have looked at them.',
  4: 'GSTR-1 Table 12 needs a valid HSN on every item, and Table 13 needs every invoice number accounted for as issued or cancelled. A gap in the numbering is fine only if you can say why — "Mark cancelled (Zoho)" records that and reports it as cancelled in Table 13.',
  5: 'Same register, deeper check: for each invoice the CGST, SGST and IGST must each agree with Zoho — not just the total. Tax paid under the wrong head cannot be set off against the other; it must be paid again and the first refunded separately. Place of supply is compared too when your export has it.',
  6: 'Final review before filing. The tables below are what you will enter on the GST portal. Approving freezes these exact figures; if any invoice changes afterwards you will be asked to approve again, so what you file is always what you reviewed.',
  7: 'File GSTR-1 on the GST portal using the approved figures, then record the ARN here. Locking Sales through month-end stops anyone back-dating a sale into a month you have already filed.',
  8: 'Upload the GSTR-2B JSON from the portal. Input tax credit may be claimed only for invoices that appear in it (Rule 36(4)). Decide each line: claim, ineligible, or chase the supplier. Credit you have already claimed that the supplier has not filed is the risky case (Rule 88D).',
  9: 'GSTR-3B Table 3.1 must equal your filed GSTR-1 — the portal fills it from there. Review the other tables, then approve to freeze them.',
  10: 'Pay the tax (cash and ITC) and file GSTR-3B on the portal, then record the ARN here and lock Purchases through month-end.',
}

function dueLabel(periodFrom: string, day: number) {
  const [y, m] = periodFrom.split('-').map(Number)
  return new Date(y, m, day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function StepTiles({ steps, current, onSelect, periodFrom }: {
  steps: Step[]; current: number; onSelect: (n: number) => void; periodFrom: string
}) {
  const groups: { key: 'gstr1' | 'gstr3b'; label: string }[] = [
    { key: 'gstr1', label: `GSTR-1 · due ${dueLabel(periodFrom, 11)}` },
    { key: 'gstr3b', label: `GSTR-3B · due ${dueLabel(periodFrom, 20)}` },
  ]
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.key}>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">{g.label}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {steps.filter((s) => s.group === g.key).map((s) => {
              const tone = TONE[s.status]
              return (
                <button
                  key={s.step}
                  type="button"
                  onClick={() => onSelect(s.step)}
                  aria-pressed={current === s.step}
                  className={`text-left rounded-lg border p-2.5 transition-shadow cursor-pointer ${tone.box} ${current === s.step ? 'ring-2 ring-ring' : 'hover:shadow-sm'}`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-block size-2 rounded-full ${tone.dot}`} />
                    <span className="text-xs text-muted-foreground tabular-nums">Step {s.step}</span>
                  </div>
                  <p className="text-sm font-medium leading-tight mt-1">{STEP_SHORT[s.step]}</p>
                  <p className={`text-xs mt-0.5 ${tone.text}`}>{tone.label}</p>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function SignOffBox({ step, entity, period, itemsPending, onChanged }: {
  step: Step; entity: string; period: { from: string; to: string }; itemsPending: boolean; onChanged: () => void
}) {
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  if (!step.signoff_applicable || step.status === 'red') return null

  const signOff = async () => {
    setBusy(true); setErr('')
    try {
      const r = await apiFetch('/api/gst/step-signoffs', {
        method: 'POST',
        body: JSON.stringify({ entity_key: entity, period_start: period.from, period_end: period.to, step: step.step, note }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(d?.error || 'Could not sign off'); return }
      setNote(''); onChanged()
    } finally { setBusy(false) }
  }
  const undo = async () => {
    if (!window.confirm('Remove this sign-off? The step goes back to pending.')) return
    const r = await apiFetch(
      `/api/gst/step-signoffs?entity=${encodeURIComponent(entity)}&period_start=${period.from}&step=${step.step}`,
      { method: 'DELETE' })
    if (r.ok) onChanged()
  }

  if (step.signed_off) {
    return (
      <div className="rounded-md border border-success/40 bg-success/10 p-3 text-sm flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-success">Signed off{step.signed_off_at ? ` · ${new Date(step.signed_off_at).toLocaleDateString('en-IN')}` : ''}</p>
          <p className="text-muted-foreground text-xs mt-0.5">{step.signed_off_note}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={undo}>Undo</Button>
      </div>
    )
  }
  if (!itemsPending) return null
  return (
    <div className="rounded-md border p-3 space-y-2">
      <p className="text-sm font-medium">Reviewed the items above?</p>
      <p className="text-xs text-muted-foreground">
        Record why they are acceptable. If a new item appears later, this step goes back to pending on its own.
      </p>
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason / what you checked" className="max-w-md" />
        <Button size="sm" disabled={busy || !note.trim()} onClick={signOff}>Sign off</Button>
      </div>
    </div>
  )
}

function UninvoicedSales({ entity, period, onChanged }: { entity: string; period: { from: string; to: string }; onChanged: () => void }) {
  const [rows, setRows] = useState<any[]>([])
  const [dialogFor, setDialogFor] = useState<string | null>(null)
  const [editFor, setEditFor] = useState<string | null>(null)
  const load = useCallback(async () => {
    const r = await apiFetch(`/api/gst/returns?metric=uninvoiced&entity=${encodeURIComponent(entity)}&from=${period.from}&to=${period.to}`)
    if (r.ok) setRows(await r.json())
  }, [entity, period.from, period.to])
  useEffect(() => { load() }, [load])

  if (rows.length === 0) return <p className="text-sm text-success">Every GST sale this month has an invoice recorded.</p>
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{rows.length} GST sale{rows.length === 1 ? '' : 's'} without an invoice</p>
      <p className="text-xs text-muted-foreground">Click a row to edit the sale (customer, price, GST, payments, void) without leaving this page.</p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Customer</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Item</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Total</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">GST</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Payment</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t cursor-pointer hover:bg-muted/50" onClick={() => setEditFor(s.id)}>
                <td className="px-3 py-2 whitespace-nowrap">{s.effective_sale_date}</td>
                <td className="px-3 py-2">{s.customer_name || '—'}</td>
                <td className="px-3 py-2 text-xs max-w-[22rem]">
                  {s.item || '—'}
                  {(s.item_code || s.unit_ref) && (
                    <span className="block text-muted-foreground">{[s.item_code, s.unit_ref].filter(Boolean).join(' · ')}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(s.sale_total)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(s.sale_gst)}</td>
                <td className="px-3 py-2"><Badge variant={s.payment_status === 'paid' ? 'secondary' : 'outline'}>{s.payment_status || 'pending'}</Badge></td>
                <td className="px-3 py-2 text-right">
                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setDialogFor(s.id) }}>Record Zoho invoice</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editFor && (
        <EditSaleDialog saleId={editFor} onClose={() => setEditFor(null)} onSaved={() => { setEditFor(null); load(); onChanged() }} />
      )}
      {dialogFor && (
        <RecordZohoInvoiceDialog
          saleIds={[dialogFor]}
          onClose={() => setDialogFor(null)}
          onRecorded={() => { setDialogFor(null); load(); onChanged() }}
        />
      )}
    </div>
  )
}

function SplitAddOn({ lineId, item, gap, onSaved }: {
  lineId: string
  item: { accessory_id: string; item: string; hsn: string | null }
  gap?: number
  onSaved: () => void
}) {
  const [amount, setAmount] = useState(gap && gap > 0 ? String(gap) : '')
  const [hsn, setHsn] = useState(item.hsn ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const inFlight = useRef(false)
  const [done, setDone] = useState(false)
  const save = async () => {
    // A ref, not just state: a fast double-click fires before the re-render that disables the button.
    if (inFlight.current || done) return
    inFlight.current = true
    setBusy(true); setMsg('')
    try {
      const r = await apiFetch(`/api/invoice-items/${lineId}/split`, {
        method: 'POST',
        body: JSON.stringify({ accessory_id: item.accessory_id, description: item.item, hsn_code: hsn.trim(), amount: Number(amount) }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setMsg(d?.error || 'Could not split'); return }
      setDone(true)
      onSaved()
    } finally { setBusy(false); inFlight.current = false }
  }
  return (
    <div className="space-y-1 rounded border border-dashed p-2">
      <p>Zoho bills <span className="font-medium">{item.item}</span> on its own line? Move it out of this line:</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} className="w-28 h-7" inputMode="decimal" placeholder="₹ before GST" aria-label="Amount before GST" />
        <Input value={hsn} onChange={(e) => setHsn(e.target.value.replace(/\D/g, '').slice(0, 8))} className="w-28 h-7" inputMode="numeric" placeholder="HSN" aria-label="HSN" />
        <Button size="sm" variant="outline" disabled={busy || done || !(Number(amount) > 0) || hsn.trim().length < 4} onClick={save}>
          {busy ? 'Splitting…' : done ? 'Split' : 'Split off'}
        </Button>
      </div>
      <p className="text-muted-foreground">The invoice total and tax stay the same; this amount moves to a new line under that HSN.</p>
      {msg && <p className="text-destructive">{msg}</p>}
    </div>
  )
}

function HsnLineEditor({ line, suggested, gaps, onSaved }: {
  line: {
    line_id: string; number: string; item: string; hsn: string; taxable: number; category: string | null; rule: string | null
    bundled_into: string | null; siblings: { line_id: string; item: string; taxable: number }[]
    inline?: { accessory_id: string; item: string; hsn: string | null; qty: number }[]
  }
  suggested: string | null
  gaps?: Record<string, number>
  onSaved: () => void
}) {
  const [code, setCode] = useState(suggested || line.hsn || '')
  const [alsoSku, setAlsoSku] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [target, setTarget] = useState('')
  const bundle = async (principal: string | null) => {
    setBusy(true); setMsg('')
    try {
      const r = await apiFetch(`/api/invoice-items/${line.line_id}/bundle`, {
        method: 'PATCH', body: JSON.stringify({ principal_line_id: principal }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setMsg(d?.error || 'Could not save'); return }
      onSaved()
    } finally { setBusy(false) }
  }
  const token = line.taxable <= 5
  const save = async () => {
    setBusy(true); setMsg('')
    try {
      const r = await apiFetch(`/api/invoice-items/${line.line_id}/hsn`, {
        method: 'PATCH', body: JSON.stringify({ hsn_code: code.trim(), also_sku: alsoSku }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setMsg(d?.error || 'Could not save'); return }
      onSaved()
    } finally { setBusy(false) }
  }
  return (
    <li className="space-y-1">
      <div>
        <span className="font-medium">{String(line.number).replace('DBI2026/27-', '')}</span>
        <span className="text-muted-foreground"> · {line.item} · now {line.hsn}{line.category ? ` (${line.category}${line.rule ? ` → rule ${line.rule}` : ''})` : ''}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} className="w-28 h-7" inputMode="numeric" aria-label="New HSN" />
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <Checkbox checked={alsoSku} onCheckedChange={(v) => setAlsoSku(v === true)} /> also the SKU
        </label>
        <Button size="sm" variant="outline" disabled={busy || code.trim().length < 4 || code.trim() === line.hsn} onClick={save}>
          {busy ? 'Saving…' : 'Set HSN'}
        </Button>
      </div>
      {line.bundled_into ? (
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          Filed as part of another line (that item&apos;s HSN and rate, no quantity of its own).
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => bundle(null)}>Unbundle</Button>
        </div>
      ) : (line.siblings?.length ?? 0) > 0 && (
        <div className={`flex flex-wrap items-center gap-2 ${token ? '' : 'text-muted-foreground'}`}>
          <span>{token ? `₹${line.taxable} add-on sold with another item?` : 'Sold in one bundle with another line?'}</span>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="h-7 w-52"><SelectValue placeholder="Bundle into…" /></SelectTrigger>
            <SelectContent>
              {(line.siblings ?? []).map((o) => (
                <SelectItem key={o.line_id} value={o.line_id}>{o.item} · ₹{o.taxable}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" disabled={busy || !target} onClick={() => bundle(target)}>Bundle</Button>
        </div>
      )}
      {(line.inline ?? []).filter((x) => x.accessory_id).map((x) => (
        <SplitAddOn key={x.accessory_id} lineId={line.line_id} item={x} gap={x.hsn ? gaps?.[x.hsn] : undefined} onSaved={onSaved} />
      ))}
      {msg && <p className="text-destructive">{msg}</p>}
    </li>
  )
}

function ZohoGstr1Check({ entity, from, to }: { entity: string; from: string; to: string }) {
  const [res, setRes] = useState<{ summary: any[]; issues: any[]; hsn_invoices: any[]; hsn_from_zoho_lines: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [fileName, setFileName] = useState('')
  const [b64, setB64] = useState('')
  // v2: the saved result shape changed (line siblings / bundle state); old saves must not be reused.
  const storeKey = `gst-zoho-check:v2:${entity}:${from}`

  // The uploaded file and its result survive a page reload / Back (per entity + month), so a
  // visit to another page to fix something does not cost a re-upload. Storage may be blocked.
  useEffect(() => {
    setRes(null); setErr(''); setFileName(''); setB64('')
    try {
      const saved = JSON.parse(sessionStorage.getItem(storeKey) || 'null')
      if (saved?.res && Array.isArray(saved.res.hsn_invoices)) { setRes(saved.res); setFileName(saved.fileName || ''); setB64(saved.b64 || '') }
    } catch { /* ignore */ }
  }, [storeKey])

  const compare = async (b: string, name: string) => {
    setBusy(true); setErr('')
    try {
      const r = await apiFetch('/api/gst/zoho-gstr1', {
        method: 'POST',
        body: JSON.stringify({ entity_key: entity, period_start: from, period_end: to, file_b64: b }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(d?.error || 'Could not compare the file'); setRes(null); return }
      setRes(d); setFileName(name); setB64(b)
      try { sessionStorage.setItem(storeKey, JSON.stringify({ res: d, fileName: name, b64: b })) } catch { /* too big or blocked */ }
    } finally { setBusy(false) }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    const buf = new Uint8Array(await file.arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    await compare(btoa(bin), file.name)
  }

  // HSN differences are shown as a plain list of invoices to check; the other rows (B2B, B2C, series)
  // stay in the table below. Zoho's summary has no invoice numbers, so Zoho-only codes can't be traced.
  const hsnTraced = (res?.issues ?? []).filter((i) => i.invoices?.length > 0)
  const hsnUntraced = (res?.issues ?? []).filter((i) => String(i.section).startsWith('HSN') && !(i.invoices?.length > 0))
  const tableIssues = (res?.issues ?? []).filter((i) => !String(i.section).startsWith('HSN'))
  const checkInvoices = (() => {
    const byInv = new Map<string, any[]>()
    for (const i of hsnTraced) for (const v of i.invoices) {
      const list = byInv.get(v.number) ?? []
      if (!list.some((x) => x.line_id === v.line_id)) list.push({ ...v, suggested: i.suggested })
      byInv.set(v.number, list)
    }
    return [...byInv.entries()].sort(([a], [b]) => a.localeCompare(b))
  })()
  // Amount Zoho bills under an HSN that the ERP invoice does not carry -- the likely size of a split-off add-on.
  const hsnGaps = (h: any) => {
    const g: Record<string, number> = {}
    for (const z of h.zoho_lines) g[z.hsn] = (g[z.hsn] ?? 0) + Number(z.taxable)
    for (const e of h.erp_lines) g[e.hsn] = (g[e.hsn] ?? 0) - Number(e.taxable)
    for (const k of Object.keys(g)) g[k] = Math.round(g[k] * 100) / 100
    return g
  }
  const blockers = tableIssues.filter((i) => i.severity === 'blocker').length
  const money = (n: number | null) => (n == null ? '—' : formatCurrency(n))
  const cnt = (n: number | null) => (n == null ? '' : `${n} · `)

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Match against Zoho's GSTR-1 summary</p>
          <p className="text-xs text-muted-foreground">
            In Zoho: Reports → Taxes → Summary of Outward Supplies, set the month, Export as Excel. Compared by the app itself (no AI); nothing is stored.
          </p>
        </div>
        <label className="inline-flex">
          <input type="file" accept=".xls,.xlsx" className="hidden" disabled={busy}
            onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />
          <span className={`inline-flex h-8 items-center rounded-md border px-3 text-sm cursor-pointer hover:bg-muted ${busy ? 'opacity-50' : ''}`}>
            {busy ? 'Comparing…' : res ? 'Upload again' : 'Upload Zoho Excel'}
          </span>
        </label>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}

      {res && (
        <>
          <p className="text-xs text-muted-foreground">{fileName}</p>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Section</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Zoho</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">ERP</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Result</th>
                </tr>
              </thead>
              <tbody>
                {res.summary.map((r) => (
                  <tr key={r.key} className="border-t align-top">
                    <td className="px-3 py-2">{r.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {cnt(r.zoho_count)}{money(r.zoho_taxable)}
                      {r.zoho_tax != null && <span className="block text-xs text-muted-foreground">tax {money(r.zoho_tax)}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {cnt(r.erp_count)}{money(r.erp_taxable)}
                      {r.erp_tax != null && <span className="block text-xs text-muted-foreground">tax {money(r.erp_tax)}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={r.status === 'match' ? 'text-success border-success/30' : 'bg-destructive/10 text-destructive border-destructive/30'}>
                        {r.status === 'match' ? 'Matches' : 'Differs'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {res.hsn_from_zoho_lines ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {res.hsn_invoices.length === 0 ? 'HSN codes agree with Zoho on every invoice.' : `${res.hsn_invoices.length} invoice${res.hsn_invoices.length === 1 ? '' : 's'} to check for HSN`}
              </p>
              {res.hsn_invoices.length > 0 && (
                <>
                  <p className="text-xs text-muted-foreground">
                    Zoho's lines come from the invoice CSV in step 1; the ERP's from the sales. Decide which side is right: fix the ERP here, or correct the invoice in Zoho and upload again.
                  </p>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Invoice</th>
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Zoho (HSN · amount)</th>
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">ERP (HSN · amount)</th>
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">Fix in ERP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {res.hsn_invoices.map((h: any) => (
                          <tr key={h.invoice_number} className="border-t align-top">
                            <td className="px-3 py-2 whitespace-nowrap font-medium">{h.invoice_number}</td>
                            <td className="px-3 py-2">
                              <ul className="space-y-0.5">
                                {h.zoho_lines.map((z: any, k: number) => (
                                  <li key={k}><span className="font-medium">{z.hsn}</span> <span className="text-muted-foreground">· ₹{z.taxable} · {z.item}</span></li>
                                ))}
                              </ul>
                            </td>
                            <td className="px-3 py-2">
                              <ul className="space-y-0.5">
                                {h.erp_lines.filter((e: any) => Math.abs(e.taxable) > 2).map((e: any) => (
                                  <li key={e.line_id}>
                                    <span className="font-medium">{e.hsn}</span> <span className="text-muted-foreground">· ₹{e.taxable} · {e.item}</span>
                                    {e.inline?.length > 0 && (
                                      <span className="block text-xs text-muted-foreground">
                                        includes: {e.inline.map((x: any, k: number) => (
                                          <span key={k}>{k > 0 ? ', ' : ''}{x.item} <span className="font-medium text-foreground">({x.hsn ? `HSN ${x.hsn}` : 'no HSN'})</span></span>
                                        ))}
                                      </span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </td>
                            <td className="px-3 py-2">
                              <details>
                                <summary className="cursor-pointer text-sm underline underline-offset-2">Change here</summary>
                                <ul className="mt-2 space-y-2 text-xs min-w-[16rem]">
                                  {h.erp_lines.filter((e: any) => Math.abs(e.taxable) > 2 || e.bundled_into).map((e: any) => (
                                    <HsnLineEditor key={e.line_id} line={{ ...e, number: h.invoice_number }} suggested={null} gaps={hsnGaps(h)} onSaved={() => compare(b64, fileName)} />
                                  ))}
                                </ul>
                              </details>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          ) : (
          <div className="space-y-2">
            <p className="text-sm text-warning">Zoho&apos;s HSN per line is not available yet — re-upload the Zoho invoice CSV in step 1 (it now keeps each line&apos;s HSN/SAC), then upload this Excel again. Until then this list is inferred from the HSN totals.</p>
            <p className="text-sm font-medium">
              {checkInvoices.length === 0 ? 'No invoices to check for HSN.' : `${checkInvoices.length} invoice${checkInvoices.length === 1 ? '' : 's'} to check for HSN`}
            </p>
            {checkInvoices.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground">
                  The ERP files these lines under a different HSN than Zoho. Open the same invoice in Zoho and in the ERP, find the line, and change whichever is wrong — the ERP side can be fixed right here.
                </p>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Invoice</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Lines to check</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Fix in ERP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checkInvoices.map(([number, lines]) => (
                        <tr key={number} className="border-t align-top">
                          <td className="px-3 py-2 whitespace-nowrap font-medium">{number}</td>
                          <td className="px-3 py-2">
                            <ul className="space-y-0.5">
                              {lines.map((v: any) => (
                                <li key={v.line_id}>
                                  {v.item} <span className="text-muted-foreground">· ₹{v.taxable}</span>
                                  <span className="block text-xs text-muted-foreground">
                                    ERP HSN <span className="font-medium text-foreground">{v.hsn}</span>
                                    {' · '}Zoho HSN {v.zoho_hsn
                                      ? <span className="font-medium text-foreground">{v.zoho_hsn}</span>
                                      : <span>not in Zoho&apos;s summary — see the Zoho invoice</span>}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </td>
                          <td className="px-3 py-2">
                            <details>
                              <summary className="cursor-pointer text-sm underline underline-offset-2">Change here</summary>
                              <ul className="mt-2 space-y-2 text-xs min-w-[16rem]">
                                {lines.map((v: any) => (
                                  <HsnLineEditor key={v.line_id} line={v} suggested={v.suggested} onSaved={() => compare(b64, fileName)} />
                                ))}
                              </ul>
                            </details>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {hsnUntraced.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {hsnUntraced.length} more HSN difference{hsnUntraced.length === 1 ? '' : 's'} could not be traced to an invoice from Zoho&apos;s summary (a code only Zoho has, or a value split). Once the invoices above are fixed and you upload again, whatever remains points at the cause.
              </p>
            )}
          </div>
          )}

          {tableIssues.length === 0 ? (
            <p className="text-sm text-success">B2B, B2C and the invoice series match Zoho.</p>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-medium">{blockers} to fix{tableIssues.length > blockers ? ` · ${tableIssues.length - blockers} to note` : ''}</p>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Where</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Problem</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Zoho</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">ERP</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">How to fix</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableIssues.map((i, n) => (
                      <tr key={n} className="border-t align-top">
                        <td className="px-3 py-2 whitespace-nowrap">
                          <Badge variant="outline" className={i.severity === 'blocker' ? 'bg-destructive/10 text-destructive border-destructive/30' : 'bg-warning/10 text-warning border-warning/30'}>
                            {i.severity === 'blocker' ? 'Fix' : 'Note'}
                          </Badge>
                          <span className="block text-xs text-muted-foreground mt-1">{i.section}</span>
                          {i.invoice_id
                            ? <a href={`/dashboard/invoices/${i.invoice_id}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{i.ref}</a>
                            : <span>{i.ref}</span>}
                          {i.invoices?.length > 0 && (
                            <ul className="mt-2 space-y-2 text-xs whitespace-normal min-w-[16rem]">
                              {i.invoices.map((v: any) => (
                                <HsnLineEditor key={v.line_id} line={v} suggested={i.suggested} onSaved={() => compare(b64, fileName)} />
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="px-3 py-2">{i.problem}</td>
                        <td className="px-3 py-2 text-muted-foreground">{i.zoho}</td>
                        <td className="px-3 py-2 text-muted-foreground">{i.erp}</td>
                        <td className="px-3 py-2">
                          {i.suggested && <p className="font-medium">Suggested HSN: {i.suggested}</p>}
                          {i.fix}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function HeadTotals({ detail }: { detail: any }) {
  const heads: [string, string][] = [['cgst', 'CGST'], ['sgst', 'SGST'], ['igst', 'IGST']]
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">Invoice count and month totals by tax head</p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Head</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">ERP</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Zoho</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Difference</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t bg-muted/30">
              <td className="px-3 py-2 font-medium">Invoices</td>
              <td className="px-3 py-2 text-right tabular-nums">{Number(detail?.erp_invoice_count ?? 0)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{Number(detail?.zoho_invoice_count ?? 0)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${Number(detail?.zoho_invoice_count ?? 0) === Number(detail?.erp_invoice_count ?? 0) ? 'text-success' : 'text-destructive'}`}>
                {Number(detail?.zoho_invoice_count ?? 0) - Number(detail?.erp_invoice_count ?? 0)}
              </td>
            </tr>
            {heads.map(([k, label]) => {
              const e = Number(detail?.erp?.[k] ?? 0), z = Number(detail?.zoho?.[k] ?? 0), d = z - e
              const ec = Number(detail?.erp_head_counts?.[k] ?? 0), zc = Number(detail?.zoho_head_counts?.[k] ?? 0), dc = zc - ec
              return (
                <tr key={k} className="border-t">
                  <td className="px-3 py-2">{label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(e)}<span className="block text-xs text-muted-foreground">{ec} invoice{ec === 1 ? '' : 's'}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(z)}<span className="block text-xs text-muted-foreground">{zc} invoice{zc === 1 ? '' : 's'}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className={Math.abs(d) > 1 ? 'text-destructive' : 'text-success'}>{formatCurrency(d)}</span>
                    <span className={`block text-xs ${dc === 0 ? 'text-success' : 'text-destructive'}`}>{dc === 0 ? 'same count' : `${dc > 0 ? '+' : ''}${dc} invoice${Math.abs(dc) === 1 ? '' : 's'}`}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {Number(detail?.zoho_ignored_tax) > 0 && (
        <p className="text-xs text-muted-foreground">
          Excludes {formatCurrency(detail.zoho_ignored_tax)} of tax on Zoho documents you marked as ignored (e.g. cancelled).
        </p>
      )}
    </div>
  )
}

function ApprovalAndFiling({ entity, from, to, periodLabel, returnType, lockModule, stage, step, onChanged }: {
  entity: string; from: string; to: string; periodLabel: string
  returnType: 'gstr1' | 'gstr3b'; lockModule: 'sales' | 'purchases'
  stage: 'approve' | 'file'; step: Step; onChanged: () => void
}) {
  const [filing, setFiling] = useState<any>(null)
  const [arn, setArn] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const label = returnType === 'gstr1' ? 'GSTR-1' : 'GSTR-3B'

  const refresh = useCallback(async () => {
    const r = await apiFetch(`/api/gst/filings?entity=${encodeURIComponent(entity)}`)
    if (r.ok) {
      const all: any[] = await r.json()
      setFiling(all.find((f) => f.return_type === returnType && f.period_start === from) ?? null)
    }
  }, [entity, returnType, from])
  useEffect(() => { refresh() }, [refresh, step.status])

  const post = async (status: 'exported' | 'draft' | 'filed') => {
    setBusy(true); setErr(''); setMsg('')
    try {
      const r = await apiFetch('/api/gst/filings', {
        method: 'POST',
        body: JSON.stringify({ entity_key: entity, return_type: returnType, period_start: from, period_end: to, status, arn: arn || null }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(d?.error || 'Failed'); return }
      setMsg(status === 'exported' ? `${label} approved for ${periodLabel}.` : status === 'filed' ? `${label} recorded as filed.` : 'Approval withdrawn.')
      setArn(''); await refresh(); onChanged()
    } finally { setBusy(false) }
  }

  const lockNow = async () => {
    setBusy(true); setErr(''); setMsg('')
    try {
      const r = await apiFetch('/api/gst/period-locks', {
        method: 'POST',
        body: JSON.stringify({ entity_key: entity, module: lockModule, locked_through_date: to, reason: `${label} filed for ${periodLabel}` }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(d?.error || 'Failed'); return }
      setMsg(`${lockModule === 'sales' ? 'Sales' : 'Purchases'} locked through ${to}.`); onChanged()
    } finally { setBusy(false) }
  }

  const approved = !!filing && ['exported', 'filed'].includes(filing.status)
  const filed = filing?.status === 'filed'
  const locked = !!(lockModule === 'sales' ? step.detail?.sales_locked : step.detail?.purchases_locked)

  return (
    <div className="space-y-3">
      {err && <ErrorBanner message={err} />}
      {msg && <p className="text-sm text-success">{msg}</p>}

      {stage === 'approve' && (
        <div className="rounded-md border p-3 space-y-2">
          {approved && step.status === 'green' && (
            <p className="text-sm text-success">
              Approved{filing?.updated_at ? ` · ${new Date(filing.updated_at).toLocaleString('en-IN')}` : ''}. These exact figures are frozen.
            </p>
          )}
          {approved && step.status !== 'green' && <p className="text-sm text-warning">{step.reason}</p>}
          {!approved && <p className="text-sm text-muted-foreground">{step.reason ?? `Review the figures above, then approve ${label}.`}</p>}
          <div className="flex gap-2">
            <Button disabled={busy || step.status === 'red' || (approved && step.status === 'green')} onClick={() => post('exported')}>
              {approved ? `Approve ${label} again` : `Approve ${label}`}
            </Button>
            {approved && !filed && <Button variant="outline" disabled={busy} onClick={() => post('draft')}>Withdraw approval</Button>}
          </div>
        </div>
      )}

      {stage === 'file' && (
        <div className="rounded-md border p-3 space-y-3">
          {!approved && <p className="text-sm text-muted-foreground">{step.reason ?? `Approve ${label} first.`}</p>}
          {approved && !filed && (
            <>
              <p className="text-sm">
                Approved. File {label} for {periodLabel} on the GST portal using the approved figures, then enter the ARN the portal gives you.
              </p>
              <div className="flex flex-wrap gap-2 items-end">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">ARN</label>
                  <Input value={arn} onChange={(e) => setArn(e.target.value)} className="w-[260px]" placeholder="e.g. AA090126012345Z" />
                </div>
                <Button disabled={busy || !arn.trim()} onClick={() => post('filed')}>Record as filed</Button>
              </div>
            </>
          )}
          {filed && (
            <p className="text-sm text-success">
              Filed{filing.filed_at ? ` on ${new Date(filing.filed_at).toLocaleDateString('en-IN')}` : ''} · ARN <span className="font-mono">{filing.arn}</span>
            </p>
          )}
          {filed && !locked && (
            <div className="flex items-center gap-3">
              <p className="text-sm text-warning">{lockModule === 'sales' ? 'Sales' : 'Purchases'} are not locked yet.</p>
              <Button size="sm" variant="outline" disabled={busy} onClick={lockNow}>
                Lock {lockModule === 'sales' ? 'sales' : 'purchases'} through {to}
              </Button>
            </div>
          )}
          {filed && locked && <p className="text-xs text-success">✓ {lockModule === 'sales' ? 'Sales' : 'Purchases'} locked through month-end.</p>}
        </div>
      )}
    </div>
  )
}

export default function GstClient() {
  const months = useMemo(() => monthOptions(), [])
  const [entities, setEntities] = useState<EntityOption[]>([])
  // Entity, month and step live in the URL so Back / refresh returns to the same place.
  const router = useRouter()
  const sp = useSearchParams()
  const urlMonth = sp.get('month')
  const [entity, setEntity] = useState<string>(sp.get('entity') ?? '')
  const [month, setMonth] = useState<string>(
    months.find((m) => m.value === urlMonth)?.value ?? months[1]?.value ?? months[0].value)
  const [readiness, setReadiness] = useState<any>(null)
  const [steps, setSteps] = useState<Step[]>([])
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([])
  const [papers, setPapers] = useState<{ sections: any; hsn: any; docs: any } | null>(null)
  const [completeness2, setCompleteness2] = useState<any>(null)
  const [r3b, setR3b] = useState<any>(null)
  const [recon, setRecon] = useState<any>(null)
  const [dash, setDash] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<number | null>(Number(sp.get('step')) || null)

  const period = months.find((m) => m.value === month) ?? months[0]

  useEffect(() => {
    apiFetch('/api/gst/returns?metric=entities')
      .then((r) => r.json())
      .then((d) => {
        const list: EntityOption[] = Array.isArray(d) ? d : []
        setEntities(list)
        if (list.length && !entity) setEntity(list[0].key)
      })
      .catch(() => setError('Could not load GST-registered entities.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = useCallback(async () => {
    if (!entity) return
    setLoading(true)
    setError('')
    try {
      const qs = `entity=${encodeURIComponent(entity)}&from=${period.from}&to=${period.to}`
      const [rRes, stRes, eRes, sRes, hRes, dRes, cRes, bRes, vRes, dashRes] = await Promise.all([
        apiFetch(`/api/gst/returns?metric=readiness&${qs}`),
        apiFetch(`/api/gst/returns?metric=steps&${qs}`),
        apiFetch(`/api/gst/returns?metric=exceptions&${qs}`),
        apiFetch(`/api/gst/returns?metric=r1_sections&${qs}`),
        apiFetch(`/api/gst/returns?metric=r1_hsn&${qs}`),
        apiFetch(`/api/gst/returns?metric=r1_docs&${qs}`),
        apiFetch(`/api/gst/returns?metric=completeness&${qs}`),
        apiFetch(`/api/gst/returns?metric=r3b&${qs}`),
        apiFetch(`/api/gst/returns?metric=books_vs_return&${qs}`),
        apiFetch(`/api/gst/returns?metric=dashboard&entity=${encodeURIComponent(entity)}&months=12`),
      ]) as any
      if (!rRes.ok) throw new Error((await rRes.json())?.error || 'Failed to load readiness')
      if (!stRes.ok) throw new Error((await stRes.json())?.error || 'Failed to load steps')
      if (!eRes.ok) throw new Error((await eRes.json())?.error || 'Failed to load exceptions')
      setReadiness(await rRes.json())
      const st = await stRes.json()
      setSteps(Array.isArray(st) ? st : [])
      const ex = await eRes.json()
      setExceptions(Array.isArray(ex) ? ex : (ex?.data ?? []))
      setCompleteness2(cRes.ok ? await cRes.json() : null)
      setR3b(bRes.ok ? await bRes.json() : null)
      setRecon(vRes.ok ? await vRes.json() : null)
      setDash(dashRes.ok ? await dashRes.json() : null)
      setPapers({
        sections: sRes.ok ? await sRes.json() : null,
        hsn: hRes.ok ? await hRes.json() : null,
        docs: dRes.ok ? await dRes.json() : null,
      })
    } catch (e: any) {
      setError(e?.message || 'Failed to load GST data')
    } finally {
      setLoading(false)
    }
  }, [entity, period.from, period.to])

  useEffect(() => { load() }, [load])
  // Changing entity or month starts the checklist fresh -- but not on the first render, which
  // would throw away the step restored from the URL.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    setPicked(null)
  }, [entity, month])
  useEffect(() => {
    if (!entity) return
    const q = new URLSearchParams({ entity, month })
    if (picked) q.set('step', String(picked))
    router.replace(`?${q.toString()}`, { scroll: false })
  }, [entity, month, picked, router])

  const firstPending = steps.find((s) => s.status !== 'green')?.step ?? steps.length
  const current = picked ?? firstPending
  const cur = steps.find((s) => s.step === current)
  const redIn1to5 = steps.filter((s) => s.step <= 5 && s.status === 'red').length
  const doneCount = steps.filter((s) => s.status === 'green').length

  const rowsFor = (n: number) => exceptions.filter((e) => (STEP_CODES[n] ?? []).includes(e.check_code))
  const sortedPending = (n: number) => rowsFor(n).length

  const renderPanel = (s: Step) => {
    const tone = TONE[s.status]
    const n = s.step
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-base">Step {n} · {s.title}</CardTitle>
            <Badge variant="outline" className={tone.text}>{tone.label}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{STEP_WHY[n]}</p>
          {s.reason && <p className={`text-sm font-medium ${tone.text}`}>{s.reason}</p>}
        </CardHeader>
        <CardContent className="space-y-4">
          {n === 2 && (
            <>
              <UninvoicedSales entity={entity} period={period} onChanged={load} />
              {Number(s.detail?.unpaid_count) > 0 && (
                <p className="text-xs text-muted-foreground">
                  For information: {s.detail.unpaid_count} GST sale{s.detail.unpaid_count === 1 ? ' is' : 's are'} not fully paid yet. That does not hold up GSTR-1 — tax on goods is due on supply, not receipt.
                </p>
              )}
              {sortedPending(2) > 0 && <ExceptionTable rows={rowsFor(2)} entity={entity} onChanged={load} />}
              <SignOffBox step={s} entity={entity} period={period} itemsPending={Number(s.detail?.uninvoiced_count) > 0} onChanged={load} />
            </>
          )}

          {(n === 3 || n === 4 || n === 8) && (
            <>
              {n === 8 && (
                <MatchUploads entity={entity} from={period.from} to={period.to} kinds={['gstr2b']} onChanged={load} />
              )}
              {rowsFor(n).length > 0 && <ExceptionTable rows={rowsFor(n)} entity={entity} onChanged={load} />}
              {rowsFor(n).length === 0 && n !== 8 && <p className="text-sm text-success">Nothing to fix here.</p>}
              {n === 4 && <Reconcile data={completeness2} gstin={readiness?.entity?.gstin ?? null} from={period.from} />}
              <SignOffBox step={s} entity={entity} period={period} itemsPending={s.warnings > 0} onChanged={load} />
            </>
          )}

          {n === 1 && (
            <MatchUploads entity={entity} from={period.from} to={period.to} kinds={['zoho_invoices']} focus="amount" onChanged={load} />
          )}

          {n === 5 && (
            <>
              <HeadTotals detail={s.detail} />
              <MatchUploads entity={entity} from={period.from} to={period.to} kinds={['zoho_invoices']} focus="heads" onChanged={load} />
            </>
          )}

          {n === 6 && (
            <>
              <ZohoGstr1Check entity={entity} from={period.from} to={period.to} />
              <WorkingPapers papers={papers} gstin={readiness?.entity?.gstin ?? null} from={period.from} blockers={redIn1to5} recon={recon} />
              <ApprovalAndFiling entity={entity} from={period.from} to={period.to} periodLabel={period.label}
                returnType="gstr1" lockModule="sales" stage="approve" step={s} onChanged={load} />
            </>
          )}

          {n === 7 && (
            <ApprovalAndFiling entity={entity} from={period.from} to={period.to} periodLabel={period.label}
              returnType="gstr1" lockModule="sales" stage="file" step={s} onChanged={load} />
          )}

          {n === 9 && (
            <>
              <Gstr3b data={r3b} recon={recon} />
              <ApprovalAndFiling entity={entity} from={period.from} to={period.to} periodLabel={period.label}
                returnType="gstr3b" lockModule="purchases" stage="approve" step={s} onChanged={load} />
            </>
          )}

          {n === 10 && (
            <ApprovalAndFiling entity={entity} from={period.from} to={period.to} periodLabel={period.label}
              returnType="gstr3b" lockModule="purchases" stage="file" step={s} onChanged={load} />
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <GstNewsPanel />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">GST Returns</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pick the month, then work through the steps in order. Each tile turns green when its checks pass.
            Nothing is filed from here — you file on the GST portal using the approved figures.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <Select value={entity} onValueChange={setEntity}>
            <SelectTrigger className="w-full sm:w-[220px]"><SelectValue placeholder="Entity" /></SelectTrigger>
            <SelectContent>
              {entities.map((e) => (
                <SelectItem key={e.key} value={e.key}>
                  {e.legal_name}{e.gstin ? ` · ${e.gstin}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="flex-1 sm:flex-none sm:w-[180px]"><SelectValue placeholder="Month" /></SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => load()} disabled={loading} title="Refresh">
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {entities.length === 0 && !loading && !error && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">
          No GST-registered entity is configured. A return only exists for an entity with
          <span className="font-medium"> GST registered</span> set in Settings → Business Profiles.
        </CardContent></Card>
      )}

      {loading && steps.length === 0 && <p className="text-sm text-muted-foreground">Loading…</p>}

      {steps.length > 0 && (
        <>
          <p className="text-sm text-muted-foreground">
            {period.label} · <span className="font-medium text-foreground">{doneCount} of {steps.length}</span> steps done
          </p>
          <StepTiles steps={steps} current={current} onSelect={setPicked} periodFrom={period.from} />
          {cur && renderPanel(cur)}
          <div className="flex justify-between">
            <Button variant="ghost" size="sm" disabled={current <= 1} onClick={() => setPicked(current - 1)}>← Previous step</Button>
            <Button variant="ghost" size="sm" disabled={current >= steps.length} onClick={() => setPicked(current + 1)}>Next step →</Button>
          </div>

          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">All months &amp; period locks</summary>
            <div className="mt-3 space-y-4">
              <PeriodsTable data={dash} />
              <PeriodLocks entity={entity} from={period.from} to={period.to} periodLabel={period.label} onChanged={load} />
            </div>
          </details>
        </>
      )}
    </div>
  )
}

/**
 * Where a finding can be opened. Only invoices have a detail route today, so
 * everything else links to its list page -- which is still better than a label
 * you have to go and search for by hand. Deliberately returns null rather than
 * a dead link where there is nothing useful to open.
 */
function recordHref(r: ExceptionRow): string | null {
  if (!r.record_id) return null
  switch (r.record_type) {
    case 'invoice': return `/dashboard/invoices/${r.record_id}`
    case 'sale': return '/dashboard/sales'
    case 'customer': return '/dashboard/customers'
    case 'sku': return '/dashboard/sku-master'
    default: return null
  }
}

function ExceptionTable({ rows, entity, onChanged }: { rows: ExceptionRow[]; entity: string; onChanged: () => void }) {
  // Blockers first, then by check so like problems sit together.
  const sorted = [...rows].sort((a, b) =>
    a.severity === b.severity
      ? a.check_code.localeCompare(b.check_code)
      : a.severity === 'blocker' ? -1 : 1
  )

  const acknowledgeGap = async (r: ExceptionRow) => {
    if (!r.series_key || r.seq == null) return
    const reason = window.prompt(
      `Why was ${r.record_label} cancelled? (e.g. "Raised and cancelled in Zoho, never entered in the ERP" -- shown in the audit log and reported as cancelled in Table 13, not omitted)`
    )
    if (reason === null) return
    if (!reason.trim()) { alert('A reason is required.'); return }
    const res = await apiFetch('/api/gst/void-numbers', {
      method: 'POST',
      body: JSON.stringify({ entity_key: entity, series_key: r.series_key, seq: r.seq, reason: reason.trim() }),
    })
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error || 'Failed to record.'); return }
    onChanged()
  }

  const refreshFromCustomer = async (r: ExceptionRow) => {
    if (!r.record_id) return
    const res = await apiFetch('/api/gst/refresh-invoice-customer', { method: 'POST', body: JSON.stringify({ invoice_id: r.record_id }) })
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error || 'Failed to refresh.'); return }
    onChanged()
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Period</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Severity</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Check</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Record</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">What&apos;s wrong</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && <EmptyTableRow colSpan={6} message="Nothing to fix here." />}
          {sorted.map((r, i) => (
            <tr key={`${r.check_code}-${r.record_id ?? r.record_label}-${i}`} className="border-t align-top">
              <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                {r.period_month
                  ? new Date(r.period_month).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
                  : 'Any'}
              </td>
              <td className="px-3 py-2">
                <Badge variant={r.severity === 'blocker' ? 'destructive' : 'secondary'}>{r.severity}</Badge>
              </td>
              <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.check_code}</td>
              <td className="px-3 py-2">
                {(() => {
                  const href = recordHref(r)
                  const label = r.record_label || '—'
                  return href
                    ? <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">{label}</a>
                    : label
                })()}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{r.detail}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {r.check_code === 'doc_series_gap' && (
                  <Button variant="outline" size="sm" onClick={() => acknowledgeGap(r)}>
                    Mark cancelled (Zoho)
                  </Button>
                )}
                {r.check_code === 'invoice_customer_gstin_stale' && (
                  <Button variant="outline" size="sm" onClick={() => refreshFromCustomer(r)}>
                    Refresh from customer
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const PAPER_SOURCE: Record<GstSectionKey, 'sections' | 'hsn' | 'docs'> = {
  b2b: 'sections', b2cl: 'sections', b2cs: 'sections',
  cdnr: 'sections', cdnur: 'sections',
  hsn_b2b: 'hsn', hsn_b2c: 'hsn', docs: 'docs',
}

function WorkingPapers({
  papers, gstin, from, blockers, recon,
}: {
  papers: { sections: any; hsn: any; docs: any } | null
  gstin: string | null
  from: string
  blockers: number
  recon?: any
}) {
  if (!papers) return <p className="text-sm text-muted-foreground">No working papers for this period.</p>

  const keys = Object.keys(GST_SECTIONS) as GstSectionKey[]
  const payloadFor = (k: GstSectionKey) => papers[PAPER_SOURCE[k]]
  const countFor = (k: GstSectionKey) => {
    try { return GST_SECTIONS[k].rows(payloadFor(k)).length } catch { return 0 }
  }

  const download = (k: GstSectionKey) =>
    downloadCsv(gstCsvFilename(k, gstin, from), sectionCsv(k, payloadFor(k)))

  const downloadAll = () => keys.forEach((k) => download(k))

  // Table 12 carries the portal's own HSN-master description per code, so fetch those first.
  const downloadPortalJson = async (only?: string) => {
    const codes = [...new Set([...(papers.hsn?.hsn_b2b ?? []), ...(papers.hsn?.hsn_b2c ?? [])].map((r: any) => String(r.hsn_sc)))]
    let hsnMaster: Record<string, string> = {}
    try {
      const r = await apiFetch('/api/gst/hsn-descriptions', { method: 'POST', body: JSON.stringify({ codes }) })
      if (r.ok) hsnMaster = await r.json()
    } catch { /* falls back to our own description */ }
    downloadJson(
      gstr1JsonFilename(gstin!, from).replace('.json', only ? `_${only}.json` : '.json'),
      buildGstr1Json({
        gstin: gstin!, periodFrom: from,
        sections: papers.sections, hsn: papers.hsn, docs: papers.docs, hsnMaster,
        ...(only ? { only: [only] } : {}),
      })
    )
  }

  // Table 12 has to tie to the section totals -- the portal cross-validates it.
  const sectionTx = ['b2b', 'b2cl', 'b2cs'].reduce((sum, k) => {
    const rows = GST_SECTIONS[k as GstSectionKey].rows(papers.sections) as any[]
    return sum + rows.reduce((a, r) => a + Number(r['Taxable Value'] || 0), 0)
  }, 0)
  const hsnTx = ['hsn_b2b', 'hsn_b2c'].reduce((sum, k) => {
    const rows = GST_SECTIONS[k as GstSectionKey].rows(papers.hsn) as any[]
    return sum + rows.reduce((a, r) => a + Number(r['Taxable Value'] || 0), 0)
  }, 0)
  const tableTwelveTies = Math.abs(sectionTx - hsnTx) < 1

  return (
    <div className="space-y-4">
      {blockers > 0 && (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm">
            <p className="font-medium text-destructive">
              {blockers} blocker{blockers === 1 ? '' : 's'} outstanding — these figures are not filing-ready.
            </p>
            <p className="text-muted-foreground mt-1">
              You can still download them to work through with your CA, but clear the Validation tab before filing.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className={tableTwelveTies ? undefined : 'border-destructive/40'}>
        <CardContent className="pt-6 text-sm flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">
              Table 12 vs Tables 4/5/7:{' '}
              <span className={tableTwelveTies ? 'text-success' : 'text-destructive'}>
                {tableTwelveTies ? 'reconciled' : 'mismatch'}
              </span>
            </p>
            <p className="text-muted-foreground mt-1 tabular-nums">
              Sections {formatCurrency(sectionTx)} · HSN summary {formatCurrency(hsnTx)}
              {!tableTwelveTies && ` · difference ${formatCurrency(Math.abs(sectionTx - hsnTx))}`}
            </p>
            {!tableTwelveTies && (
              <p className="text-muted-foreground mt-1">
                The portal validates these against each other. The gap is lines whose HSN could not be
                resolved — see <span className="font-mono text-xs">invoice_line_hsn_unresolvable</span> under Validation.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={downloadAll}>All sections (CSV)</Button>
            <Button disabled={!gstin} onClick={() => downloadPortalJson()}>
              Portal JSON
            </Button>
          </div>
          <div className="basis-full text-xs text-muted-foreground flex flex-wrap items-center gap-2">
            Portal says &quot;File could not be uploaded&quot;? Upload one table at a time to find which one it rejects:
            {([['b2b', 'B2B'], ['b2cs', 'B2C small'], ['hsn', 'HSN'], ['doc_issue', 'Documents']] as const).map(([key, label]) => (
              <Button key={key} size="sm" variant="outline" disabled={!gstin} onClick={() => downloadPortalJson(key)}>
                {label} only
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Section</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Rows</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Taxable value</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">CSV</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const rows = GST_SECTIONS[k].rows(payloadFor(k)) as any[]
              const tx = rows.reduce((a, r) => a + Number(r['Taxable Value'] || 0), 0)
              return (
                <tr key={k} className="border-t">
                  <td className="px-3 py-2">{GST_SECTIONS[k].label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{countFor(k)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {k === 'docs' ? '—' : formatCurrency(tx)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button variant="outline" size="sm" onClick={() => download(k)}>Download</Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Column headers match the GST portal&apos;s offline-tool templates, and dates are dd-mmm-yyyy as those
        templates require. Nothing is filed from here — upload at gst.gov.in, or hand these to your CA.
      </p>
    </div>
  )
}

/**
 * The two "something is missing" problems, which are different in kind from the
 * rest of validation: a wrong value gets rejected at the portal, but a missing
 * invoice just quietly under-reports. Both have to be reconciled against
 * whatever system actually issued the invoices, so this exists to be exported
 * and worked through offline rather than fixed in the app.
 */
function Reconcile({ data, gstin, from }: { data: any; gstin: string | null; from: string }) {
  if (!data) return <p className="text-sm text-muted-foreground">Nothing to reconcile for this period.</p>

  // Series gaps only (2026-10-05): the uninvoiced-sales half of this worksheet
  // was removed -- invoices are issued in Zoho, not here, and a sale is
  // deliberately left uninvoiced until payment is secured, so this is no
  // longer something to chase per-row from the ERP. Protection against
  // under-reporting is the Zoho register match (steps 1 and 5), not this worksheet.
  const gaps: any[] = data.series_gaps ?? []

  const dl = () => downloadCsv(worksheetFilename('gaps', gstin, from), worksheetCsv('gaps', data))

  if (gaps.length === 0) {
    return (
      <Card className="border-success/30">
        <CardContent className="pt-6 text-sm">
          <p className="font-medium text-success">No gaps in the invoice number series.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="border-destructive/40">
        <CardContent className="pt-6 text-sm flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-medium text-destructive">
              {gaps.length} missing invoice number{gaps.length === 1 ? '' : 's'}
            </p>
            <p className="text-muted-foreground mt-1">
              Table 13 needs every number accounted for as issued or cancelled. Check whether each one
              was cancelled, or issued but never recorded in the ERP.
            </p>
          </div>
          <Button variant="outline" onClick={dl}>Gaps worksheet</Button>
        </CardContent>
      </Card>

      <div>
        <h3 className="text-sm font-medium mb-2">Missing invoice numbers</h3>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Missing</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Comes after</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Comes before</th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((g) => (
                <tr key={g.missing_number} className="border-t">
                  <td className="px-3 py-2 font-mono tabular-nums">{g.missing_number}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {g.previous_invoice} ({g.previous_date})
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {g.next_invoice} ({g.next_date})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function TaxRow({ label, v }: { label: string; v: any }) {
  return (
    <tr className="border-t">
      <td className="px-3 py-2">{label}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(v?.taxable_value ?? 0)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(v?.cgst ?? 0)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(v?.sgst ?? 0)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(v?.igst ?? v?.tax ?? 0)}</td>
    </tr>
  )
}

// Net tax payable by head: output tax (Table 3.1) set off against the input credit the
// portal will show from GSTR-2B (falls back to the ERP's own ITC tagging when no 2B has
// been uploaded), plus an optional opening balance from the portal's electronic credit
// ledger. An estimate -- the portal's own set-off at filing is what counts.
function TaxPayable({ t31, itc, itc2b }: { t31: any; itc: any; itc2b: any }) {
  const [opening, setOpening] = useState({ igst: '', cgst: '', sgst: '' })
  const n = (v: any) => Number(v) || 0
  const out = t31.a_outward_taxable ?? {}
  const rcmTax = n(t31.d_inward_reverse_charge?.tax)
  const erpItc = itc['4A_all_other_itc'] ?? {}
  const base = itc2b ?? erpItc
  const credit = {
    igst: n(base.igst) + n(opening.igst),
    cgst: n(base.cgst) + n(opening.cgst),
    sgst: n(base.sgst) + n(opening.sgst),
  }
  const r = setOff({ igst: n(out.igst), cgst: n(out.cgst), sgst: n(out.sgst) }, credit)
  const heads: Array<'igst' | 'cgst' | 'sgst'> = ['igst', 'cgst', 'sgst']
  const label = { igst: 'IGST', cgst: 'CGST', sgst: 'SGST' }
  const used = (h: 'igst' | 'cgst' | 'sgst') =>
    h === 'igst' ? r.used.igst_on_igst + r.used.cgst_on_igst + r.used.sgst_on_igst
    : h === 'cgst' ? r.used.igst_on_cgst + r.used.cgst_on_cgst
    : r.used.igst_on_sgst + r.used.sgst_on_sgst
  const cashTotal = r.cash.igst + r.cash.cgst + r.cash.sgst + rcmTax
  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">Tax payable this month (estimate)</h3>
          <p className={`text-sm font-medium ${cashTotal > 0 ? 'text-destructive' : 'text-success'}`}>
            {cashTotal > 0 ? `Pay from cash: ${formatCurrency(cashTotal)}` : 'Nothing to pay from cash'}
          </p>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground"></th>
                {heads.map((h) => <th key={h} className="text-right px-3 py-2 font-medium text-muted-foreground">{label[h]}</th>)}
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Total</th>
              </tr>
            </thead>
            <tbody>
              {([
                ['Output tax (Table 3.1)', (h: any) => (r.liability as any)[h]],
                [itc2b ? 'ITC from GSTR-2B' : 'ITC from ERP purchases (no 2B uploaded)', (h: any) => n(base[h])],
                ['+ Opening credit balance', (h: any) => n((opening as any)[h])],
                ['ITC used', (h: any) => used(h)],
                ['To pay from cash', (h: any) => (r.cash as any)[h]],
                ['ITC carried forward', (h: any) => (r.carry_forward as any)[h]],
              ] as Array<[string, (h: any) => number]>).map(([lbl, f], i) => (
                <tr key={lbl} className={`border-t ${i === 4 ? 'font-medium bg-muted/40' : ''}`}>
                  <td className="px-3 py-2">{lbl}</td>
                  {heads.map((h) => <td key={h} className="px-3 py-2 text-right tabular-nums">{formatCurrency(f(h))}</td>)}
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(heads.reduce((a, h) => a + f(h), 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>Opening credit balance (from the portal&apos;s Electronic Credit Ledger):</span>
          {heads.map((h) => (
            <label key={h} className="flex items-center gap-1">
              {label[h]}
              <input
                inputMode="decimal" value={(opening as any)[h]} placeholder="0"
                onChange={(e) => setOpening((o) => ({ ...o, [h]: e.target.value.replace(/[^0-9.]/g, '') }))}
                className="h-7 w-24 rounded border bg-background px-2 text-right tabular-nums text-foreground"
              />
            </label>
          ))}
        </div>
        <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
          <li>Set-off order: IGST credit pays IGST, then CGST, then SGST. CGST and SGST credit pay their own head, then IGST; they can never pay each other.</li>
          {itc2b && <li>ITC is the non-reverse-charge total of the GSTR-2B you uploaded ({itc2b.invoices} invoices). It assumes you claim all of it; remove anything ineligible first.</li>}
          {itc2b && n(itc2b.reverse_charge?.invoices) > 0 && (
            <li>{itc2b.reverse_charge.invoices} reverse-charge invoice{itc2b.reverse_charge.invoices === 1 ? '' : 's'} in 2B (tax {formatCurrency(n(itc2b.reverse_charge.igst) + n(itc2b.reverse_charge.cgst) + n(itc2b.reverse_charge.sgst))}) are left out: that credit only arrives after you pay the tax in cash.</li>
          )}
          {!itc2b && <li>No GSTR-2B uploaded for this month, so ITC here is only what the ERP has tagged. Upload 2B in step 8 for the real figure.</li>}
          {rcmTax > 0 && <li>Reverse-charge tax of {formatCurrency(rcmTax)} must be paid in cash and is already included in the total above.</li>}
          {itc2b && n(erpItc.igst) + n(erpItc.cgst) + n(erpItc.sgst) < n(itc2b.igst) + n(itc2b.cgst) + n(itc2b.sgst) - 1 && (
            <li>The ERP has booked less purchase credit ({formatCurrency(n(erpItc.igst) + n(erpItc.cgst) + n(erpItc.sgst))}) than 2B shows ({formatCurrency(n(itc2b.igst) + n(itc2b.cgst) + n(itc2b.sgst))}). The difference is purchases not yet entered in the ERP.</li>
          )}
          <li>Estimate only. The portal does the actual set-off when you file GSTR-3B; check the figures there.</li>
        </ul>
      </CardContent>
    </Card>
  )
}

function Gstr3b({ data, recon }: { data: any; recon: any }) {
  if (!data || data.error) return <p className="text-sm text-muted-foreground">No 3B figures for this period.</p>
  if (data.not_registered) {
    return <Card><CardContent className="pt-6 text-sm text-muted-foreground">
      This entity isn&apos;t GST registered, so it has no return.
    </CardContent></Card>
  }

  const t31 = data.table_3_1 ?? {}
  const itc = data.table_4_itc ?? {}
  const sum = (o: any) => (Number(o?.cgst ?? 0) + Number(o?.sgst ?? 0) + Number(o?.igst ?? 0))

  return (
    <div className="space-y-4">
      <TaxPayable t31={t31} itc={itc} itc2b={data.itc_2b} />
      <Card className="border-warning/30">
        <CardContent className="pt-6 text-sm">
          <p className="font-medium">These are figures to key in and check against the portal — not to file from.</p>
          <p className="text-muted-foreground mt-1">{data.caveat}</p>
        </CardContent>
      </Card>

      <div>
        <h3 className="text-sm font-medium mb-2">Table 3.1 — Outward supplies and inward reverse charge</h3>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Nature of supply</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Taxable value</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">CGST</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">SGST</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">IGST</th>
              </tr>
            </thead>
            <tbody>
              <TaxRow label="(a) Outward taxable (other than zero-rated, nil, exempt)" v={t31.a_outward_taxable} />
              <TaxRow label="(b) Outward zero-rated" v={t31.b_zero_rated} />
              <TaxRow label="(c) Other outward — nil-rated, exempt" v={t31.c_nil_exempt} />
              <TaxRow label="(d) Inward liable to reverse charge" v={t31.d_inward_reverse_charge} />
              <TaxRow label="(e) Non-GST outward" v={t31.e_non_gst_outward} />
            </tbody>
          </table>
        </div>
        {Number(t31.d_inward_reverse_charge?.import_of_services_taxable ?? 0) === 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            Nothing is recorded under reverse charge. If you pay for foreign advertising or cloud services
            (Google, Meta, AWS), that is an import of service and carries an RCM liability here —
            tag those expenses so they appear.
          </p>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">Table 4 — Input tax credit</h3>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Row</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">CGST</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">SGST</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">IGST</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Total</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['4(A) ITC available — all other', itc['4A_all_other_itc']],
                ['4(B) ITC reversed', itc['4B_reversed']],
                ['4(D) Ineligible', itc['4D_ineligible']],
                ['Not yet claimed (pending)', itc['pending_not_yet_claimed']],
              ].map(([label, v]: any) => (
                <tr key={label} className="border-t">
                  <td className="px-3 py-2">{label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(v?.cgst ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(v?.sgst ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(v?.igst ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(sum(v))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Computed from ITC tagging in this ERP. The portal fills Table 4 from GSTR-2B instead, so these will
          not agree until the purchase register has been reconciled against 2B.
        </p>
      </div>

      {(data.table_3_2_interstate_unregistered ?? []).length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Table 3.2 — Inter-state supplies to unregistered persons</h3>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Place of supply</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Taxable value</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">IGST</th>
                </tr>
              </thead>
              <tbody>
                {data.table_3_2_interstate_unregistered.map((r: any) => (
                  <tr key={r.pos} className="border-t">
                    <td className="px-3 py-2">{r.pos}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.taxable_value)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.igst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {recon && <BooksVsReturn recon={recon} />}
    </div>
  )
}

function BooksVsReturn({ recon }: { recon: any }) {
  const tdiff = Number(recon.taxable_difference ?? 0)
  const t12diff = Number(recon.table_12_difference ?? 0)
  return (
    <div>
      <h3 className="text-sm font-medium mb-2">Books vs return</h3>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Source</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Taxable value</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Tax</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t">
              <td className="px-3 py-2">Sales ledger ({recon.books?.sales ?? 0} taxed sales)</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(recon.books?.taxable_value)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(recon.books?.tax)}</td>
            </tr>
            <tr className="border-t">
              <td className="px-3 py-2">GSTR-1 ({recon.return?.invoices ?? 0} invoices)</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(recon.return?.taxable_value)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(recon.return?.tax)}</td>
            </tr>
            <tr className="border-t bg-muted/40">
              <td className="px-3 py-2 font-medium">Difference</td>
              <td className={`px-3 py-2 text-right tabular-nums font-medium ${Math.abs(tdiff) > 1 ? 'text-destructive' : 'text-success'}`}>
                {formatCurrency(tdiff)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-medium">
                {formatCurrency(recon.tax_difference)}
              </td>
            </tr>
            <tr className="border-t">
              <td className="px-3 py-2">Table 12 (HSN summary)</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(recon.table_12_taxable_value)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${Math.abs(t12diff) > 1 ? 'text-destructive' : 'text-success'}`}>
                {Math.abs(t12diff) > 1 ? `off by ${formatCurrency(t12diff)}` : 'ties'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground mt-2">{recon.note}</p>
    </div>
  )
}

function PeriodsTable({ data }: { data: any }) {
  const rows: any[] = data?.rows ?? []
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No periods.</p>
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Period</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Return</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Due</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Blockers</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">ARN</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Barred in</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const overdue = Number(r.days_overdue ?? 0) > 0 && r.status !== 'filed'
              const barSoon = Number(r.days_until_barred ?? 9999) < 180
              return (
                <tr key={`${r.period_start}-${r.return_type}`} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {new Date(r.period_start).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-3 py-2 uppercase text-xs font-mono">{r.return_type}</td>
                  <td className="px-3 py-2">
                    <Badge variant={r.status === 'filed' ? 'secondary' : overdue ? 'destructive' : 'outline'}>
                      {r.status.replace('_', ' ')}
                    </Badge>
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap ${overdue ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {r.due_date}{overdue ? ` (${r.days_overdue}d late)` : ''}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {Number(r.blockers) > 0
                      ? <span className="text-destructive">{r.blockers}</span>
                      : <span className="text-success">0</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.arn || '—'}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${barSoon ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {Number(r.days_until_barred) > 0 ? `${r.days_until_barred}d` : 'barred'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        A return cannot be filed more than three years past its due date — enforced on the portal since
        1 October 2025, with no late fee or appeal that reopens it, and the liability survives.
      </p>
    </div>
  )
}

const UPLOAD_KINDS = [
  {
    kind: 'zoho_invoices' as const,
    label: 'Zoho invoice register',
    accept: '.csv,text/csv',
    blurb: 'Export your invoice list from Zoho as CSV. Checks that nothing you invoiced is missing from what the ERP would report in GSTR-1 — the failure that under-reports silently instead of being rejected.',
  },
  {
    kind: 'gstr2b' as const,
    label: 'GSTR-2B (portal JSON)',
    accept: '.json,application/json',
    blurb: 'Download GSTR-2B for the period from the GST portal in JSON form. Checks your purchase register against what suppliers actually filed — both credit you are owed and are not taking, and credit 2B does not support.',
  },
]

const BUCKETS: { key: string; label: string; tone: 'ok' | 'warn' | 'bad' }[] = [
  { key: 'missing_in_erp', label: 'In the upload, not in the ERP', tone: 'bad' },
  { key: 'missing_in_source', label: 'In the ERP, not in the upload', tone: 'bad' },
  { key: 'value_mismatch', label: 'Found, figures differ', tone: 'warn' },
  { key: 'matched', label: 'Matched', tone: 'ok' },
]

// A diff entry as a sentence, so "tax_heads: {"source":{...},"erp":{...}}" is readable.
function formatDiff(k: string, v: any): string {
  const money = (n: any) => formatCurrency(Number(n) || 0)
  if (k === 'tax_heads') {
    return 'Tax heads — ' + (['cgst', 'sgst', 'igst'] as const)
      .filter((h) => Math.abs((Number(v?.source?.[h]) || 0) - (Number(v?.erp?.[h]) || 0)) > 1)
      .map((h) => `${h.toUpperCase()}: Zoho ${money(v?.source?.[h])} vs ERP ${money(v?.erp?.[h])}`).join('; ')
  }
  if (k === 'place_of_supply') {
    const name = (c: string) => `${STATE_CODE_TO_NAME[c] ?? c} (${c})`
    return `Place of supply — Zoho ${name(v?.source)} vs ERP ${name(v?.erp)}`
  }
  if (typeof v === 'object' && v && 'source' in v && 'erp' in v) {
    const label = ({ taxable_value: 'Taxable value', doc_value: 'Invoice total', tax: 'Total tax', doc_date: 'Date' } as Record<string, string>)[k] ?? k
    return k === 'doc_date' ? `${label} — Zoho ${v.source} vs ERP ${v.erp}` : `${label} — Zoho ${money(v.source)} vs ERP ${money(v.erp)}`
  }
  if (k === 'erp_voided') return 'Voided in the ERP but live in Zoho'
  return `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`
}

const HEAD_KEYS = ['tax_heads', 'place_of_supply']

function MatchUploads({ entity, from, to, kinds, focus, onChanged }: {
  entity: string; from: string; to: string
  kinds?: ('zoho_invoices' | 'gstr2b')[]
  focus?: 'amount' | 'heads'
  onChanged?: () => void
}) {
  const [imports, setImports] = useState<any[]>([])
  const [active, setActive] = useState<any>(null)
  const [lines, setLines] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const loadImports = useCallback(async () => {
    const r = await apiFetch(`/api/gst/recon?entity=${encodeURIComponent(entity)}`)
    if (r.ok) setImports(await r.json())
  }, [entity])
  const changed = () => { onChanged?.() }

  useEffect(() => { loadImports() }, [loadImports])

  const openImport = async (id: string) => {
    setErr(''); setMsg('')
    const r = await apiFetch(`/api/gst/recon?import_id=${id}`)
    if (!r.ok) { setErr('Could not load that reconciliation.'); return }
    const d = await r.json()
    setActive(d.import); setLines(d.lines ?? [])
  }

  // Lines this step is responsible for: step 1 hides head-only mismatches (step 5 owns them).
  const inFocus = (l: any) => {
    const keys = Object.keys(l.diff ?? {})
    const headOnly = keys.length > 0 && keys.every((k) => HEAD_KEYS.includes(k))
    const hasHead = keys.some((k) => HEAD_KEYS.includes(k))
    if (focus === 'amount') return !(l.match_status === 'value_mismatch' && headOnly)
    if (focus === 'heads') return l.match_status === 'value_mismatch' && hasHead
    return true
  }

  const upload = async (kind: string, file: File) => {
    setBusy(true); setErr(''); setMsg('')
    try {
      const content = await file.text()
      const r = await apiFetch('/api/gst/recon', {
        method: 'POST',
        body: JSON.stringify({
          entity_key: entity, kind, period_start: from, period_end: to,
          content, source_filename: file.name,
        }),
      })
      const d = await r.json()
      if (!r.ok) {
        setErr(d?.error || 'Upload failed')
        return
      }
      setMsg(`Read ${d.rows} rows from ${file.name}.`)
      await loadImports()
      await openImport(d.import.id)
      changed()
    } catch (e: any) {
      setErr(e?.message || 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const resolve = async (lineId: string, resolution: string) => {
    // A resolution with no reason is just a label -- next month (or the next
    // person looking at this) has no way to tell "checked, genuinely fine"
    // from "clicked through to make the warning go away." Required, not
    // optional, since the column already existed but nothing ever asked for it.
    const note = window.prompt(`Why ${resolution.replace(/_/g, ' ')}? (shown next to this row, and kept for audit)`)
    if (note === null) return // cancelled
    if (!note.trim()) { setErr('A reason is required to resolve a row.'); return }
    const r = await apiFetch('/api/gst/recon', {
      method: 'PATCH',
      body: JSON.stringify({ id: lineId, resolution, resolution_note: note.trim() }),
    })
    if (r.ok && active) { await openImport(active.id); changed() }
  }

  // Clearing a resolution needs no reason -- there's nothing left to explain
  // once it's undone (see the PATCH route's own check for the same logic).
  const unresolve = async (lineId: string) => {
    if (!window.confirm('Undo this resolution? The row goes back to unresolved.')) return
    const r = await apiFetch('/api/gst/recon', {
      method: 'PATCH',
      body: JSON.stringify({ id: lineId, resolution: null }),
    })
    if (r.ok && active) { await openImport(active.id); changed() }
  }

  const recheckImport = async (imp: any) => {
    setBusy(true); setErr(''); setMsg('')
    try {
      const r = await apiFetch('/api/gst/recon', {
        method: 'POST',
        body: JSON.stringify({
          entity_key: entity, kind: imp.kind,
          period_start: imp.period_start, period_end: imp.period_end,
          source_import_id: imp.id,
        }),
      })
      const d = await r.json()
      if (!r.ok) { setErr(d?.error || 'Re-check failed'); return }
      setMsg(`Re-checked against current ERP data — ${d.rows} rows.`)
      await loadImports()
      await openImport(d.import.id)
      changed()
    } catch (e: any) {
      setErr(e?.message || 'Re-check failed')
    } finally {
      setBusy(false)
    }
  }

  const deleteImport = async (id: string) => {
    if (!window.confirm('Delete this upload and all its reconciliation rows? This cannot be undone.')) return
    setErr(''); setMsg('')
    const r = await apiFetch(`/api/gst/recon?import_id=${id}`, { method: 'DELETE' })
    if (!r.ok) {
      const d = await r.json().catch(() => null)
      setErr(d?.error || 'Delete failed')
      return
    }
    if (active?.id === id) { setActive(null); setLines([]) }
    setMsg('Upload deleted.')
    await loadImports()
    changed()
  }

  return (
    <div className="space-y-4">
      {err && <ErrorBanner message={err} />}
      {msg && <p className="text-sm text-success">{msg}</p>}

      <div className={`grid gap-4 ${kinds && kinds.length === 1 ? '' : 'md:grid-cols-2'}`}>
        {UPLOAD_KINDS.filter((k) => !kinds || kinds.includes(k.kind)).map((k) => (
          <Card key={k.kind}>
            <CardHeader className="pb-2"><CardTitle className="text-base">{k.label}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">{k.blurb}</p>
              <input
                type="file"
                accept={k.accept}
                disabled={busy}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) upload(k.kind, f)
                  e.target.value = ''
                }}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      {imports.filter((i) => !kinds || kinds.includes(i.kind)).length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Previous uploads</h3>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Period</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Source</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">File</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Rows</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Matched</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Problems</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody>
                {imports.filter((i) => !kinds || kinds.includes(i.kind)).map((i) => {
                  const problems = i.mismatch_count + i.missing_in_erp_count + i.missing_in_source_count
                  return (
                    <tr key={i.id} className="border-t">
                      <td className="px-3 py-2 whitespace-nowrap">{i.period_start}</td>
                      <td className="px-3 py-2">{i.kind === 'gstr2b' ? 'GSTR-2B' : 'Zoho'}</td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{i.source_filename || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{i.row_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-success">{i.matched_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {problems > 0 ? <span className="text-destructive">{problems}</span> : <span className="text-success">0</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex gap-1 justify-end">
                          <Button variant="outline" size="sm" onClick={() => openImport(i.id)}>Open</Button>
                          {i.kind === 'zoho_invoices' && (
                            <Button variant="outline" size="sm" disabled={busy} onClick={() => recheckImport(i)} title="Re-run the match against current ERP data, using the same uploaded rows">
                              Re-check
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => deleteImport(i.id)}>
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {active && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">
            {active.kind === 'gstr2b' ? 'GSTR-2B' : 'Zoho'} · {active.period_start}
            {active.notes && <span className="ml-2 text-xs text-warning">{active.notes}</span>}
          </h3>
          {BUCKETS.map((b) => {
            const rows = lines.filter((l) => l.match_status === b.key && inFocus(l))
            if (rows.length === 0) return null
            return (
              <div key={b.key}>
                <p className={`text-xs font-medium mb-1 ${b.tone === 'bad' ? 'text-destructive' : b.tone === 'warn' ? 'text-warning' : 'text-success'}`}>
                  {b.label} — {rows.length}
                </p>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Document</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Counterparty</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Taxable</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Tax</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Difference</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Decision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 60).map((l) => (
                        <tr key={l.id} className="border-t align-top">
                          <td className="px-3 py-2 whitespace-nowrap">{l.doc_date || '—'}</td>
                          <td className="px-3 py-2 font-mono text-xs">{l.doc_number || '—'}</td>
                          <td className="px-3 py-2">
                            {l.counterparty_name || '—'}
                            {l.counterparty_gstin && <span className="block text-xs text-muted-foreground font-mono">{l.counterparty_gstin}</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(l.taxable_value)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatCurrency((Number(l.cgst) || 0) + (Number(l.sgst) || 0) + (Number(l.igst) || 0))}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground max-w-[22rem]">
                            {l.diff ? Object.entries(l.diff).map(([k, v]: any) => (
                              <span key={k} className="block">{formatDiff(k, v)}</span>
                            )) : '—'}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {l.resolution
                              ? (
                                <div className="flex flex-col items-end gap-0.5">
                                  <button
                                    type="button"
                                    onClick={() => unresolve(l.id)}
                                    title="Click to undo this resolution"
                                    className="cursor-pointer"
                                  >
                                    <Badge variant="secondary" className="hover:bg-destructive/10 hover:text-destructive transition-colors">
                                      {l.resolution.replace(/_/g, ' ')} ×
                                    </Badge>
                                  </button>
                                  {l.resolution_note && (
                                    <span className="text-xs text-muted-foreground max-w-[14rem] text-right">{l.resolution_note}</span>
                                  )}
                                </div>
                              )
                              : (
                                <div className="flex gap-1 justify-end">
                                  {active.kind === 'gstr2b' && l.match_status === 'missing_in_source' && (
                                    <Button size="sm" variant="outline" onClick={() => resolve(l.id, 'chase_supplier')}>Chase</Button>
                                  )}
                                  {active.kind === 'gstr2b' && l.match_status === 'matched' && (
                                    <Button size="sm" variant="outline" onClick={() => resolve(l.id, 'itc_claimed')}>Claim ITC</Button>
                                  )}
                                  <Button size="sm" variant="ghost" onClick={() => resolve(l.id, 'ignored')}>Ignore</Button>
                                </div>
                              )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows.length > 60 && (
                  <p className="text-xs text-muted-foreground mt-1">Showing 60 of {rows.length}.</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const LOCK_MODULES = [
  { key: 'sales', label: 'Sales — invoices, sales, payments' },
  { key: 'purchases', label: 'Purchases — POs, bills, vendor payments' },
  { key: 'banking', label: 'Banking — transactions, transfers' },
  { key: 'accounts', label: 'Accounts — journals, tax entries' },
]

function PeriodLocks({
  entity, from, to, periodLabel, onChanged,
}: {
  entity: string; from: string; to: string; periodLabel: string
  onChanged: () => void
}) {
  const [locks, setLocks] = useState<any[]>([])
  const [lockModule, setLockModule] = useState('sales')
  const [lockThrough, setLockThrough] = useState(to)
  const [lockReason, setLockReason] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const l = await apiFetch('/api/gst/period-locks')
    if (l.ok) setLocks(await l.json())
  }, [entity])

  useEffect(() => { refresh() }, [refresh])

  const setLock = async () => {
    setBusy(true); setErr(''); setMsg('')
    try {
      const r = await apiFetch('/api/gst/period-locks', {
        method: 'POST',
        body: JSON.stringify({
          entity_key: entity, module: lockModule,
          locked_through_date: lockThrough, reason: lockReason || null,
        }),
      })
      const d = await r.json()
      if (!r.ok) { setErr(d?.error || 'Failed'); return }
      setMsg(`${lockModule} locked through ${lockThrough}.`)
      setLockReason(''); await refresh(); onChanged()
    } finally { setBusy(false) }
  }

  const unlock = async (id: string) => {
    const reason = window.prompt('Why are you reopening this period? This is recorded.')
    if (!reason?.trim()) return
    const l = locks.find((x) => x.id === id)
    const r = await apiFetch('/api/gst/period-locks', {
      method: 'PATCH',
      body: JSON.stringify({
        id, unlock_from: from, unlock_to: to, unlock_reason: reason.trim(),
      }),
    })
    if (r.ok) { setMsg(`Reopened ${l?.module} for ${periodLabel}.`); refresh() }
    else setErr((await r.json())?.error || 'Failed')
  }

  const relock = async (id: string) => {
    const r = await apiFetch('/api/gst/period-locks', { method: 'PATCH', body: JSON.stringify({ id }) })
    if (r.ok) { setMsg('Window closed again.'); refresh() }
  }

  return (
    <div className="space-y-5">
      {err && <ErrorBanner message={err} />}
      {msg && <p className="text-sm text-success">{msg}</p>}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Period locks</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Blocks writes by <span className="font-medium">transaction date</span>, not entry date — that is what
            stops a back-dated row landing in a period you have already filed. Drafts stay editable. Currently
            enforced on new sales, voids and invoice finalise.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Module</label>
              <Select value={lockModule} onValueChange={setLockModule}>
                <SelectTrigger className="w-[260px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LOCK_MODULES.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Lock through</label>
              <Input type="date" value={lockThrough} onChange={(e) => setLockThrough(e.target.value)} className="w-[160px]" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Reason</label>
              <Input value={lockReason} onChange={(e) => setLockReason(e.target.value)} placeholder="e.g. GSTR-1 filed" className="w-[220px]" />
            </div>
            <Button disabled={busy} onClick={setLock}>Lock</Button>
          </div>

          {locks.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Module</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Locked through</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Reason</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Open window</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody>
                  {locks.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td className="px-3 py-2">{l.module}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{l.locked_through_date}</td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{l.reason || '—'}</td>
                      <td className="px-3 py-2 text-xs">
                        {l.unlock_from
                          ? <span className="text-warning">{l.unlock_from} → {l.unlock_to}: {l.unlock_reason}</span>
                          : <span className="text-muted-foreground">none</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {l.unlock_from
                          ? <Button size="sm" variant="ghost" onClick={() => relock(l.id)}>Close window</Button>
                          : <Button size="sm" variant="outline" onClick={() => unlock(l.id)}>Reopen {periodLabel}</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

import Papa from 'papaparse'
import type { Heads } from './gst-setoff'

// Reads the portal's Electronic Credit Ledger CSV (Services → Ledgers → Electronic
// Credit Ledger → Excel/CSV). Each row: Sr, Date, Reference, Tax Period ("Oct-26"),
// Description, Credit/Debit, then the movement (IGST, CGST, SGST, Cess, Total) and
// the balance after it (same five columns). Whole rupees, as the portal keeps them.
export interface LedgerRow {
  date: string; ref: string; tax_period: string; description: string
  type: 'credit' | 'debit' | 'balance'
  amount: Heads; balance: Heads
}

export interface LedgerForPeriod {
  gstin: string | null
  opening: Heads          // balance before the period's first entry
  itc_credited: Heads     // "ITC accrued" credits tagged with the period
  utilised: Heads | null  // debits tagged with the period (null until 3B is filed)
  closing: Heads          // balance after the period's last entry
}

const num = (v: any) => Number(String(v ?? '').replace(/,/g, '').trim()) || 0
const heads = (c: any[], at: number): Heads => ({ igst: num(c[at]), cgst: num(c[at + 1]), sgst: num(c[at + 2]) })
const zero = (): Heads => ({ igst: 0, cgst: 0, sgst: 0 })
const add = (a: Heads, b: Heads): Heads => ({ igst: a.igst + b.igst, cgst: a.cgst + b.cgst, sgst: a.sgst + b.sgst })

export function parseCreditLedger(text: string): { gstin: string | null; rows: LedgerRow[] } {
  const { data } = Papa.parse<string[]>(text, { skipEmptyLines: true })
  let gstin: string | null = null
  const rows: LedgerRow[] = []
  for (const raw of data) {
    const c = raw.map((x) => String(x ?? '').trim())
    const gi = c.indexOf('GSTIN')
    if (gi >= 0 && c[gi + 1]) gstin = c[gi + 1]
    const desc = c[4] ?? ''
    const kind = (c[5] ?? '').toLowerCase()
    if (/opening balance|closing balance/i.test(desc)) {
      rows.push({ date: '', ref: '', tax_period: '', description: desc, type: 'balance', amount: zero(), balance: heads(c, 11) })
    } else if (kind === 'credit' || kind === 'debit') {
      rows.push({ date: c[1], ref: c[2], tax_period: c[3], description: desc, type: kind, amount: heads(c, 6), balance: heads(c, 11) })
    }
  }
  if (rows.length === 0) throw new Error('No ledger rows found. Download the Electronic Credit Ledger from the portal as CSV/Excel and upload that file.')
  return { gstin, rows }
}

/** "2026-10-01" -> "Oct-26", the portal's tax-period label. */
export function ledgerPeriodLabel(periodFrom: string): string {
  const [y, m] = periodFrom.split('-').map(Number)
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}-${String(y).slice(2)}`
}

export function ledgerForPeriod(parsed: { gstin: string | null; rows: LedgerRow[] }, periodFrom: string): LedgerForPeriod | null {
  const label = ledgerPeriodLabel(periodFrom)
  const { rows } = parsed
  const first = rows.findIndex((r) => r.type !== 'balance' && r.tax_period === label)
  const last = rows.map((r) => r.type !== 'balance' && r.tax_period === label).lastIndexOf(true)
  // No entry for the month yet (its 3B not filed): opening is the latest balance in the file.
  const closingRow = [...rows].reverse().find((r) => r.type === 'balance' || r.type === 'credit' || r.type === 'debit')
  if (first < 0) {
    if (!closingRow) return null
    return { gstin: parsed.gstin, opening: closingRow.balance, itc_credited: zero(), utilised: null, closing: closingRow.balance }
  }
  const opening = first > 0 ? rows[first - 1].balance : zero()
  let itc = zero(), used = zero(), anyDebit = false
  for (const r of rows.slice(first, last + 1)) {
    if (r.tax_period !== label) continue
    if (r.type === 'credit') itc = add(itc, r.amount)
    if (r.type === 'debit') { used = add(used, r.amount); anyDebit = true }
  }
  return { gstin: parsed.gstin, opening, itc_credited: itc, utilised: anyDebit ? used : null, closing: rows[last].balance }
}

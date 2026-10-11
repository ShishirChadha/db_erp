// Compares Zoho Books' "Summary of Outward Supplies (GSTR-1)" Excel export with what the ERP
// would file (gst_r1_sections / gst_r1_hsn_summary / gst_r1_docs_issued). Pure functions, no
// AI and no database: the route feeds in the parsed sheets and the ERP payloads.
import * as XLSX from 'xlsx'
import type { ZohoItemLine } from './gst-zoho-matcher'

export type Severity = 'blocker' | 'warning'
// Per-invoice HSN comparison, possible once the Zoho invoice CSV (step 1) has been read with its item lines.
export interface HsnInvoice {
  invoice_number: string
  zoho_lines: { item: string; taxable: number; hsn: string }[]
  erp_lines: { line_id: string; item: string; hsn: string; taxable: number; category: string | null; rule: string | null; bundled_into: string | null; inline: { accessory_id: string; item: string; hsn: string | null; qty: number }[]; siblings: { line_id: string; item: string; taxable: number }[] }[]
}
export interface SummaryRow {
  key: string; label: string
  zoho_count: number | null; erp_count: number | null
  zoho_taxable: number | null; erp_taxable: number | null
  zoho_tax: number | null; erp_tax: number | null
  status: 'match' | 'mismatch'
}
export interface IssueRow {
  severity: Severity; section: string; ref: string; problem: string
  zoho: string; erp: string; fix: string
  invoice_number?: string | null
  // HSN rows: the ERP invoices carrying this code, and what the category rule says it should be.
  invoices?: { line_id: string; number: string; item: string; hsn: string; taxable: number; category: string | null; rule: string | null; bundled_into: string | null; zoho_hsn: string | null; siblings: { line_id: string; item: string; taxable: number }[] }[]
  suggested?: string | null
}
// One ERP outward line (from v_gst_outward_lines) with its SKU category and that category's default HSN.
export interface ErpLine { line_id: string; invoice_number: string; hsn: string; is_b2b: boolean; item: string; taxable: number; category: string | null; rule: string | null; bundled_into: string | null; inline?: { accessory_id: string; item: string; hsn: string | null; qty: number }[] }
export interface ZohoGstr1 {
  b2b: { inum: string; ctin: string; name: string; date: string; value: number; pos: string; taxable: number }[]
  b2cl: { inum: string; taxable: number }[]
  b2cs: { pos: string; rate: number; taxable: number }[]
  cdn_count: number
  hsn_b2b: HsnRow[]; hsn_b2c: HsnRow[]
  docs: { from: string; to: string; total: number; cancelled: number } | null
}
export interface HsnRow { hsn: string; descr: string; qty: number; taxable: number; igst: number; cgst: number; sgst: number }

const TOL = 2 // Zoho rounds per line; a couple of rupees is rounding, not a filing difference
const num = (v: unknown) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0 }
const r2 = (n: number) => Math.round(n * 100) / 100
const posCode = (s: unknown) => String(s ?? '').trim().slice(0, 2)

function rowsOf(wb: XLSX.WorkBook, name: string): unknown[][] {
  const ws = wb.Sheets[name]
  return ws ? (XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as unknown[][]) : []
}
// Data starts after the header row whose first cell is `first`.
function dataAfter(rows: unknown[][], first: string): unknown[][] {
  const i = rows.findIndex((r) => String(r[0] ?? '').trim() === first)
  return i < 0 ? [] : rows.slice(i + 1).filter((r) => r.some((c) => String(c).trim() !== ''))
}

export function parseZohoGstr1(buf: Buffer): ZohoGstr1 {
  const wb = XLSX.read(buf, { type: 'buffer' })
  if (!wb.Sheets['b2b'] || !wb.Sheets['hsn(b2b)']) {
    throw new Error('This does not look like the Zoho "Summary of Outward Supplies (GSTR-1)" Excel export (b2b / hsn(b2b) sheets not found).')
  }
  const b2bByInv = new Map<string, ZohoGstr1['b2b'][number]>()
  for (const r of dataAfter(rowsOf(wb, 'b2b'), 'GSTIN/UIN of Recipient')) {
    const inum = String(r[2]).trim()
    const cur = b2bByInv.get(inum)
    if (cur) cur.taxable += num(r[11])
    else b2bByInv.set(inum, { inum, ctin: String(r[0]).trim(), name: String(r[1]).trim(), date: String(r[3]), value: num(r[4]), pos: posCode(r[5]), taxable: num(r[11]) })
  }
  const hsn = (sheet: string): HsnRow[] =>
    dataAfter(rowsOf(wb, sheet), 'HSN').map((r) => ({
      hsn: String(r[0]).trim(), descr: String(r[1]).trim().split('\n')[0], qty: num(r[3]),
      taxable: num(r[6]), igst: num(r[7]), cgst: num(r[8]), sgst: num(r[9]),
    }))
  const docRow = dataAfter(rowsOf(wb, 'docs'), 'Nature of Document')[0]
  return {
    b2b: [...b2bByInv.values()],
    b2cl: dataAfter(rowsOf(wb, 'b2cl'), 'Invoice Number').map((r) => ({ inum: String(r[0]), taxable: num(r[6]) })),
    b2cs: dataAfter(rowsOf(wb, 'b2cs'), 'Type').map((r) => ({ pos: posCode(r[1]), rate: num(r[3]), taxable: num(r[4]) })),
    cdn_count: dataAfter(rowsOf(wb, 'cdnr'), 'GSTIN/UIN of Recipient').length + dataAfter(rowsOf(wb, 'cdnur'), 'UR Type').length,
    hsn_b2b: hsn('hsn(b2b)'), hsn_b2c: hsn('hsn(b2c)'),
    docs: docRow ? { from: String(docRow[1]), to: String(docRow[2]), total: num(docRow[3]), cancelled: num(docRow[4]) } : null,
  }
}

interface ErpInvoiceInfo { id: string; customer_gst: string | null; customer_name: string | null }

export function compareGstr1(z: ZohoGstr1, erpSections: any, erpHsn: any, erpDocs: any, erpInvoices: Map<string, ErpInvoiceInfo>, erpLines: ErpLine[] = [], zohoLines: Map<string, ZohoItemLine[]> | null = null) {
  const issues: IssueRow[] = []
  const sum = (a: number[]) => r2(a.reduce((x, y) => x + y, 0))

  // ---- B2B (Table 4), per invoice. An invoice can span several ERP rows (one per rate).
  const erpB2b = new Map<string, { ctin: string; pos: string; value: number; taxable: number }>()
  for (const x of erpSections?.b2b ?? []) {
    const c = erpB2b.get(x.inum) ?? { ctin: x.ctin, pos: String(x.pos), value: Number(x.val), taxable: 0 }
    c.taxable += Number(x.txval); erpB2b.set(x.inum, c)
  }
  const zb2b = new Map(z.b2b.map((x) => [x.inum, x]))
  for (const [inum, zi] of zb2b) {
    const ei = erpB2b.get(inum)
    if (!ei) {
      const inv = erpInvoices.get(inum)
      issues.push({
        severity: 'blocker', section: 'B2B', ref: inum, invoice_number: inum,
        problem: inv ? 'In Zoho as B2B, but the ERP does not file it as B2B' : 'In Zoho but not in the ERP at all',
        zoho: `${zi.name || 'customer'} · GSTIN ${zi.ctin} · ₹${r2(zi.taxable).toLocaleString('en-IN')} taxable`,
        erp: inv ? `Filed as B2C — customer "${inv.customer_name ?? '?'}" has ${inv.customer_gst ? 'GSTIN ' + inv.customer_gst : 'no GSTIN recorded'}` : 'No invoice with this number',
        fix: inv
          ? `Confirm the buyer's GSTIN (Zoho shows ${zi.ctin}${zi.name ? ' for ' + zi.name : ''}); if right, add it to the customer in the ERP, otherwise correct the Zoho invoice.`
          : 'Record this invoice in the ERP (Sales → Record Zoho invoice).',
      })
      continue
    }
    if (ei.ctin !== zi.ctin) issues.push({ severity: 'blocker', section: 'B2B', ref: inum, invoice_number: inum, problem: 'Customer GSTIN differs', zoho: zi.ctin, erp: ei.ctin, fix: 'Correct the GSTIN on whichever side is wrong.' })
    if (ei.pos !== zi.pos) issues.push({ severity: 'blocker', section: 'B2B', ref: inum, invoice_number: inum, problem: 'Place of supply differs', zoho: zi.pos, erp: ei.pos, fix: 'Edit the place of supply on the invoice so CGST/SGST vs IGST is right.' })
    if (Math.abs(ei.taxable - zi.taxable) > TOL) issues.push({ severity: 'blocker', section: 'B2B', ref: inum, invoice_number: inum, problem: 'Taxable value differs', zoho: `₹${r2(zi.taxable)}`, erp: `₹${r2(ei.taxable)}`, fix: 'Open the invoice and compare the line amounts with Zoho.' })
    else if (Math.abs(ei.value - zi.value) > TOL) issues.push({ severity: 'warning', section: 'B2B', ref: inum, invoice_number: inum, problem: 'Invoice total differs (rounding)', zoho: `₹${zi.value}`, erp: `₹${ei.value}`, fix: 'Usually Zoho rounding; no action unless the amount is large.' })
  }
  for (const [inum, ei] of erpB2b) {
    if (!zb2b.has(inum)) issues.push({ severity: 'blocker', section: 'B2B', ref: inum, invoice_number: inum, problem: 'In the ERP as B2B but not in Zoho B2B', zoho: '—', erp: `${ei.ctin} · ₹${r2(ei.taxable)} taxable`, fix: 'Check the invoice exists in Zoho for this month and has the customer GSTIN.' })
  }

  // ---- B2C Small (Table 7), by place of supply + rate
  const bucket = (pos: string, rate: number) => `${pos}|${rate}`
  const eb2cs = new Map<string, number>(), zb2cs = new Map<string, number>()
  for (const x of erpSections?.b2cs ?? []) eb2cs.set(bucket(String(x.pos), Number(x.rt)), (eb2cs.get(bucket(String(x.pos), Number(x.rt))) ?? 0) + Number(x.txval))
  for (const x of z.b2cs) zb2cs.set(bucket(x.pos, x.rate), (zb2cs.get(bucket(x.pos, x.rate)) ?? 0) + x.taxable)
  for (const k of new Set([...eb2cs.keys(), ...zb2cs.keys()])) {
    const zv = zb2cs.get(k) ?? 0, ev = eb2cs.get(k) ?? 0
    if (Math.abs(zv - ev) > TOL) {
      const [pos, rate] = k.split('|')
      issues.push({ severity: 'blocker', section: 'B2C small', ref: `State ${pos} @ ${rate}%`, problem: 'Taxable value differs', zoho: `₹${r2(zv)}`, erp: `₹${r2(ev)}`, fix: 'Usually follows from the B2B rows above (an invoice filed as B2B on one side, B2C on the other). Fix those first, then re-upload.' })
    }
  }

  // ---- HSN (Table 12), grouped by code
  const hsnIssues = (section: string, isB2b: boolean, zrows: HsnRow[], erpRows: any[]) => {
    const zg = new Map<string, HsnRow>(), eg = new Map<string, HsnRow>()
    const add = (m: Map<string, HsnRow>, h: HsnRow) => {
      const c = m.get(h.hsn) ?? { hsn: h.hsn, descr: h.descr, qty: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 }
      c.qty += h.qty; c.taxable += h.taxable; c.igst += h.igst; c.cgst += h.cgst; c.sgst += h.sgst; m.set(h.hsn, c)
    }
    zrows.forEach((h) => add(zg, h))
    erpRows.forEach((x) => add(eg, { hsn: String(x.hsn_sc), descr: String(x.descr ?? ''), qty: Number(x.qty), taxable: Number(x.txval), igst: Number(x.iamt), cgst: Number(x.camt), sgst: Number(x.samt) }))
    const money = (h?: HsnRow) => h ? `₹${r2(h.taxable)} taxable · qty ${h.qty}${h.descr ? ' · ' + h.descr.slice(0, 40) : ''}` : '— not on this side'
    const lines = erpLines.filter((l) => l.is_b2b === isB2b)
    const linesFor = (code: string) => lines.filter((l) => l.hsn === code)
    // zohoHsn is only known when Zoho's code has the same value as this ERP code (Zoho's summary has no per-invoice HSN).
    const toInv = (ls: ErpLine[], zohoHsn: string | null = null) => ls.map((l) => ({
      line_id: l.line_id, number: l.invoice_number, item: l.item, hsn: l.hsn, taxable: l.taxable, category: l.category, rule: l.rule, bundled_into: l.bundled_into, zoho_hsn: zohoHsn,
      // Other un-bundled lines of the same invoice this line could be folded into.
      siblings: erpLines.filter((o) => o.invoice_number === l.invoice_number && o.line_id !== l.line_id && !o.bundled_into)
        .map((o) => ({ line_id: o.line_id, item: o.item, taxable: o.taxable })),
    }))
    // The category rule (sku_category_templates.default_hsn_code) is the owner's own HSN lookup.
    const verdict = (code: string, ls: ErpLine[], zohoCode: string | null) => {
      const rules = [...new Set(ls.map((l) => l.rule).filter(Boolean))] as string[]
      const cats = [...new Set(ls.map((l) => l.category).filter(Boolean))].join('/')
      if (!ls.length) return { suggested: null as string | null, fix: 'Zoho has this code but no ERP line carries it, so it cannot be traced from Zoho\'s summary. Filter the Zoho invoices by this HSN to find them, then fix whichever side is wrong.' }
      if (!rules.length) return { suggested: null, fix: `No default HSN is set for category ${cats || '(none)'} in Settings → SKU Categories, so there is no rule to follow. Decide the correct code, then make Zoho and the ERP agree.` }
      if (rules.length === 1 && rules[0] === code) {
        return { suggested: code, fix: `The ERP follows your ${cats} rule (${code}). ${zohoCode ? `Zoho files these under ${zohoCode}. ` : 'Zoho files them under a different code. '}Fix the Zoho item or invoice, then upload the Excel again. If Zoho is actually right, change the ${cats} default or the SKU in the ERP instead.` }
      }
      return { suggested: rules[0], fix: `Your ${cats} rule says ${rules.join(' / ')} but the ERP lines carry ${code}. Correct the ERP SKU or invoice line to ${rules[0]} (unless the Zoho code is the right one for this item), then compare again.` }
    }
    const zOnly = [...zg.keys()].filter((c) => !eg.has(c))
    const eOnly = [...eg.keys()].filter((c) => !zg.has(c))
    // Pair a Zoho-only code with an ERP-only code of the same value: that is the same goods filed differently.
    const pairedTo = (code: string, fromZoho: boolean) => {
      const own = (fromZoho ? zg : eg).get(code)!
      const others = fromZoho ? eOnly : zOnly
      return others.find((o) => Math.abs((fromZoho ? eg : zg).get(o)!.taxable - own.taxable) <= 1.5) ?? null
    }
    for (const code of new Set([...zg.keys(), ...eg.keys()])) {
      const zh = zg.get(code), eh = eg.get(code)
      if (!zh || !eh) {
        // A free item (₹0 taxable, no tax) only moves the quantity column, not any rupee figure.
        const only = (zh ?? eh)!
        const zeroValue = Math.abs(only.taxable) <= TOL && Math.abs(only.igst + only.cgst + only.sgst) <= TOL
        const mate = pairedTo(code, !!zh)
        // A Zoho-only code that mirrors an ERP-only code of the same value is the same goods seen
        // from the other side; the ERP-only row (which has the invoices) reports it once.
        if (zh && mate && !zeroValue) continue
        const ls = zh ? [] : linesFor(code)
        const v = verdict(code, ls, zh ? null : mate)
        issues.push({
          severity: zeroValue ? 'warning' : 'blocker', section, ref: `HSN ${code}`,
          problem: `HSN code only on the ${zh ? 'Zoho' : 'ERP'} side${mate ? ` — Zoho files the same value under ${mate}` : ''}`,
          zoho: money(zh), erp: money(eh), invoices: toInv(ls, zh ? null : mate),
          suggested: v.suggested,
          fix: v.fix,
        })
      } else if (Math.abs(zh.taxable - eh.taxable) > TOL || Math.abs((zh.igst + zh.cgst + zh.sgst) - (eh.igst + eh.cgst + eh.sgst)) > TOL) {
        issues.push({
          severity: 'blocker', section, ref: `HSN ${code}`,
          problem: `Taxable value or tax differs for this code (Zoho ${zh.taxable > eh.taxable ? 'higher' : 'lower'} by ₹${r2(Math.abs(zh.taxable - eh.taxable))})`,
          zoho: money(zh), erp: money(eh),
          fix: 'Follows from the other HSN rows: some goods are filed under a different code on one side. Fix those rows first, then upload again; if a difference remains, the same items carry different values or splits in Zoho and the ERP.',
        })
      }
    }
  }
  // With Zoho's own item lines available the per-invoice comparison below replaces the code-level guesswork.
  const useInvoiceLines = !!zohoLines && zohoLines.size > 0
  if (!useInvoiceLines) hsnIssues('HSN (B2B)', true, z.hsn_b2b, erpHsn?.hsn_b2b ?? [])
  if (!useInvoiceLines) hsnIssues('HSN (B2C)', false, z.hsn_b2c, erpHsn?.hsn_b2c ?? [])

  // ---- HSN per invoice, from Zoho's own item lines
  const hsnInvoices: HsnInvoice[] = []
  if (useInvoiceLines) {
    const byInv = new Map<string, ErpLine[]>()
    for (const l of erpLines) byInv.set(l.invoice_number, [...(byInv.get(l.invoice_number) ?? []), l])
    for (const [inum, els] of byInv) {
      const zl = zohoLines!.get(inum)
      if (!zl || zl.length === 0) continue
      const zsum = new Map<string, number>(), esum = new Map<string, number>()
      for (const z of zl) {
        const t = r2((z.qty ?? 0) * (z.rate ?? 0))
        if (z.hsn && Math.abs(t) > TOL) zsum.set(z.hsn, (zsum.get(z.hsn) ?? 0) + t)
      }
      for (const e of els) if (Math.abs(e.taxable) > TOL) esum.set(e.hsn, (esum.get(e.hsn) ?? 0) + e.taxable)
      const differs = [...new Set([...zsum.keys(), ...esum.keys()])].some((c) => Math.abs((zsum.get(c) ?? 0) - (esum.get(c) ?? 0)) > TOL)
      if (!differs) continue
      hsnInvoices.push({
        invoice_number: inum,
        zoho_lines: zl.filter((z) => z.hsn).map((z) => ({ item: z.item.split('\n')[0].slice(0, 50), taxable: r2((z.qty ?? 0) * (z.rate ?? 0)), hsn: z.hsn as string })),
        erp_lines: els.map((e) => ({
          line_id: e.line_id, item: e.item, hsn: e.hsn, taxable: e.taxable, category: e.category, rule: e.rule, bundled_into: e.bundled_into, inline: e.inline ?? [],
          siblings: els.filter((o) => o.line_id !== e.line_id && !o.bundled_into).map((o) => ({ line_id: o.line_id, item: o.item, taxable: o.taxable })),
        })),
      })
    }
    hsnInvoices.sort((a, b) => a.invoice_number.localeCompare(b.invoice_number))
  }

  // ---- Table 13 documents
  const ed = (erpDocs?.doc_det ?? [])[0]
  if (z.docs && ed) {
    if (z.docs.total !== Number(ed.totnum) || z.docs.cancelled !== Number(ed.cancel) || z.docs.from !== ed.from || z.docs.to !== ed.to) {
      issues.push({ severity: 'blocker', section: 'Documents', ref: 'Table 13', problem: 'Invoice series differs', zoho: `${z.docs.from} → ${z.docs.to} · ${z.docs.total} issued · ${z.docs.cancelled} cancelled`, erp: `${ed.from} → ${ed.to} · ${ed.totnum} issued · ${ed.cancel} cancelled`, fix: 'Check for a missing, extra or cancelled invoice number (see step 4).' })
    }
  }

  // ---- Summary
  const erpHsnTax = (rows: any[]) => sum(rows.map((x) => Number(x.iamt) + Number(x.camt) + Number(x.samt)))
  const zHsnTax = (rows: HsnRow[]) => sum(rows.map((x) => x.igst + x.cgst + x.sgst))
  const row = (key: string, label: string, zc: number | null, ec: number | null, zt: number | null, et: number | null, ztax: number | null, etax: number | null): SummaryRow => ({
    key, label, zoho_count: zc, erp_count: ec, zoho_taxable: zt, erp_taxable: et, zoho_tax: ztax, erp_tax: etax,
    status: (zc === ec || zc == null || ec == null) && Math.abs((zt ?? 0) - (et ?? 0)) <= TOL && Math.abs((ztax ?? 0) - (etax ?? 0)) <= TOL ? 'match' : 'mismatch',
  })
  const eb2bRows: any[] = erpSections?.b2b ?? [], eb2csRows: any[] = erpSections?.b2cs ?? [], eb2clRows: any[] = erpSections?.b2cl ?? []
  const summary: SummaryRow[] = [
    row('b2b', 'B2B — registered buyers (4)', z.b2b.length, erpB2b.size, sum(z.b2b.map((x) => x.taxable)), sum(eb2bRows.map((x) => Number(x.txval))), null, null),
    row('b2cl', 'B2C large (5)', z.b2cl.length, eb2clRows.length, sum(z.b2cl.map((x) => x.taxable)), sum(eb2clRows.map((x) => Number(x.txval))), null, null),
    row('b2cs', 'B2C small (7)', null, null, sum(z.b2cs.map((x) => x.taxable)), sum(eb2csRows.map((x) => Number(x.txval))), null, null),
    row('cdn', 'Credit / debit notes (9B)', z.cdn_count, (erpSections?.cdnr?.length ?? 0) + (erpSections?.cdnur?.length ?? 0), null, null, null, null),
    row('hsn_b2b', 'HSN summary — B2B (12)', null, null, sum(z.hsn_b2b.map((x) => x.taxable)), sum((erpHsn?.hsn_b2b ?? []).map((x: any) => Number(x.txval))), zHsnTax(z.hsn_b2b), erpHsnTax(erpHsn?.hsn_b2b ?? [])),
    row('hsn_b2c', 'HSN summary — B2C (12)', null, null, sum(z.hsn_b2c.map((x) => x.taxable)), sum((erpHsn?.hsn_b2c ?? []).map((x: any) => Number(x.txval))), zHsnTax(z.hsn_b2c), erpHsnTax(erpHsn?.hsn_b2c ?? [])),
    row('docs', 'Invoices issued (13)', z.docs?.total ?? null, ed ? Number(ed.totnum) : null, null, null, null, null),
  ]
  issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'blocker' ? -1 : 1))
  return { summary, issues, hsn_invoices: hsnInvoices, hsn_from_zoho_lines: useInvoiceLines }
}

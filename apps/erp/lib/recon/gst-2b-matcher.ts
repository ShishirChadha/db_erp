import { supabaseAdmin } from '@/lib/supabase/service'
import { docNumberKey, docNumberSeq, withinTolerance, dayGap } from './gst-doc-key'
import type { ReconLine } from './gst-zoho-matcher'

/**
 * GSTR-2B vs the purchase register.
 *
 * Two different kinds of money, in opposite directions:
 *   missing_in_erp    -- a supplier filed it and we never booked the purchase.
 *                        That is input credit we are entitled to and are not
 *                        taking. Money left on the table.
 *   missing_in_source -- we hold a purchase the supplier has not filed. Claiming
 *                        that credit is what Rule 88D / DRC-01C polices, since
 *                        3B ITC exceeding 2B beyond a threshold triggers an
 *                        automated intimation.
 *
 * Match key is (supplier GSTIN, document number, date within a window) with an
 * amount tolerance -- Zoho's implied key, but stated explicitly with BUSY's
 * knobs rather than hidden.
 */

// Suppliers routinely enter their own invoice date a day or two off from what
// is on the paper, so an exact date match rejects genuine matches.
const DATE_WINDOW_DAYS = 5
// Rounding differs between systems on a per-line vs per-invoice basis.
const AMOUNT_TOLERANCE = 2.0

export interface Gstr2bRow {
  counterparty_gstin: string | null
  counterparty_name?: string | null
  doc_number: string
  doc_date: string | null
  taxable_value?: number | null
  cgst?: number | null
  sgst?: number | null
  igst?: number | null
  cess?: number | null
  doc_value?: number | null
  raw?: any
}

/**
 * Parses the portal's GSTR-2B JSON download.
 *
 * Only the B2B section is read. Credit notes (cdnr) and amendments are
 * deliberately left out for now: they net against credit rather than granting
 * it, and getting that wrong would overstate ITC, which is the direction that
 * attracts an intimation. Better absent than wrong.
 */
export function parseGstr2bJson(payload: any): Gstr2bRow[] {
  const out: Gstr2bRow[] = []
  const data = payload?.data ?? payload?.docdata ?? payload
  const b2b = data?.b2b ?? []
  for (const supplier of b2b) {
    const gstin = supplier?.ctin ?? null
    const name = supplier?.trdnm ?? supplier?.cfs ?? null
    for (const inv of supplier?.inv ?? []) {
      const items = inv?.items ?? inv?.itms ?? []
      // 2B gives per-rate lines; ITC is claimed per invoice, so they sum up.
      let txval = 0, cgst = 0, sgst = 0, igst = 0, cess = 0
      for (const it of items) {
        const d = it?.itm_det ?? it
        txval += Number(d?.txval) || 0
        cgst += Number(d?.camt) || 0
        sgst += Number(d?.samt) || 0
        igst += Number(d?.iamt) || 0
        cess += Number(d?.csamt) || 0
      }
      out.push({
        counterparty_gstin: gstin,
        counterparty_name: name,
        doc_number: inv?.inum ?? '',
        doc_date: toIso(inv?.dt),
        taxable_value: txval, cgst, sgst, igst, cess,
        doc_value: Number(inv?.val) || null,
        raw: { supplier_gstin: gstin, inv },
      })
    }
  }
  return out
}

/** The portal writes dates DD-MM-YYYY; Postgres wants YYYY-MM-DD. */
function toIso(v: any): string | null {
  const s = String(v ?? '').trim()
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

export async function matchGstr2b(
  entityKey: string,
  periodStart: string,
  periodEnd: string,
  rows: Gstr2bRow[]
): Promise<ReconLine[]> {
  // The purchase register, keyed on the vendor's own invoice where we have it.
  // vendor_invoice_date is the ITC period, so the window is applied to that and
  // only falls back to po_date for legacy rows that never captured one.
  const { data: pos, error } = await supabaseAdmin
    .from('purchase_orders')
    .select(`id, po_number, po_date, vendor_invoice_number, vendor_invoice_date,
             total_amount, gst_total, grand_total, is_deleted, purchased_by_type,
             vendors ( id, company_name, gst_number )`)
    .or(`vendor_invoice_date.gte.${periodStart},po_date.gte.${periodStart}`)
    .lte('po_date', periodEnd)
  if (error) throw new Error(`Could not load purchase orders: ${error.message}`)

  const candidates = (pos ?? []).filter((po: any) => {
    if (po.is_deleted) return false
    const key = (po.purchased_by_type || '').trim().toLowerCase()
    const resolved = ['digitalbluez', 'techtenth', 'cash'].includes(key) ? key : 'digitalbluez'
    return resolved === entityKey
  })

  const out: ReconLine[] = []
  const consumed = new Set<string>()

  for (const r of rows) {
    const srcKey = docNumberKey(r.doc_number)
    const srcSeq = docNumberSeq(r.doc_number)
    const srcGstin = (r.counterparty_gstin || '').trim().toUpperCase()

    const po = candidates.find((p: any) => {
      const v: any = Array.isArray(p.vendors) ? p.vendors[0] : p.vendors
      const poGstin = (v?.gst_number || '').trim().toUpperCase()
      // Supplier GSTIN must agree when both sides have one -- it is the only
      // field neither party can restate.
      if (srcGstin && poGstin && srcGstin !== poGstin) return false
      if (consumed.has(p.id)) return false

      const poNum = p.vendor_invoice_number
      if (poNum) {
        const k = docNumberKey(poNum)
        if (k && k === srcKey) return true
        const s = docNumberSeq(poNum)
        if (srcSeq != null && s === srcSeq && !!srcGstin && srcGstin === poGstin) return true
        return false
      }
      // No vendor invoice number recorded: fall back to GSTIN + date window +
      // amount, which is weaker but recovers the legacy rows.
      if (!srcGstin || !poGstin || srcGstin !== poGstin) return false
      const gap = dayGap(r.doc_date, p.vendor_invoice_date || p.po_date)
      if (gap == null || gap > DATE_WINDOW_DAYS) return false
      return withinTolerance(r.doc_value ?? 0, p.grand_total, AMOUNT_TOLERANCE * 5)
    })

    const base: ReconLine = {
      doc_number: r.doc_number ?? null,
      doc_number_key: srcKey || null,
      doc_date: r.doc_date ?? null,
      counterparty_gstin: r.counterparty_gstin ?? null,
      counterparty_name: r.counterparty_name ?? null,
      taxable_value: r.taxable_value ?? null,
      cgst: r.cgst ?? null, sgst: r.sgst ?? null, igst: r.igst ?? null, cess: r.cess ?? null,
      doc_value: r.doc_value ?? null,
      match_status: 'missing_in_erp',
      matched_type: null, matched_id: null, diff: null,
      raw: r.raw ?? r,
    }

    if (!po) { out.push(base); continue }

    consumed.add(po.id)
    const diffs: Record<string, any> = {}
    if (r.taxable_value != null && !withinTolerance(r.taxable_value, po.total_amount, AMOUNT_TOLERANCE)) {
      diffs.taxable_value = { portal: Number(r.taxable_value), erp: Number(po.total_amount) }
    }
    const srcTax = (Number(r.cgst) || 0) + (Number(r.sgst) || 0) + (Number(r.igst) || 0)
    if (!withinTolerance(srcTax, po.gst_total, AMOUNT_TOLERANCE)) {
      diffs.tax = { portal: srcTax, erp: Number(po.gst_total) }
    }
    const gap = dayGap(r.doc_date, po.vendor_invoice_date || po.po_date)
    if (gap != null && gap > 0) {
      diffs.doc_date = { portal: r.doc_date, erp: po.vendor_invoice_date || po.po_date, days_apart: gap }
    }
    if (!po.vendor_invoice_number) diffs.erp_missing_vendor_invoice_number = true

    out.push({
      ...base,
      match_status: Object.keys(diffs).length > 0 ? 'value_mismatch' : 'matched',
      matched_type: 'purchase_order',
      matched_id: po.id,
      diff: Object.keys(diffs).length > 0 ? diffs : null,
    })
  }

  // Purchases carrying tax that 2B does not support. Only those with tax are
  // worth reporting -- a zero-tax purchase claims no credit, so its absence
  // from 2B is expected, not a finding.
  for (const po of candidates) {
    if (consumed.has(po.id)) continue
    if (!(Number(po.gst_total) > 0)) continue
    const v: any = Array.isArray(po.vendors) ? po.vendors[0] : po.vendors
    out.push({
      doc_number: po.vendor_invoice_number || po.po_number,
      doc_number_key: docNumberKey(po.vendor_invoice_number || po.po_number),
      doc_date: po.vendor_invoice_date || po.po_date,
      counterparty_gstin: v?.gst_number ?? null,
      counterparty_name: v?.company_name ?? null,
      taxable_value: po.total_amount, cgst: null, sgst: null, igst: null, cess: null,
      doc_value: po.grand_total,
      match_status: 'missing_in_source',
      matched_type: 'purchase_order', matched_id: po.id,
      diff: {
        claimed_tax: Number(po.gst_total),
        note: 'Not in GSTR-2B. Either the supplier has not filed, or the invoice details here do not match theirs. Claiming credit that 2B does not support is what Rule 88D polices.',
      },
      raw: null,
    })
  }

  return out
}

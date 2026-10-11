import { supabaseAdmin } from '@/lib/supabase/service'
import { docNumberKey, docNumberSeq, withinTolerance } from './gst-doc-key'
import { normalizePlaceOfSupply } from './gst-pos'

/**
 * Zoho invoice register vs the ERP's invoices.
 *
 * Answers one question: is anything we invoiced missing from what the ERP
 * would report in GSTR-1? That is the failure mode that matters most, because
 * a missing invoice does not get rejected at the portal -- it silently
 * under-reports, and nothing flags it.
 *
 * Deterministic matching only, no AI, matching the posture of
 * lib/recon/credit-matcher.ts and purchase-matcher.ts.
 */

// A rupee of rounding is noise; anything more is a real disagreement about what
// was charged.
const AMOUNT_TOLERANCE = 1.0

export interface ZohoInvoiceRow {
  doc_number: string
  doc_date: string | null
  counterparty_name?: string | null
  counterparty_gstin?: string | null
  taxable_value?: number | null
  cgst?: number | null
  sgst?: number | null
  igst?: number | null
  cess?: number | null
  doc_value?: number | null
  place_of_supply?: string | null
  // The item lines Zoho printed on the invoice (one CSV row each), so the GST page can show the HSN
  // Zoho used per line. Optional: an upload read before this existed has none.
  lines?: ZohoItemLine[]
  raw?: any
}
export interface ZohoItemLine { item: string; qty: number | null; rate: number | null; hsn: string | null }

export interface ReconLine {
  doc_number: string | null
  doc_number_key: string | null
  doc_date: string | null
  counterparty_gstin: string | null
  counterparty_name: string | null
  taxable_value: number | null
  cgst: number | null
  sgst: number | null
  igst: number | null
  cess: number | null
  doc_value: number | null
  place_of_supply?: string | null
  match_status: 'matched' | 'value_mismatch' | 'missing_in_erp' | 'missing_in_source'
  matched_type: 'invoice' | 'purchase_order' | 'purchase_order_item' | null
  matched_id: string | null
  diff: any
  raw: any
}

export async function matchZohoInvoices(
  entityKey: string,
  periodStart: string,
  periodEnd: string,
  rows: ZohoInvoiceRow[]
): Promise<ReconLine[]> {
  // Every ERP invoice in the period, including voided ones: a number that was
  // issued and then cancelled is still accounted for, and reporting it as
  // "missing from Zoho" would be wrong.
  const { data: erpInvoices, error } = await supabaseAdmin
    .from('invoices')
    .select('id, invoice_number, invoice_date, customer_name, customer_gst, subtotal, total_gst, grand_total, is_deleted, place_of_supply')
    .eq('entity_key', entityKey)
    .eq('invoice_type', 'sales')
    .gte('invoice_date', periodStart)
    .lte('invoice_date', periodEnd)
  if (error) throw new Error(`Could not load ERP invoices: ${error.message}`)

  // Per-head tax from the invoice lines. Total tax alone cannot see a CGST+SGST vs IGST
  // mix-up; tax paid under the wrong head is not offsettable and has to be paid again
  // and refunded separately, so it is worth catching before filing.
  const headsByInvoice = new Map<string, { cgst: number; sgst: number; igst: number }>()
  const invoiceIds = (erpInvoices ?? []).map((i: any) => i.id)
  if (invoiceIds.length) {
    const { data: items, error: itemsErr } = await supabaseAdmin
      .from('invoice_items')
      .select('invoice_id, cgst_amount, sgst_amount, igst_amount')
      .in('invoice_id', invoiceIds)
    if (itemsErr) throw new Error(`Could not load ERP invoice lines: ${itemsErr.message}`)
    for (const it of items ?? []) {
      const h = headsByInvoice.get(it.invoice_id) ?? { cgst: 0, sgst: 0, igst: 0 }
      h.cgst += Number(it.cgst_amount) || 0
      h.sgst += Number(it.sgst_amount) || 0
      h.igst += Number(it.igst_amount) || 0
      headsByInvoice.set(it.invoice_id, h)
    }
  }

  const byKey = new Map<string, any>()
  const bySeq = new Map<number, any>()
  for (const inv of erpInvoices ?? []) {
    byKey.set(docNumberKey(inv.invoice_number), inv)
    const seq = docNumberSeq(inv.invoice_number)
    if (seq != null && !bySeq.has(seq)) bySeq.set(seq, inv)
  }

  // Some Zoho exports are line-item level (one CSV row per invoice LINE, not
  // per invoice) -- a 2-line invoice then produces 2 rows with the same
  // invoice number. Two DIFFERENT things are true about what's repeated on
  // those rows, confirmed against a real multi-line invoice PDF
  // (DBI2026/27-00731, 4 items): SubTotal and Total are the INVOICE-LEVEL
  // figures, printed identically on every row -- summing them (an earlier
  // version of this fix did) multiplies the total by the line count. But
  // IGST/CGST/SGST/Cess are PER-LINE amounts (₹5,220 / ₹5,940 / ₹3,420 /
  // ₹450 on that invoice) that only add up to the real ₹15,030 total tax
  // when summed -- taking just the first row's tax (a later version of this
  // fix did) silently reports only one line's tax as the whole invoice's.
  // So: first row's subtotal/total, but every row's tax summed.
  const grouped = new Map<string, ZohoInvoiceRow>()
  for (const r of rows) {
    const gkey = docNumberKey(r.doc_number) || r.doc_number || Math.random().toString()
    const existing = grouped.get(gkey)
    if (!existing) { grouped.set(gkey, { ...r }); continue }
    existing.cgst = (Number(existing.cgst) || 0) + (Number(r.cgst) || 0)
    existing.sgst = (Number(existing.sgst) || 0) + (Number(r.sgst) || 0)
    existing.igst = (Number(existing.igst) || 0) + (Number(r.igst) || 0)
    existing.cess = (Number(existing.cess) || 0) + (Number(r.cess) || 0)
    if (r.lines?.length) existing.lines = [...(existing.lines ?? []), ...r.lines]
  }
  const groupedRows = [...grouped.values()]

  const out: ReconLine[] = []
  const consumed = new Set<string>()

  for (const r of groupedRows) {
    const key = docNumberKey(r.doc_number)
    const seq = docNumberSeq(r.doc_number)
    // Exact key first; fall back to the trailing sequence, which survives a
    // prefix formatted differently between the two systems.
    const erp = byKey.get(key) ?? (seq != null ? bySeq.get(seq) : undefined)

    const base: ReconLine = {
      doc_number: r.doc_number ?? null,
      doc_number_key: key || null,
      doc_date: r.doc_date ?? null,
      counterparty_gstin: r.counterparty_gstin ?? null,
      counterparty_name: r.counterparty_name ?? null,
      taxable_value: r.taxable_value ?? null,
      cgst: r.cgst ?? null, sgst: r.sgst ?? null, igst: r.igst ?? null, cess: r.cess ?? null,
      doc_value: r.doc_value ?? null,
      place_of_supply: normalizePlaceOfSupply(r.place_of_supply),
      match_status: 'missing_in_erp',
      matched_type: null, matched_id: null, diff: null,
      raw: { ...(r.raw ?? r), lines: r.lines ?? [] },
    }

    if (!erp) { out.push(base); continue }

    consumed.add(erp.id)
    const diffs: Record<string, any> = {}
    if (r.taxable_value != null && !withinTolerance(r.taxable_value, erp.subtotal, AMOUNT_TOLERANCE)) {
      diffs.taxable_value = { source: Number(r.taxable_value), erp: Number(erp.subtotal) }
    }
    const srcTax = (Number(r.cgst) || 0) + (Number(r.sgst) || 0) + (Number(r.igst) || 0)
    if ((r.cgst != null || r.sgst != null || r.igst != null) &&
        !withinTolerance(srcTax, erp.total_gst, AMOUNT_TOLERANCE)) {
      diffs.tax = { source: srcTax, erp: Number(erp.total_gst) }
    }
    if (r.cgst != null || r.sgst != null || r.igst != null) {
      const eh = headsByInvoice.get(erp.id) ?? { cgst: 0, sgst: 0, igst: 0 }
      const sh = { cgst: Number(r.cgst) || 0, sgst: Number(r.sgst) || 0, igst: Number(r.igst) || 0 }
      if (!withinTolerance(sh.cgst, eh.cgst, AMOUNT_TOLERANCE) ||
          !withinTolerance(sh.sgst, eh.sgst, AMOUNT_TOLERANCE) ||
          !withinTolerance(sh.igst, eh.igst, AMOUNT_TOLERANCE)) {
        diffs.tax_heads = { source: sh, erp: eh }
      }
    }
    const srcPos = normalizePlaceOfSupply(r.place_of_supply)
    if (srcPos && erp.place_of_supply && srcPos !== erp.place_of_supply) {
      diffs.place_of_supply = { source: srcPos, erp: erp.place_of_supply }
    }
    if (r.doc_value != null && !withinTolerance(r.doc_value, erp.grand_total, AMOUNT_TOLERANCE)) {
      diffs.doc_value = { source: Number(r.doc_value), erp: Number(erp.grand_total) }
    }
    if (r.doc_date && erp.invoice_date && r.doc_date !== erp.invoice_date) {
      diffs.doc_date = { source: r.doc_date, erp: erp.invoice_date }
    }
    // A voided ERP invoice against a live Zoho one is worth surfacing: the
    // supply was reported but the ERP no longer thinks it happened.
    if (erp.is_deleted) diffs.erp_voided = true

    out.push({
      ...base,
      match_status: Object.keys(diffs).length > 0 ? 'value_mismatch' : 'matched',
      matched_type: 'invoice',
      matched_id: erp.id,
      diff: Object.keys(diffs).length > 0 ? diffs : null,
    })
  }

  // ERP invoices the upload never mentioned. For an outward register that means
  // either the ERP issued it itself, or the Zoho export was incomplete -- both
  // worth seeing rather than assuming.
  for (const inv of erpInvoices ?? []) {
    if (consumed.has(inv.id)) continue
    out.push({
      doc_number: inv.invoice_number,
      doc_number_key: docNumberKey(inv.invoice_number),
      doc_date: inv.invoice_date,
      counterparty_gstin: inv.customer_gst ?? null,
      counterparty_name: inv.customer_name ?? null,
      taxable_value: inv.subtotal, cgst: null, sgst: null, igst: null, cess: null,
      doc_value: inv.grand_total,
      match_status: 'missing_in_source',
      matched_type: 'invoice', matched_id: inv.id,
      diff: inv.is_deleted ? { erp_voided: true } : null,
      raw: null,
    })
  }

  return out
}

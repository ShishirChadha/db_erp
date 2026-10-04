import { supabaseAdmin } from '@/lib/supabase/service'
import { docNumberKey, docNumberSeq, withinTolerance } from './gst-doc-key'

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
  raw?: any
}

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
    .select('id, invoice_number, invoice_date, customer_name, customer_gst, subtotal, total_gst, grand_total, is_deleted')
    .eq('entity_key', entityKey)
    .eq('invoice_type', 'sales')
    .gte('invoice_date', periodStart)
    .lte('invoice_date', periodEnd)
  if (error) throw new Error(`Could not load ERP invoices: ${error.message}`)

  const byKey = new Map<string, any>()
  const bySeq = new Map<number, any>()
  for (const inv of erpInvoices ?? []) {
    byKey.set(docNumberKey(inv.invoice_number), inv)
    const seq = docNumberSeq(inv.invoice_number)
    if (seq != null && !bySeq.has(seq)) bySeq.set(seq, inv)
  }

  const out: ReconLine[] = []
  const consumed = new Set<string>()

  for (const r of rows) {
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
      match_status: 'missing_in_erp',
      matched_type: null, matched_id: null, diff: null,
      raw: r.raw ?? r,
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

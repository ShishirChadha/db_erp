import Papa from 'papaparse'

/**
 * GSTR-1 working papers as CSV, one file per section.
 *
 * Column headers match the GSTN Returns Offline Tool's own section templates,
 * so a CA (or the offline tool itself) recognises them without translation.
 * Dates are `dd-mmm-yyyy` here -- that is what the CSV/Excel templates expect,
 * and it is deliberately NOT the `DD-MM-YYYY` the portal JSON uses. Two
 * transports, two formats; do not share one formatter between them.
 *
 * Uses papaparse's unparse for RFC-4180 quoting. lib/tsv.ts is not usable here:
 * it states outright that it implements no quoting, and a customer name with a
 * comma would silently corrupt the file.
 */

export type GstSectionKey = 'b2b' | 'b2cl' | 'b2cs' | 'cdnr' | 'cdnur' | 'hsn_b2b' | 'hsn_b2c' | 'docs'

/** Reconciliation worksheets -- not GSTR-1 sections, so kept separate. */
export type GstWorksheetKey = 'uninvoiced' | 'gaps'

/** `dd-mmm-yyyy` as the offline tool's CSV/Excel templates require. */
export function csvDate(value: string | null | undefined): string {
  if (!value) return ''
  // RPC rows already carry DD-MM-YYYY; accept ISO too so this is reusable.
  const m = String(value).match(/^(\d{2})-(\d{2})-(\d{4})$/)
  const d = m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`
}

const n2 = (v: any) => (v === null || v === undefined || v === '' ? '' : Number(v).toFixed(2))

interface SectionSpec {
  label: string
  filename: string
  rows: (payload: any) => Record<string, any>[]
}

export const GST_SECTIONS: Record<GstSectionKey, SectionSpec> = {
  b2b: {
    label: 'B2B — registered recipients (Table 4A)',
    filename: 'b2b',
    rows: (p) => (p?.b2b ?? []).map((r: any) => ({
      'GSTIN/UIN of Recipient': r.ctin,
      'Receiver Name': r.receiver_name,
      'Invoice Number': r.inum,
      'Invoice date': csvDate(r.idt),
      'Invoice Value': n2(r.val),
      'Place Of Supply': r.pos,
      'Reverse Charge': r.rchrg,
      'Applicable % of Tax Rate': '',
      'Invoice Type': r.inv_typ,
      'E-Commerce GSTIN': '',
      'Rate': n2(r.rt),
      'Taxable Value': n2(r.txval),
      'Integrated Tax Amount': n2(r.iamt),
      'Central Tax Amount': n2(r.camt),
      'State/UT Tax Amount': n2(r.samt),
      'Cess Amount': n2(r.csamt),
    })),
  },
  b2cl: {
    label: 'B2CL — large inter-state B2C (Table 5A)',
    filename: 'b2cl',
    rows: (p) => (p?.b2cl ?? []).map((r: any) => ({
      'Invoice Number': r.inum,
      'Invoice date': csvDate(r.idt),
      'Invoice Value': n2(r.val),
      'Place Of Supply': r.pos,
      'Applicable % of Tax Rate': '',
      'Rate': n2(r.rt),
      'Taxable Value': n2(r.txval),
      'Cess Amount': n2(r.csamt),
      'E-Commerce GSTIN': '',
      'Integrated Tax Amount': n2(r.iamt),
    })),
  },
  b2cs: {
    label: 'B2CS — consolidated small B2C (Table 7)',
    filename: 'b2cs',
    rows: (p) => (p?.b2cs ?? []).map((r: any) => ({
      'Type': r.typ,
      'Place Of Supply': r.pos,
      'Applicable % of Tax Rate': '',
      'Rate': n2(r.rt),
      'Taxable Value': n2(r.txval),
      'Cess Amount': n2(r.csamt),
      'E-Commerce GSTIN': '',
      'Integrated Tax Amount': n2(r.iamt),
      'Central Tax Amount': n2(r.camt),
      'State/UT Tax Amount': n2(r.samt),
    })),
  },
  cdnr: {
    label: 'Credit notes — registered recipients (Table 9B)',
    filename: 'cdnr',
    rows: (p) => (p?.cdnr ?? []).map((r: any) => ({
      'GSTIN/UIN of Recipient': r.ctin,
      'Receiver Name': r.receiver_name,
      'Note/Refund Voucher Number': r.nt_num,
      'Note/Refund Voucher date': csvDate(r.nt_dt),
      'Document Type': r.ntty === 'D' ? 'D' : 'C',
      'Place Of Supply': r.pos,
      'Note/Refund Voucher Value': n2(r.val),
      'Applicable % of Tax Rate': '',
      'Rate': n2(r.rt),
      'Taxable Value': n2(r.txval),
      'Integrated Tax Amount': n2(r.iamt),
      'Central Tax Amount': n2(r.camt),
      'State/UT Tax Amount': n2(r.samt),
      'Cess Amount': n2(r.csamt),
      'Pre GST': 'N',
    })),
  },
  cdnur: {
    label: 'Credit notes — unregistered (Table 9B)',
    filename: 'cdnur',
    rows: (p) => (p?.cdnur ?? []).map((r: any) => ({
      'UR Type': r.typ,
      'Note/Refund Voucher Number': r.nt_num,
      'Note/Refund Voucher date': csvDate(r.nt_dt),
      'Document Type': r.ntty === 'D' ? 'D' : 'C',
      'Place Of Supply': r.pos,
      'Note/Refund Voucher Value': n2(r.val),
      'Applicable % of Tax Rate': '',
      'Rate': n2(r.rt),
      'Taxable Value': n2(r.txval),
      'Integrated Tax Amount': n2(r.iamt),
      'Cess Amount': n2(r.csamt),
      'Pre GST': 'N',
    })),
  },
  hsn_b2b: {
    label: 'HSN summary — B2B (Table 12)',
    filename: 'hsn_b2b',
    rows: (p) => (p?.hsn_b2b ?? []).map((r: any) => hsnRow(r)),
  },
  hsn_b2c: {
    label: 'HSN summary — B2C (Table 12)',
    filename: 'hsn_b2c',
    rows: (p) => (p?.hsn_b2c ?? []).map((r: any) => hsnRow(r)),
  },
  docs: {
    label: 'Documents issued (Table 13)',
    filename: 'docs',
    rows: (p) => (p?.doc_det ?? []).map((r: any) => ({
      'Nature of Document': r.doc_typ,
      'Sr. No. From': r.from,
      'Sr. No. To': r.to,
      'Total Number': r.totnum,
      'Cancelled': r.cancel,
      'Net Issued': r.net_issue,
    })),
  },
}

/**
 * Worksheets for reconciling a period against whatever issued its invoices.
 * These are working documents, not portal uploads, so the columns are chosen
 * to be looked up in the other system rather than to match a GSTN template.
 */
export const GST_WORKSHEETS: Record<GstWorksheetKey, SectionSpec> = {
  uninvoiced: {
    label: 'Sales with no invoice — needs an invoice number',
    filename: 'uninvoiced_sales',
    rows: (p) => (p?.uninvoiced_sales ?? []).map((r: any) => ({
      'Sale Date': csvDate(r.sale_date),
      'Customer': r.customer_name,
      'Customer GSTIN': r.customer_gstin,
      'Asset / Serial': r.identifier,
      'Description': r.description,
      'Taxable Value': n2(r.taxable_value),
      'GST': n2(r.gst),
      'Total': n2(r.total),
      'Sold By': r.sold_by,
      'Payment Status': r.payment_status,
      // Left blank deliberately: this is the column to fill in from Zoho.
      'Zoho Invoice Number': '',
      'Or mark CANCELLED / NOT INVOICED': '',
    })),
  },
  gaps: {
    label: 'Missing invoice numbers — cancelled, or issued but not recorded?',
    filename: 'series_gaps',
    rows: (p) => (p?.series_gaps ?? []).map((r: any) => ({
      'Missing Number': r.missing_number,
      'Comes After': r.previous_invoice,
      'Dated': csvDate(r.previous_date),
      'Comes Before': r.next_invoice,
      'Dated ': csvDate(r.next_date),
      'CANCELLED or NOT RECORDED': '',
      'If not recorded: customer': '',
      'If not recorded: amount': '',
    })),
  },
}

export function worksheetCsv(key: GstWorksheetKey, payload: any): string {
  const rows = GST_WORKSHEETS[key].rows(payload)
  if (rows.length === 0) {
    const sample = GST_WORKSHEETS[key].rows({ uninvoiced_sales: [{}], series_gaps: [{}] })
    return Papa.unparse({ fields: Object.keys(sample[0] ?? {}), data: [] })
  }
  return Papa.unparse(rows)
}

export function worksheetFilename(key: GstWorksheetKey, gstin: string | null, from: string): string {
  const period = from.slice(0, 7).replace('-', '')
  return `GST_${GST_WORKSHEETS[key].filename}_${gstin || 'entity'}_${period}.csv`
}

function hsnRow(r: any) {
  return {
    'HSN': r.hsn_sc,
    'Description': r.descr,
    'UQC': r.uqc,
    'Total Quantity': n2(r.qty),
    'Rate': n2(r.rt),
    'Taxable Value': n2(r.txval),
    'Integrated Tax Amount': n2(r.iamt),
    'Central Tax Amount': n2(r.camt),
    'State/UT Tax Amount': n2(r.samt),
    'Cess Amount': n2(r.csamt),
  }
}

export function sectionCsv(key: GstSectionKey, payload: any): string {
  const rows = GST_SECTIONS[key].rows(payload)
  // An empty section still gets its header row, so the recipient can see the
  // section was considered and is genuinely nil rather than omitted by mistake.
  if (rows.length === 0) {
    const sample = GST_SECTIONS[key].rows({
      b2b: [{}], b2cl: [{}], b2cs: [{}], cdnr: [{}], cdnur: [{}],
      hsn_b2b: [{}], hsn_b2c: [{}], doc_det: [{}],
    })
    return Papa.unparse({ fields: Object.keys(sample[0] ?? {}), data: [] })
  }
  return Papa.unparse(rows)
}

export function gstCsvFilename(
  key: GstSectionKey, gstin: string | null, from: string
): string {
  const period = from.slice(0, 7).replace('-', '')
  return `GSTR1_${GST_SECTIONS[key].filename}_${gstin || 'entity'}_${period}.csv`
}

export function downloadCsv(filename: string, csv: string) {
  // BOM so Excel on Windows reads it as UTF-8 rather than mangling rupee
  // symbols and names.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// GSTR-1 portal JSON.
//
// Built from the SAME aggregation the CSVs use -- the RPC returns flat rows and
// this nests them into the portal's grouped shape, so the two transports can
// never disagree about a figure.
//
// Dates here are DD-MM-YYYY. The CSV templates want dd-mmm-yyyy. That is not an
// inconsistency to tidy up: they are two different specifications, which is why
// csvDate() and jsonDate() are separate and neither is reused for the other.
// ---------------------------------------------------------------------------

/** DD-MM-YYYY, as the portal JSON requires. */
export function jsonDate(value: string | null | undefined): string {
  if (!value) return ''
  const m = String(value).match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`
}

const r2 = (v: any) => Math.round((Number(v) || 0) * 100) / 100

export interface Gstr1JsonInput {
  gstin: string
  /** Period start, ISO (YYYY-MM-DD). Converted to the portal's MMYYYY. */
  periodFrom: string
  /** Aggregate turnover of the preceding financial year. */
  grossTurnover?: number
  /** Turnover of the current financial year to date. */
  currentTurnover?: number
  sections: any
  hsn: any
  docs: any
}

export function buildGstr1Json(input: Gstr1JsonInput): Record<string, any> {
  const [y, m] = input.periodFrom.split('-')
  const out: Record<string, any> = {
    gstin: input.gstin,
    fp: `${m}${y}`,
  }
  if (input.grossTurnover != null) out.gt = r2(input.grossTurnover)
  if (input.currentTurnover != null) out.cur_gt = r2(input.currentTurnover)

  // b2b: grouped by recipient GSTIN, then by invoice, then items by rate.
  const b2bRows: any[] = input.sections?.b2b ?? []
  if (b2bRows.length) {
    const byCtin = new Map<string, Map<string, any>>()
    for (const r of b2bRows) {
      if (!byCtin.has(r.ctin)) byCtin.set(r.ctin, new Map())
      const invs = byCtin.get(r.ctin)!
      if (!invs.has(r.inum)) {
        invs.set(r.inum, {
          inum: r.inum, idt: jsonDate(r.idt), val: r2(r.val), pos: r.pos,
          rchrg: r.rchrg || 'N', inv_typ: r.inv_typ || 'R', itms: [],
        })
      }
      const inv = invs.get(r.inum)!
      inv.itms.push({
        num: inv.itms.length + 1,
        itm_det: {
          rt: Number(r.rt), txval: r2(r.txval),
          iamt: r2(r.iamt), camt: r2(r.camt), samt: r2(r.samt), csamt: r2(r.csamt),
        },
      })
    }
    out.b2b = [...byCtin.entries()].map(([ctin, invs]) => ({ ctin, inv: [...invs.values()] }))
  }

  // b2cl: grouped by place of supply (there is no recipient GSTIN).
  const b2clRows: any[] = input.sections?.b2cl ?? []
  if (b2clRows.length) {
    const byPos = new Map<string, Map<string, any>>()
    for (const r of b2clRows) {
      if (!byPos.has(r.pos)) byPos.set(r.pos, new Map())
      const invs = byPos.get(r.pos)!
      if (!invs.has(r.inum)) {
        invs.set(r.inum, { inum: r.inum, idt: jsonDate(r.idt), val: r2(r.val), itms: [] })
      }
      const inv = invs.get(r.inum)!
      inv.itms.push({
        num: inv.itms.length + 1,
        // Inter-state by definition, so IGST only -- never camt/samt here.
        itm_det: { rt: Number(r.rt), txval: r2(r.txval), iamt: r2(r.iamt), csamt: r2(r.csamt) },
      })
    }
    out.b2cl = [...byPos.entries()].map(([pos, invs]) => ({ pos, inv: [...invs.values()] }))
  }

  // b2cs: already fully consolidated, no invoice detail and no itms wrapper.
  const b2csRows: any[] = input.sections?.b2cs ?? []
  if (b2csRows.length) {
    out.b2cs = b2csRows.map((r) => ({
      sply_ty: r.sply_ty, typ: r.typ || 'OE', pos: r.pos, rt: Number(r.rt),
      txval: r2(r.txval), iamt: r2(r.iamt), camt: r2(r.camt), samt: r2(r.samt), csamt: r2(r.csamt),
    }))
  }

  // cdnr: grouped by recipient GSTIN, notes under `nt` (not `inv`). The
  // original-invoice reference was removed from this section in a 2018 schema
  // revision, so notes stand alone here.
  const cdnrRows: any[] = input.sections?.cdnr ?? []
  if (cdnrRows.length) {
    const byCtin = new Map<string, Map<string, any>>()
    for (const r of cdnrRows) {
      if (!byCtin.has(r.ctin)) byCtin.set(r.ctin, new Map())
      const notes = byCtin.get(r.ctin)!
      if (!notes.has(r.nt_num)) {
        notes.set(r.nt_num, {
          ntty: r.ntty || 'C', nt_num: r.nt_num, nt_dt: jsonDate(r.nt_dt),
          pos: r.pos, rchrg: r.rchrg || 'N', inv_typ: r.inv_typ || 'R',
          val: r2(r.val), itms: [],
        })
      }
      const note = notes.get(r.nt_num)!
      note.itms.push({
        num: note.itms.length + 1,
        itm_det: {
          rt: Number(r.rt), txval: r2(r.txval),
          iamt: r2(r.iamt), camt: r2(r.camt), samt: r2(r.samt), csamt: r2(r.csamt),
        },
      })
    }
    out.cdnr = [...byCtin.entries()].map(([ctin, notes]) => ({ ctin, nt: [...notes.values()] }))
  }

  // cdnur: flat, with a `typ` discriminator and no recipient grouping.
  const cdnurRows: any[] = input.sections?.cdnur ?? []
  if (cdnurRows.length) {
    const byNum = new Map<string, any>()
    for (const r of cdnurRows) {
      if (!byNum.has(r.nt_num)) {
        byNum.set(r.nt_num, {
          typ: r.typ || 'B2CL', ntty: r.ntty || 'C',
          nt_num: r.nt_num, nt_dt: jsonDate(r.nt_dt),
          pos: r.pos, val: r2(r.val), itms: [],
        })
      }
      const note = byNum.get(r.nt_num)!
      note.itms.push({
        num: note.itms.length + 1,
        // Inter-state by definition in this section, so IGST only.
        itm_det: { rt: Number(r.rt), txval: r2(r.txval), iamt: r2(r.iamt), csamt: r2(r.csamt) },
      })
    }
    out.cdnur = [...byNum.values()]
  }

  // Table 12, split b2b/b2c -- the shape required from the May 2025 period.
  const hsnB2b: any[] = input.hsn?.hsn_b2b ?? []
  const hsnB2c: any[] = input.hsn?.hsn_b2c ?? []
  if (hsnB2b.length || hsnB2c.length) {
    const map = (rows: any[]) => rows.map((r, i) => ({
      num: i + 1, hsn_sc: String(r.hsn_sc), desc: String(r.descr ?? '').slice(0, 30),
      uqc: r.uqc, qty: r2(r.qty), rt: Number(r.rt), txval: r2(r.txval),
      iamt: r2(r.iamt), camt: r2(r.camt), samt: r2(r.samt), csamt: r2(r.csamt),
    }))
    out.hsn = {}
    if (hsnB2b.length) out.hsn.hsn_b2b = map(hsnB2b)
    if (hsnB2c.length) out.hsn.hsn_b2c = map(hsnB2c)
  }

  // Table 13.
  const docRows: any[] = input.docs?.doc_det ?? []
  if (docRows.length) {
    out.doc_issue = {
      doc_det: docRows.map((r) => ({
        doc_num: r.doc_num,
        docs: [{
          num: 1, from: String(r.from), to: String(r.to),
          totnum: Number(r.totnum), cancel: Number(r.cancel), net_issue: Number(r.net_issue),
        }],
      })),
    }
  }

  return out
}

/**
 * The portal's own filename convention, including GSTN's typo ("retruns").
 * Reproduced verbatim because that is what their tool emits and expects.
 */
export function gstr1JsonFilename(gstin: string, periodFrom: string): string {
  const [y, m] = periodFrom.split('-')
  return `retruns_${m}${y}_Returns_${gstin}_offline.json`
}

export function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

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

export type GstSectionKey = 'b2b' | 'b2cl' | 'b2cs' | 'hsn_b2b' | 'hsn_b2c' | 'docs'

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
      b2b: [{}], b2cl: [{}], b2cs: [{}], hsn_b2b: [{}], hsn_b2c: [{}], doc_det: [{}],
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

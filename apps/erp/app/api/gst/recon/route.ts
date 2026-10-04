// Upload-driven GST reconciliation. Owner-only.
//
// Two sources, one flow: parse the upload, match it against the ERP
// deterministically, store every line with its bucket. Resolutions are stored
// rather than recomputed, so next month starts from a known-clean baseline
// instead of re-litigating the same mismatches.
import { NextRequest, NextResponse } from 'next/server'
import Papa from 'papaparse'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { matchZohoInvoices, type ZohoInvoiceRow } from '@/lib/recon/gst-zoho-matcher'
import { matchGstr2b, parseGstr2bJson } from '@/lib/recon/gst-2b-matcher'

const KINDS = ['zoho_invoices', 'gstr2b'] as const

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const importId = sp.get('import_id')

  if (importId) {
    const { data: imp, error: iErr } = await supabaseAdmin
      .from('gst_recon_imports').select('*').eq('id', importId).single()
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 404 })

    let q = supabaseAdmin.from('gst_recon_lines').select('*').eq('import_id', importId)
    const status = sp.get('status')
    if (status) q = q.eq('match_status', status)
    // Unresolved problems first; matched rows are the boring tail.
    const { data: lines, error: lErr } = await q.order('match_status').order('doc_date')
    if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 })
    return NextResponse.json({ import: imp, lines: lines ?? [] })
  }

  let q = supabaseAdmin.from('gst_recon_imports').select('*')
    .order('period_start', { ascending: false }).order('created_at', { ascending: false })
  const entity = sp.get('entity')
  if (entity) q = q.eq('entity_key', entity)
  const kind = sp.get('kind')
  if (kind) q = q.eq('kind', kind)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

/**
 * Column aliases for a Zoho CSV export. Zoho's own column names vary by report
 * and by version, so matching is on a normalised header rather than an exact
 * string -- otherwise a harmless rename silently produces zero parsed rows.
 */
const ZOHO_ALIASES: Record<string, string[]> = {
  doc_number: ['invoicenumber', 'invoice', 'invoiceno', 'invoice#', 'billnumber'],
  doc_date: ['invoicedate', 'date', 'billdate'],
  counterparty_name: ['customername', 'customer', 'partyname', 'billedto'],
  counterparty_gstin: ['gstin', 'customergstin', 'gstinuin', 'gstidentificationnumber', 'gstno'],
  taxable_value: ['taxablevalue', 'subtotal', 'taxableamount', 'netamount'],
  cgst: ['cgst', 'cgstamount', 'centraltaxamount'],
  sgst: ['sgst', 'sgstamount', 'stateutaxamount', 'stateutaxamount'],
  igst: ['igst', 'igstamount', 'integratedtaxamount'],
  cess: ['cess', 'cessamount'],
  doc_value: ['invoicevalue', 'total', 'grandtotal', 'invoicetotal', 'amount'],
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')
const num = (v: any) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function isoDate(v: any): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  let m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  // dd-MMM-yyyy, which is what the GST templates and many Zoho exports use.
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})$/)
  if (m) {
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
    const mi = months.indexOf(m[2].toLowerCase())
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function parseZohoCsv(text: string): { rows: ZohoInvoiceRow[]; unmapped: string[] } {
  const parsed = Papa.parse<Record<string, any>>(text, { header: true, skipEmptyLines: true })
  const headers = parsed.meta.fields ?? []
  const map: Record<string, string> = {}
  for (const [field, aliases] of Object.entries(ZOHO_ALIASES)) {
    const hit = headers.find((h) => aliases.includes(norm(h)))
    if (hit) map[field] = hit
  }
  const unmapped = Object.keys(ZOHO_ALIASES).filter((f) => !map[f])

  const rows: ZohoInvoiceRow[] = []
  for (const r of parsed.data) {
    const docNumber = String(r[map.doc_number] ?? '').trim()
    if (!docNumber) continue
    rows.push({
      doc_number: docNumber,
      doc_date: isoDate(r[map.doc_date]),
      counterparty_name: map.counterparty_name ? String(r[map.counterparty_name] ?? '').trim() || null : null,
      counterparty_gstin: map.counterparty_gstin ? String(r[map.counterparty_gstin] ?? '').trim() || null : null,
      taxable_value: num(r[map.taxable_value]),
      cgst: num(r[map.cgst]), sgst: num(r[map.sgst]), igst: num(r[map.igst]), cess: num(r[map.cess]),
      doc_value: num(r[map.doc_value]),
      raw: r,
    })
  }
  return { rows, unmapped }
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { entity_key, kind, period_start, period_end, content, source_filename, document_id } = body
  if (!entity_key || !kind || !period_start || !period_end) {
    return NextResponse.json(
      { error: 'entity_key, kind, period_start and period_end are required' }, { status: 400 })
  }
  if (!(KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: `kind must be one of: ${KINDS.join(', ')}` }, { status: 400 })
  }
  if (!content) return NextResponse.json({ error: 'content (the file text) is required' }, { status: 400 })

  try {
    let lines
    let unmapped: string[] = []

    if (kind === 'zoho_invoices') {
      const parsed = parseZohoCsv(String(content))
      if (parsed.rows.length === 0) {
        return NextResponse.json({
          error: 'No invoice rows could be read from that file. Check it has a header row with an invoice-number column.',
          error_code: 'no_rows_parsed',
          unmapped_fields: parsed.unmapped,
        }, { status: 400 })
      }
      unmapped = parsed.unmapped
      lines = await matchZohoInvoices(entity_key, period_start, period_end, parsed.rows)
    } else {
      let payload: any
      try {
        payload = typeof content === 'string' ? JSON.parse(content) : content
      } catch {
        return NextResponse.json({
          error: 'That did not parse as JSON. Download GSTR-2B from the portal in JSON form and upload that file.',
          error_code: 'invalid_json',
        }, { status: 400 })
      }
      const rows = parseGstr2bJson(payload)
      if (rows.length === 0) {
        return NextResponse.json({
          error: 'No B2B invoices found in that GSTR-2B file. Check it is the right period and not an empty return.',
          error_code: 'no_rows_parsed',
        }, { status: 400 })
      }
      lines = await matchGstr2b(entity_key, period_start, period_end, rows)
    }

    const { data: imp, error: iErr } = await supabaseAdmin
      .from('gst_recon_imports')
      .insert({
        entity_key, kind, period_start, period_end,
        document_id: document_id || null,
        source_filename: source_filename || null,
        uploaded_by: sessionUser!.id,
        notes: unmapped.length ? `Columns not found in the upload: ${unmapped.join(', ')}` : null,
      })
      .select()
      .single()
    if (iErr) throw new Error(iErr.message)

    const { error: lErr } = await supabaseAdmin
      .from('gst_recon_lines')
      .insert(lines.map((l) => ({ ...l, import_id: imp.id })))
    if (lErr) {
      // Don't leave an import row with no lines behind it.
      await supabaseAdmin.from('gst_recon_imports').delete().eq('id', imp.id)
      throw new Error(lErr.message)
    }

    const { data: fresh } = await supabaseAdmin
      .from('gst_recon_imports').select('*').eq('id', imp.id).single()

    await logAuditEvent({
      actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
      actionType: 'create', module: 'gst', tableName: 'gst_recon_imports',
      recordId: imp.id, recordLabel: `${kind} ${period_start}`,
      metadata: { entity_key, rows: lines.length },
    })

    return NextResponse.json({ import: fresh ?? imp, rows: lines.length, unmapped_fields: unmapped }, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Reconciliation failed' }, { status: 500 })
  }
}

// Record what was decided about a line. Stored, not recomputed -- a
// reconciliation is only worth doing if last month's decisions survive.
export async function PATCH(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body?.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const RESOLUTIONS = ['accepted', 'entered_in_erp', 'ignored', 'chase_supplier', 'itc_claimed', 'itc_ineligible']
  if (body.resolution && !RESOLUTIONS.includes(body.resolution)) {
    return NextResponse.json({ error: `resolution must be one of: ${RESOLUTIONS.join(', ')}` }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('gst_recon_lines')
    .update({
      resolution: body.resolution ?? null,
      resolution_note: body.resolution_note ?? null,
      resolved_by: body.resolution ? sessionUser!.id : null,
      resolved_at: body.resolution ? new Date().toISOString() : null,
    })
    .eq('id', body.id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // An ITC decision has to reach the purchase line itself, or 3B Table 4 keeps
  // reporting the old figure and the reconciliation achieves nothing.
  if (data?.matched_type === 'purchase_order' && data.matched_id &&
      (body.resolution === 'itc_claimed' || body.resolution === 'itc_ineligible')) {
    await supabaseAdmin
      .from('purchase_order_items')
      .update({
        itc_status: body.resolution === 'itc_claimed' ? 'claimed' : 'ineligible',
        itc_claimed_period: body.resolution === 'itc_claimed' ? (body.claimed_period ?? null) : null,
      })
      .eq('po_id', data.matched_id)
  }

  return NextResponse.json(data)
}

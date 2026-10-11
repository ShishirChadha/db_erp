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
import { docNumberKey } from '@/lib/recon/gst-doc-key'

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

  const { entity_key, kind, period_start, period_end, content, source_filename, document_id, source_import_id } = body
  if (!entity_key || !kind || !period_start || !period_end) {
    return NextResponse.json(
      { error: 'entity_key, kind, period_start and period_end are required' }, { status: 400 })
  }
  if (!(KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: `kind must be one of: ${KINDS.join(', ')}` }, { status: 400 })
  }
  // source_import_id re-runs the match using the rows already parsed from a
  // previous upload (stored per-line in `raw`) against *current* ERP data --
  // for re-checking after fixing an invoice without having to re-export and
  // re-upload the same Zoho CSV just to see the fix reflected.
  if (!content && !source_import_id) {
    return NextResponse.json({ error: 'content (the file text) or source_import_id is required' }, { status: 400 })
  }

  try {
    let lines
    let unmapped: string[] = []

    if (kind === 'zoho_invoices' && source_import_id) {
      // Re-use the already-normalized columns stored on each line -- NOT the
      // `raw` column (that holds Zoho's original, un-normalized CSV row with
      // Zoho's own header names like "Invoice Number", which has no
      // `doc_number` field and was silently producing a blank/unmatched
      // result for every single row). Exclude missing_in_source rows -- those
      // are ERP invoices the Zoho upload never mentioned, not Zoho rows.
      const { data: srcLines, error: sErr } = await supabaseAdmin
        .from('gst_recon_lines')
        .select('doc_number, doc_date, counterparty_name, counterparty_gstin, taxable_value, cgst, sgst, igst, cess, doc_value')
        .eq('import_id', source_import_id).neq('match_status', 'missing_in_source')
      if (sErr) throw new Error(sErr.message)
      const rows: ZohoInvoiceRow[] = (srcLines ?? []).map((l: any) => ({
        doc_number: l.doc_number, doc_date: l.doc_date,
        counterparty_name: l.counterparty_name, counterparty_gstin: l.counterparty_gstin,
        taxable_value: l.taxable_value, cgst: l.cgst, sgst: l.sgst, igst: l.igst, cess: l.cess,
        doc_value: l.doc_value,
      }))
      if (rows.length === 0) {
        return NextResponse.json({ error: 'That upload has no source rows left to re-check against.' }, { status: 400 })
      }

      // A previous Re-check wiped every resolution/ignore decision on this import,
      // because it deleted and re-inserted all lines with no memory of what had
      // already been decided -- an owner who ignored a ₹1.30 rounding diff would
      // see it reset right back to unresolved the moment they re-checked. Carry
      // forward any resolution for an invoice number whose verdict is still the
      // same (same match_status) after re-matching; an invoice whose verdict
      // actually changed (e.g. a real fix landed) is deliberately left unresolved
      // again so it gets a fresh look.
      const { data: priorLines } = await supabaseAdmin
        .from('gst_recon_lines')
        .select('doc_number, match_status, resolution, resolution_note, resolved_by, resolved_at')
        .eq('import_id', source_import_id).not('resolution', 'is', null)
      const priorByKey = new Map((priorLines ?? []).map((l: any) => [docNumberKey(l.doc_number), l]))

      lines = await matchZohoInvoices(entity_key, period_start, period_end, rows)
      const linesWithCarriedResolutions = lines.map((l) => {
        const prior = priorByKey.get(docNumberKey(l.doc_number))
        if (!prior || prior.match_status !== l.match_status) return l
        return { ...l, resolution: prior.resolution, resolution_note: prior.resolution_note, resolved_by: prior.resolved_by, resolved_at: prior.resolved_at }
      })

      // Update the SAME import in place rather than creating a new one --
      // re-checking is meant to refresh a result, not pile up another row
      // in "Previous uploads" every time.
      const { error: delErr } = await supabaseAdmin
        .from('gst_recon_lines').delete().eq('import_id', source_import_id)
      if (delErr) throw new Error(delErr.message)
      const { error: insErr } = await supabaseAdmin
        .from('gst_recon_lines').insert(linesWithCarriedResolutions.map((l) => ({ ...l, import_id: source_import_id })))
      if (insErr) throw new Error(insErr.message)

      const { data: fresh } = await supabaseAdmin
        .from('gst_recon_imports').select('*').eq('id', source_import_id).single()

      await logAuditEvent({
        actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
        actionType: 'update', module: 'gst', tableName: 'gst_recon_imports',
        recordId: source_import_id, recordLabel: `re-check ${kind} ${period_start}`,
        metadata: { entity_key, rows: lines.length },
      })

      return NextResponse.json({ import: fresh, rows: lines.length, unmapped_fields: [] }, { status: 200 })
    } else if (kind === 'zoho_invoices') {
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
  // A resolution with no reason is indistinguishable from "clicked through to
  // make the warning disappear" -- the column has always existed, nothing ever
  // required it. Clearing a resolution (body.resolution omitted/null) needs no
  // reason -- there's nothing left to explain at that point.
  if (body.resolution && !String(body.resolution_note ?? '').trim()) {
    return NextResponse.json({ error: 'A reason is required to resolve a row.' }, { status: 400 })
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

// Removes an upload entirely (its lines cascade) -- for a duplicate/stale
// re-upload sitting in "Previous uploads" that's just confusing clutter, not
// something worth keeping as history. gst_zoho_register_status() already only
// ever reads the most recent import for a period, so deleting an old one
// never changes which import is authoritative -- it only removes the dead
// one from the list.
export async function DELETE(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const importId = req.nextUrl.searchParams.get('import_id')
  if (!importId) return NextResponse.json({ error: 'import_id is required' }, { status: 400 })

  const { data: imp, error: fErr } = await supabaseAdmin
    .from('gst_recon_imports').select('*').eq('id', importId).single()
  if (fErr || !imp) return NextResponse.json({ error: 'Upload not found' }, { status: 404 })

  const { error } = await supabaseAdmin.from('gst_recon_imports').delete().eq('id', importId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'hard_delete', module: 'gst', tableName: 'gst_recon_imports',
    recordId: importId, recordLabel: `${imp.kind} ${imp.period_start}`,
    metadata: { entity_key: imp.entity_key, source_filename: imp.source_filename, row_count: imp.row_count },
  })

  return NextResponse.json({ success: true })
}

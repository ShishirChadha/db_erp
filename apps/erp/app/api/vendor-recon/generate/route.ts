import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { resolveVendor, buildCorrectionProposals, crossCheckGstinState } from '@/lib/recon/vendor-matcher'
import type { VendorInvoiceExtraction } from '@/lib/recon/schemas'

// ---------- POST: resolve the vendor for a parsed invoice document, propose corrections ----------
// Runs after a document reaches extraction_status 'parsed' (Tier 1 or Tier 2) --
// doesn't extract anything itself. Idempotent: re-running clears prior pending
// proposals for this document first, so calling it again after re-parsing never
// leaves stale duplicates alongside fresh ones.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { document_id, vendor_id: forcedVendorId } = await req.json()
  if (!document_id) return NextResponse.json({ error: 'document_id is required.' }, { status: 400 })

  const { data: doc, error: docErr } = await supabaseAdmin.from('uploaded_documents').select('*').eq('id', document_id).single()
  if (docErr || !doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  if (doc.doc_kind !== 'vendor_invoice') return NextResponse.json({ error: 'Vendor reconciliation only applies to vendor_invoice documents.' }, { status: 400 })
  if (!doc.raw_extraction) return NextResponse.json({ error: 'This document has not been parsed yet.' }, { status: 400 })

  const extraction = doc.raw_extraction as VendorInvoiceExtraction

  let vendor
  let matchMethod
  let candidates
  if (forcedVendorId) {
    const { data } = await supabaseAdmin.from('vendors').select('*').eq('id', forcedVendorId).eq('is_deleted', false).single()
    vendor = data
    matchMethod = 'manual' as const
  } else {
    const result = await resolveVendor(extraction, doc.vendor_id)
    vendor = result.vendor
    matchMethod = result.matchMethod
    candidates = result.candidates
  }

  if (!vendor) {
    return NextResponse.json({
      status: 'no_vendor_match',
      candidates: candidates || [],
      message: 'No vendor matched this invoice. Create a new vendor or pick one of the candidates and re-run with vendor_id.',
    })
  }

  // Idempotent re-run: clear this document's still-pending proposals before
  // generating fresh ones (approved/rejected proposals from a prior run stay put --
  // they're already-decided history, not something a re-parse should silently undo).
  await supabaseAdmin.from('vendor_correction_proposals').delete().eq('document_id', document_id).eq('status', 'pending')

  const corrections = buildCorrectionProposals(vendor, extraction)
  const stateCheck = crossCheckGstinState(vendor, extraction)

  if (corrections.length > 0) {
    const { error: insertErr } = await supabaseAdmin.from('vendor_correction_proposals').insert(
      corrections.map((c) => ({
        document_id,
        vendor_id: vendor.id,
        field_name: c.field_name,
        current_value: c.current_value,
        proposed_value: c.proposed_value,
        change_kind: c.change_kind,
        confidence: c.confidence,
      }))
    )
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  await supabaseAdmin.from('uploaded_documents').update({ vendor_id: vendor.id, updated_at: new Date().toISOString() }).eq('id', document_id)

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'reconciliation',
    tableName: 'vendor_correction_proposals',
    recordId: document_id,
    recordLabel: `${corrections.length} proposal(s) for vendor ${vendor.company_name} (matched via ${matchMethod})`,
  })

  return NextResponse.json({
    status: 'ok',
    vendor,
    match_method: matchMethod,
    proposal_count: corrections.length,
    gstin_state_cross_check: stateCheck,
  })
}

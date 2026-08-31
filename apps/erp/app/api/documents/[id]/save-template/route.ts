import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { probeDocument, deriveFieldRules } from '@/lib/recon/pdf-text'

// ---------- POST: promote a confirmed parse into a reusable template ----------
// "Save layout for this vendor" -- derives regex rules from this document's own
// text plus its already-confirmed extraction (see deriveFieldRules), at zero extra
// AI cost. Every later document whose text contains the resulting match_fingerprint
// auto-selects this template at Tier 1, for free.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data: doc, error: docErr } = await supabaseAdmin.from('uploaded_documents').select('*').eq('id', id).single()
  if (docErr || !doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  if (!doc.raw_extraction) {
    return NextResponse.json({ error: 'This document has no confirmed extraction to learn from yet.' }, { status: 400 })
  }
  if (!['parsed', 'confirmed'].includes(doc.extraction_status)) {
    return NextResponse.json({ error: 'Only a parsed/confirmed extraction can be saved as a template.' }, { status: 400 })
  }

  const { data: fileBlob, error: dlErr } = await supabaseAdmin.storage.from('documents').download(doc.storage_path)
  if (dlErr || !fileBlob) return NextResponse.json({ error: `Could not read file: ${dlErr?.message}` }, { status: 500 })
  const probe = await probeDocument(Buffer.from(await fileBlob.arrayBuffer()))

  const extraction = doc.raw_extraction as Record<string, any>
  let matchFingerprint: string | null = null
  let headerFieldNames: string[]
  let vendorId: string | null = doc.vendor_id

  if (doc.doc_kind === 'vendor_invoice') {
    headerFieldNames = ['vendor_name', 'vendor_gstin', 'vendor_address', 'vendor_city', 'vendor_pincode', 'vendor_state', 'vendor_phone', 'vendor_phone_2', 'vendor_email', 'invoice_number', 'invoice_date', 'subtotal', 'total_gst', 'grand_total']
    matchFingerprint = extraction.vendor_gstin || (extraction.vendor_name ? String(extraction.vendor_name).slice(0, 40) : null)
  } else {
    headerFieldNames = ['account_number_last4', 'period_start', 'period_end', 'opening_balance', 'closing_balance']
    matchFingerprint = extraction.account_number_last4 ? `A/C ...${extraction.account_number_last4}` : null
  }

  if (!matchFingerprint) {
    return NextResponse.json({ error: 'Could not derive a fingerprint (vendor GSTIN/name, or account number) to identify future documents of this type.' }, { status: 400 })
  }

  const values: Record<string, string | null> = {}
  for (const f of headerFieldNames) values[f] = extraction[f] != null ? String(extraction[f]) : null
  const rules = deriveFieldRules(probe.text, values)

  if (Object.keys(rules.fields).length === 0) {
    return NextResponse.json({ error: 'Could not anchor any field back into the document text -- this layout may not be learnable automatically.' }, { status: 400 })
  }

  const { data: template, error: insertErr } = await supabaseAdmin
    .from('extraction_templates')
    .insert({
      template_kind: doc.doc_kind,
      vendor_id: vendorId,
      match_fingerprint: matchFingerprint,
      field_rules: rules,
      created_by: sessionUser.id,
    })
    .select()
    .single()
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  await supabaseAdmin
    .from('uploaded_documents')
    .update({ extraction_template_id: template.id, extraction_status: 'confirmed', updated_at: new Date().toISOString() })
    .eq('id', id)

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'reconciliation',
    tableName: 'extraction_templates',
    recordId: template.id,
    recordLabel: `Template learned from document ${id}: ${matchFingerprint}`,
  })

  return NextResponse.json({
    template,
    fields_learned: Object.keys(rules.fields),
    fields_not_learned: headerFieldNames.filter((f) => !rules.fields[f]),
  })
}

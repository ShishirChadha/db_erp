import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { probeDocument, applyTemplate, type TemplateFieldRules } from '@/lib/recon/pdf-text'
import { validateVendorInvoiceExtraction, validateBankStatementExtraction } from '@/lib/recon/validate'
import type { VendorInvoiceExtraction, BankStatementExtraction } from '@/lib/recon/schemas'

// ---------- POST: Tier 1 -- try a saved template against this document ----------
// Free, instant, no API call. Auto-selects a template whose match_fingerprint (the
// vendor's GSTIN, or a bank's header string) appears in the document's text layer.
// No matching template -> extraction_status becomes 'ai_pending_approval', which is
// not a failure -- it's the signal the UI uses to offer the "Read with AI" button
// rather than call it automatically.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data: doc, error: docErr } = await supabaseAdmin.from('uploaded_documents').select('*').eq('id', id).single()
  if (docErr || !doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const { data: fileBlob, error: dlErr } = await supabaseAdmin.storage.from('documents').download(doc.storage_path)
  if (dlErr || !fileBlob) return NextResponse.json({ error: `Could not read file: ${dlErr?.message}` }, { status: 500 })
  const buffer = Buffer.from(await fileBlob.arrayBuffer())
  const probe = await probeDocument(buffer)

  const { data: templates } = await supabaseAdmin
    .from('extraction_templates')
    .select('*')
    .eq('template_kind', doc.doc_kind)
    .eq('is_active', true)

  const template = (templates || []).find((t) => probe.text.includes(t.match_fingerprint))

  if (!template) {
    await supabaseAdmin
      .from('uploaded_documents')
      .update({ extraction_tier: '0_probe', extraction_status: 'ai_pending_approval', updated_at: new Date().toISOString() })
      .eq('id', id)
    return NextResponse.json({ status: 'no_template', message: 'No saved template matched this document.' })
  }

  const applied = applyTemplate(probe.text, template.field_rules as TemplateFieldRules)

  let extraction: VendorInvoiceExtraction | BankStatementExtraction
  let validation
  if (doc.doc_kind === 'vendor_invoice') {
    extraction = {
      vendor_name: applied.fields.vendor_name || '',
      vendor_gstin: applied.fields.vendor_gstin || null,
      vendor_address: applied.fields.vendor_address || null,
      vendor_city: applied.fields.vendor_city || null,
      vendor_pincode: applied.fields.vendor_pincode || null,
      vendor_state: applied.fields.vendor_state || null,
      vendor_phone: applied.fields.vendor_phone || null,
      vendor_phone_2: applied.fields.vendor_phone_2 || null,
      vendor_email: applied.fields.vendor_email || null,
      invoice_number: applied.fields.invoice_number || '',
      invoice_date: applied.fields.invoice_date || '',
      subtotal: Number(applied.fields.subtotal) || 0,
      total_gst: Number(applied.fields.total_gst) || 0,
      grand_total: Number(applied.fields.grand_total) || 0,
      lines: applied.lineItems.map((l) => ({
        description: l.description || '',
        hsn_code: l.hsn_code || null,
        quantity: Number(l.quantity) || 1,
        rate: Number(l.rate) || 0,
        gst_rate: l.gst_rate ? Number(l.gst_rate) : null,
        amount: Number(l.amount) || 0,
      })),
    }
    validation = validateVendorInvoiceExtraction(extraction)
  } else {
    extraction = {
      account_number_last4: applied.fields.account_number_last4 || null,
      period_start: applied.fields.period_start || '',
      period_end: applied.fields.period_end || '',
      opening_balance: applied.fields.opening_balance ? Number(applied.fields.opening_balance) : null,
      closing_balance: applied.fields.closing_balance ? Number(applied.fields.closing_balance) : null,
      transactions: applied.lineItems.map((t) => ({
        txn_date: t.txn_date || '',
        value_date: t.value_date || null,
        narration: t.narration || '',
        reference: t.reference || null,
        debit: t.debit ? Number(t.debit) : null,
        credit: t.credit ? Number(t.credit) : null,
        running_balance: t.running_balance ? Number(t.running_balance) : null,
      })),
    }
    validation = validateBankStatementExtraction(extraction)
  }

  const status = validation.ok ? 'parsed' : 'needs_review'
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('uploaded_documents')
    .update({
      extraction_tier: '1_template',
      extraction_status: status,
      extraction_template_id: template.id,
      vendor_id: template.vendor_id || doc.vendor_id,
      raw_extraction: extraction,
      validation_errors: validation.ok ? null : validation.issues,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  await supabaseAdmin
    .from('extraction_templates')
    .update({ times_used: template.times_used + 1, last_used_at: new Date().toISOString() })
    .eq('id', template.id)

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'reconciliation',
    tableName: 'uploaded_documents',
    recordId: id,
    recordLabel: `Tier 1 parse via template ${template.id} -> ${status}`,
  })

  return NextResponse.json({ status: 'parsed', document: updated, validation })
}

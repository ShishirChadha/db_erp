import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { probeDocument } from '@/lib/recon/pdf-text'
import { validateVendorInvoiceExtraction, validateBankStatementExtraction } from '@/lib/recon/validate'
import {
  extractVendorInvoiceFromText,
  extractVendorInvoiceFromPdf,
  extractBankStatementFromText,
  extractBankStatementFromPdf,
} from '@/lib/recon/ai-extract'

// ---------- POST: Tier 2 -- AI-assisted extraction ----------
// The only tier that costs tokens, and the only one that must never fire on its
// own. Two independent gates enforce that: this is a distinct endpoint the UI only
// calls from an explicit "Read with AI" button (never from the Tier 0/1 auto-run
// path), AND the request body itself must carry { confirm: true } or this route
// refuses -- so an accidental or scripted call still can't trigger a paid API call.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  if (body?.confirm !== true) {
    return NextResponse.json({ error: 'AI extraction requires explicit confirmation (confirm: true).' }, { status: 400 })
  }

  const { id } = await params
  const { data: doc, error: docErr } = await supabaseAdmin.from('uploaded_documents').select('*').eq('id', id).single()
  if (docErr || !doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const { data: fileBlob, error: dlErr } = await supabaseAdmin.storage.from('documents').download(doc.storage_path)
  if (dlErr || !fileBlob) return NextResponse.json({ error: `Could not read file: ${dlErr?.message}` }, { status: 500 })
  const buffer = Buffer.from(await fileBlob.arrayBuffer())
  const probe = await probeDocument(buffer)

  try {
    let extraction, inputTokens, outputTokens
    if (doc.doc_kind === 'vendor_invoice') {
      const result = probe.likelyScanned
        ? await extractVendorInvoiceFromPdf(buffer.toString('base64'))
        : await extractVendorInvoiceFromText(probe.text)
      extraction = result.data
      inputTokens = result.inputTokens
      outputTokens = result.outputTokens
    } else {
      const result = probe.likelyScanned
        ? await extractBankStatementFromPdf(buffer.toString('base64'))
        : await extractBankStatementFromText(probe.text)
      extraction = result.data
      inputTokens = result.inputTokens
      outputTokens = result.outputTokens
    }

    const validation = doc.doc_kind === 'vendor_invoice'
      ? validateVendorInvoiceExtraction(extraction as any)
      : validateBankStatementExtraction(extraction as any)

    const status = validation.ok ? 'parsed' : 'needs_review'
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('uploaded_documents')
      .update({
        extraction_tier: '2_ai',
        extraction_status: status,
        raw_extraction: extraction,
        validation_errors: validation.ok ? null : validation.issues,
        ai_approved_by: sessionUser.id,
        ai_approved_at: new Date().toISOString(),
        ai_input_tokens: inputTokens,
        ai_output_tokens: outputTokens,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    await logAuditEvent({
      actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
      actionType: 'update',
      module: 'reconciliation',
      tableName: 'uploaded_documents',
      recordId: id,
      recordLabel: `Tier 2 AI parse (${inputTokens}in/${outputTokens}out tokens) -> ${status}`,
    })

    return NextResponse.json({ status: 'parsed', document: updated, validation, tokens: { input: inputTokens, output: outputTokens } })
  } catch (e: any) {
    const message = e.message || 'AI extraction failed'
    await supabaseAdmin
      .from('uploaded_documents')
      .update({ extraction_status: 'failed', validation_errors: [{ field: 'ai_extraction', message }], updated_at: new Date().toISOString() })
      .eq('id', id)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

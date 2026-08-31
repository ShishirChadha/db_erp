import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- DELETE: remove an uploaded document (invoice or bank statement) ----------
// vendor_correction_proposals cascade-delete with the document (see FK constraints on
// uploaded_documents), so this is also how a bad upload / wrong file is cleanly undone.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data: doc, error: docErr } = await supabaseAdmin.from('uploaded_documents').select('*').eq('id', id).single()
  if (docErr || !doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  if (doc.doc_kind === 'bank_statement') {
    const { data: statement } = await supabaseAdmin.from('bank_statements').select('id').eq('document_id', id).maybeSingle()
    if (statement) {
      return NextResponse.json(
        { error: 'This bank statement has already been imported into transactions. Remove it from Bank Reconciliation first.' },
        { status: 409 }
      )
    }
  }

  const { error: deleteErr } = await supabaseAdmin.from('uploaded_documents').delete().eq('id', id)
  if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 })

  await supabaseAdmin.storage.from('documents').remove([doc.storage_path])

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'hard_delete',
    module: 'reconciliation',
    tableName: 'uploaded_documents',
    recordId: id,
    recordLabel: `Deleted uploaded document ${doc.file_name}`,
  })

  return NextResponse.json({ ok: true })
}

// ---------- PATCH: owner manually confirms a 'needs_review' extraction is correct ----------
// validate.ts flags a mismatch between the model's/template's own reported totals and
// the re-derived arithmetic -- but a mismatch isn't always wrong (e.g. a discount line
// or rounding the vendor itself applies outside the printed subtotal). Once the owner
// has actually checked the numbers by eye, this promotes the document to 'parsed' so
// "Save layout for this vendor" (which only accepts parsed/confirmed) becomes available
// -- without this, a needs_review document could never be learned from at all.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  if (body?.confirm_review !== true) {
    return NextResponse.json({ error: 'confirm_review: true is required.' }, { status: 400 })
  }

  const { id } = await params
  const { data: doc, error: docErr } = await supabaseAdmin.from('uploaded_documents').select('*').eq('id', id).single()
  if (docErr || !doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  if (doc.extraction_status !== 'needs_review') {
    return NextResponse.json({ error: 'Only a needs_review extraction can be manually confirmed.' }, { status: 400 })
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('uploaded_documents')
    .update({ extraction_status: 'parsed', updated_at: new Date().toISOString() })
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
    recordLabel: `Owner manually confirmed extraction as correct despite arithmetic mismatch: ${doc.file_name}`,
  })

  return NextResponse.json({ document: updated })
}

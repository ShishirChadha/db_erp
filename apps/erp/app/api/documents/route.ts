import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { probeDocument } from '@/lib/recon/pdf-text'

// ---------- POST: register an already-uploaded document and run Tier 0 (probe) ----------
// The client first gets a signed upload URL from /api/storage/upload-url (bucket
// 'documents') and PUTs the file directly to storage, same two-step pattern as
// AttachInvoiceFileDialog -- then calls this route with the resulting key. content_hash
// is computed here from the actual downloaded bytes, not trusted from the client, so a
// re-upload of the same file always dedupes correctly regardless of what the client claims.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const { key, file_name, mime_type, doc_kind } = body

  if (!key || !file_name || !doc_kind) {
    return NextResponse.json({ error: 'key, file_name and doc_kind are required.' }, { status: 400 })
  }
  if (!['vendor_invoice', 'bank_statement'].includes(doc_kind)) {
    return NextResponse.json({ error: 'doc_kind must be vendor_invoice or bank_statement.' }, { status: 400 })
  }

  const { data: fileBlob, error: downloadErr } = await supabaseAdmin.storage.from('documents').download(key)
  if (downloadErr || !fileBlob) {
    return NextResponse.json({ error: `Could not read uploaded file: ${downloadErr?.message || 'not found'}` }, { status: 400 })
  }
  const buffer = Buffer.from(await fileBlob.arrayBuffer())
  const contentHash = createHash('sha256').update(buffer).digest('hex')

  const { data: existing } = await supabaseAdmin
    .from('uploaded_documents')
    .select('id, file_name, extraction_status')
    .eq('content_hash', contentHash)
    .maybeSingle()
  if (existing) {
    // Not an error -- the caller (upload UI) surfaces this as "already uploaded,
    // opening the existing record" rather than silently duplicating it.
    return NextResponse.json({ duplicate: true, document: existing }, { status: 200 })
  }

  let probe
  try {
    probe = await probeDocument(buffer)
  } catch (e: any) {
    return NextResponse.json({ error: `Could not read PDF: ${e.message || e}` }, { status: 400 })
  }

  const { data: doc, error: insertErr } = await supabaseAdmin
    .from('uploaded_documents')
    .insert({
      doc_kind,
      storage_path: key,
      file_name,
      mime_type: mime_type || 'application/pdf',
      page_count: probe.pageCount,
      text_layer_chars: probe.textLayerChars,
      extraction_tier: '0_probe',
      extraction_status: 'probed',
      content_hash: contentHash,
      uploaded_by: sessionUser.id,
    })
    .select()
    .single()

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'reconciliation',
    tableName: 'uploaded_documents',
    recordId: doc.id,
    recordLabel: `${doc_kind}: ${file_name}`,
  })

  return NextResponse.json({
    duplicate: false,
    document: doc,
    likely_scanned: probe.likelyScanned,
  })
}

// ---------- GET: list uploaded documents ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const docKind = searchParams.get('doc_kind')

  let query = supabaseAdmin.from('uploaded_documents').select('*').order('created_at', { ascending: false })
  if (docKind) query = query.eq('doc_kind', docKind)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

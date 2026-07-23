import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { renderSalesDocumentPdf } from '@/lib/documents/renderSalesDocumentPdf'
import { sendEmailWithAttachment } from '@/lib/email'

const DOC_LABELS: Record<string, string> = { quotation: 'Quotation', proforma: 'Proforma Invoice' }

// ---------- POST: email a quotation/proforma PDF to the customer ----------
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const rendered = await renderSalesDocumentPdf(id)
  if (!rendered) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const to = body.to || rendered.document.customer_email
  if (!to) return NextResponse.json({ error: 'No recipient email on file for this customer -- provide one.' }, { status: 400 })

  const label = DOC_LABELS[rendered.document.doc_type] || 'Document'
  const result = await sendEmailWithAttachment({
    to,
    subject: `${label} ${rendered.document.document_number} from Digitalbluez`,
    html: `<p>Dear ${rendered.document.customer_name || 'Customer'},</p><p>Please find attached ${label.toLowerCase()} <strong>${rendered.document.document_number}</strong> for ₹${Number(rendered.document.grand_total).toFixed(2)}.</p><p>Thank you.</p>`,
    attachmentFilename: rendered.filename,
    attachmentBuffer: rendered.buffer,
  })

  await supabaseAdmin.from('document_sends').insert({
    document_type: 'sales_document',
    document_id: id,
    channel: 'email',
    sent_to: to,
    status: result.success ? 'sent' : 'failed',
    provider_message_id: result.messageId || null,
    error_message: result.error || null,
    sent_by: sessionUser.id,
  })

  if (!result.success) return NextResponse.json({ error: result.error }, { status: 502 })
  return NextResponse.json({ success: true, sent_to: to })
}

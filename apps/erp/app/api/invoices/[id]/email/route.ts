import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { renderInvoicePdf } from '@/lib/documents/renderInvoicePdf'
import { sendEmailWithAttachment } from '@/lib/email'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- POST: email an invoice PDF to the customer (or an override address) ----------
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const rendered = await renderInvoicePdf(id)
  if (!rendered) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  const to = body.to || rendered.invoice.customer_email
  if (!to) return NextResponse.json({ error: 'No recipient email on file for this customer -- provide one.' }, { status: 400 })

  const result = await sendEmailWithAttachment({
    to,
    subject: `Invoice ${rendered.invoice.invoice_number} from Digitalbluez`,
    html: `<p>Dear ${rendered.invoice.customer_name || 'Customer'},</p><p>Please find attached invoice <strong>${rendered.invoice.invoice_number}</strong> for ₹${Number(rendered.invoice.grand_total).toFixed(2)}.</p><p>Thank you for your business.</p>`,
    attachmentFilename: rendered.filename,
    attachmentBuffer: rendered.buffer,
  })

  const { data: sendRow } = await supabaseAdmin
    .from('document_sends')
    .insert({
      document_type: 'invoice',
      document_id: id,
      channel: 'email',
      sent_to: to,
      status: result.success ? 'sent' : 'failed',
      provider_message_id: result.messageId || null,
      error_message: result.error || null,
      sent_by: sessionUser.id,
    })
    .select('id')
    .single()

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'invoices',
    tableName: 'document_sends',
    recordId: sendRow?.id ?? null,
    recordLabel: `Invoice ${rendered.invoice.invoice_number} emailed to ${to}`,
    metadata: { invoice_id: id, status: result.success ? 'sent' : 'failed' },
  })

  if (!result.success) return NextResponse.json({ error: result.error }, { status: 502 })
  return NextResponse.json({ success: true, sent_to: to })
}

import { supabaseAdmin } from '@/lib/supabase/service'
import { renderSalesDocumentPdf } from '@/lib/documents/renderSalesDocumentPdf'
import { buildWhatsAppDirectLink, buildWhatsAppShareLink } from '@/lib/marketing/share-links'

// A PI/quotation the owner has approved, as something WhatsApp can carry: the
// PDF goes to the private `documents` bucket and gets a 7-day signed link (no
// login needed to open it, and it stops working after a week), and the message
// is pre-filled into a wa.me link. Nothing is sent automatically -- the owner
// (or whoever holds the phone) taps the link and presses send. No Meta Cloud
// API setup, no template approval, works from any WhatsApp number.
const LINK_DAYS = 7

export async function shareSalesDocument(documentId: string) {
  const { data: doc } = await supabaseAdmin
    .from('sales_documents')
    .select('id, doc_type, document_number, customer_name, customer_phone, grand_total, entity_key')
    .eq('id', documentId).maybeSingle()
  if (!doc) throw new Error('Document not found.')

  const rendered = await renderSalesDocumentPdf(documentId)
  if (!rendered) throw new Error('Could not render the PDF.')

  const path = `assistant-shares/${doc.id}/${rendered.filename}`
  const { error: upErr } = await supabaseAdmin.storage.from('documents')
    .upload(path, rendered.buffer, { contentType: 'application/pdf', upsert: true })
  if (upErr) throw new Error(upErr.message)
  const { data: signed, error: signErr } = await supabaseAdmin.storage.from('documents')
    .createSignedUrl(path, LINK_DAYS * 86400)
  if (signErr || !signed) throw new Error(signErr?.message || 'Could not create the PDF link.')

  const label = doc.doc_type === 'proforma' ? 'Proforma Invoice' : 'Quotation'
  const total = Number(doc.grand_total).toLocaleString('en-IN', { maximumFractionDigits: 2 })
  const message =
    `Dear ${doc.customer_name || 'Customer'},\n\n` +
    `Please find our ${label} ${doc.document_number} for ₹${total}.\n${signed.signedUrl}\n\n` +
    `(The link is valid for ${LINK_DAYS} days.)\n\nThank you,\nDigitalbluez`

  const digits = (doc.customer_phone || '').replace(/\D/g, '')
  const customerPhone = digits.length === 10 ? `91${digits}` : digits.length === 12 && digits.startsWith('91') ? digits : null
  return {
    document_number: doc.document_number,
    pdf_url: signed.signedUrl,
    whatsapp_to_customer: customerPhone ? buildWhatsAppDirectLink(customerPhone, message) : null,
    // "Send it to me first": the same message, choose the chat yourself.
    whatsapp_pick_chat: buildWhatsAppShareLink(message),
    customer_has_phone: !!customerPhone,
  }
}

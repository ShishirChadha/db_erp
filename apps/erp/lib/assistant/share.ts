import { supabaseAdmin } from '@/lib/supabase/service'
import { renderSalesDocumentPdf } from '@/lib/documents/renderSalesDocumentPdf'
import { buildWhatsAppDirectLink, buildWhatsAppShareLink } from '@/lib/marketing/share-links'
import { randomInt } from 'crypto'

// A PI/quotation the owner has approved, as something WhatsApp can carry: the
// PDF goes to the private `documents` bucket, and the message carries a short
// link on the shop's website -- digitalbluez.com/d/<code> (2026-11-24; it used
// to paste a ~300-character signed URL). That page shows the document's title
// (WhatsApp turns it into a preview card) and opens the PDF through a fresh
// signed URL; the code stops working after LINK_DAYS. The message is
// pre-filled into a wa.me link. Nothing is sent automatically -- the owner (or
// whoever holds the phone) taps the link and presses send. No Meta Cloud API
// setup, no template approval, works from any WhatsApp number.
const LINK_DAYS = 30
const STOREFRONT = (process.env.NEXT_PUBLIC_STOREFRONT_URL || 'https://www.digitalbluez.com').replace(/\/+$/, '') // www: the bare domain 308-redirects there, and previews are surer without the hop
// 10 letters from a 32-character alphabet without look-alikes (no 0/1/l/o).
const CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
const newCode = () => Array.from({ length: 10 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')

export async function shareSalesDocument(documentId: string, createdBy: string | null = null) {
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
  const label = doc.doc_type === 'proforma' ? 'Proforma Invoice' : 'Quotation'
  let code = ''
  for (let attempt = 0; attempt < 3 && !code; attempt++) {
    const candidate = newCode()
    const { error } = await supabaseAdmin.from('document_share_links').insert({
      code: candidate, document_id: doc.id, storage_path: path,
      title: `${label} ${doc.document_number}`,
      expires_at: new Date(Date.now() + LINK_DAYS * 86400_000).toISOString(),
      created_by: createdBy,
    })
    if (!error) code = candidate
    else if (error.code !== '23505') throw new Error(error.message)
  }
  if (!code) throw new Error('Could not create the PDF link.')
  const link = `${STOREFRONT}/d/${code}`

  const total = Number(doc.grand_total).toLocaleString('en-IN', { maximumFractionDigits: 2 })
  const message =
    `Dear ${doc.customer_name || 'Customer'},\n\n` +
    `Please find our ${label} ${doc.document_number} for ₹${total}:\n${link}\n\n` +
    `Thank you,\nDigitalbluez`

  const digits = (doc.customer_phone || '').replace(/\D/g, '')
  const customerPhone = digits.length === 10 ? `91${digits}` : digits.length === 12 && digits.startsWith('91') ? digits : null
  return {
    document_number: doc.document_number,
    pdf_url: link,
    whatsapp_to_customer: customerPhone ? buildWhatsAppDirectLink(customerPhone, message) : null,
    // "Send it to me first": the same message, choose the chat yourself.
    whatsapp_pick_chat: buildWhatsAppShareLink(message),
    customer_has_phone: !!customerPhone,
  }
}

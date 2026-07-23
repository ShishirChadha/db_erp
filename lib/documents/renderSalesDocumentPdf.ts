import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabaseAdmin } from '@/lib/supabase/service'
import { STATE_CODE_TO_NAME } from '@/lib/gstStateCodes'

const DOC_LABELS: Record<string, string> = {
  quotation: 'QUOTATION',
  proforma: 'PROFORMA INVOICE',
}

export interface RenderedSalesDocumentPdf {
  buffer: ArrayBuffer
  document: any
  filename: string
}

// Shared renderer used by both the direct-download route and the
// email-send route.
export async function renderSalesDocumentPdf(documentId: string): Promise<RenderedSalesDocumentPdf | null> {
  const { data: doc, error: docErr } = await supabaseAdmin.from('sales_documents').select('*').eq('id', documentId).single()
  if (docErr || !doc) return null

  const { data: items } = await supabaseAdmin
    .from('sales_document_items')
    .select('*')
    .eq('sales_document_id', documentId)
    .order('created_at', { ascending: true })

  const { data: entity } = await supabaseAdmin.from('business_profiles').select('*').eq('key', doc.entity_key).single()
  const isGst = !!entity?.is_gst_registered

  const pdf = new jsPDF()
  const pageWidth = pdf.internal.pageSize.getWidth()
  const margin = 14
  let y = 18

  pdf.setFontSize(15)
  pdf.setFont('helvetica', 'bold')
  pdf.text(entity?.legal_name || 'Digitalbluez Technologies Private Limited', margin, y)
  pdf.setFontSize(9)
  pdf.setFont('helvetica', 'normal')
  if (entity?.address) { y += 6; pdf.text(entity.address, margin, y) }
  if (isGst && entity?.gstin) { y += 5.5; pdf.text(`GSTIN: ${entity.gstin}`, margin, y) }

  pdf.setFontSize(13)
  pdf.setFont('helvetica', 'bold')
  pdf.text(DOC_LABELS[doc.doc_type] || 'DOCUMENT', pageWidth - margin, 18, { align: 'right' })
  pdf.setFontSize(8)
  pdf.setFont('helvetica', 'italic')
  pdf.text('Not a Tax Invoice', pageWidth - margin, 24, { align: 'right' })
  pdf.setFont('helvetica', 'normal')

  pdf.line(margin, y + 5, pageWidth - margin, y + 5)
  y += 14

  pdf.setFontSize(9.5)
  pdf.text(`${doc.doc_type === 'quotation' ? 'Quotation' : 'Proforma'} No: ${doc.document_number}`, margin, y)
  pdf.text(`Date: ${doc.document_date}`, pageWidth - margin, y, { align: 'right' })
  y += 6
  if (doc.valid_until) { pdf.text(`Valid Until: ${doc.valid_until}`, margin, y); y += 6 }
  if (doc.place_of_supply) {
    const label = STATE_CODE_TO_NAME[doc.place_of_supply] || doc.place_of_supply
    pdf.text(`Place of Supply: ${label} (${doc.place_of_supply})`, margin, y)
    y += 6
  }

  y += 4
  pdf.setFont('helvetica', 'bold')
  pdf.text('To:', margin, y)
  pdf.setFont('helvetica', 'normal')
  y += 5.5
  pdf.text(doc.customer_name || 'Customer', margin, y)
  if (doc.customer_address) { y += 5; pdf.text(doc.customer_address, margin, y) }
  if (isGst && doc.customer_gst) { y += 5; pdf.text(`GSTIN: ${doc.customer_gst}`, margin, y) }

  const rows = items || []
  const head = isGst
    ? [['#', 'Description', 'HSN', 'Qty', 'Rate', 'GST%', 'Tax', 'Amount']]
    : [['#', 'Description', 'HSN', 'Qty', 'Rate', 'Amount']]

  const body = rows.map((item: any, idx: number) => {
    const taxLabel = item.gst_type === 'IGST'
      ? `IGST ₹${Number(item.igst_amount || 0).toFixed(2)}`
      : item.gst_type === 'CGST_SGST'
        ? `C ₹${Number(item.cgst_amount || 0).toFixed(2)} / S ₹${Number(item.sgst_amount || 0).toFixed(2)}`
        : '-'
    return isGst
      ? [String(idx + 1), item.description, item.hsn_code || '-', String(item.quantity), `₹${Number(item.rate).toFixed(2)}`, `${item.gst_rate || 0}%`, taxLabel, `₹${Number(item.amount).toFixed(2)}`]
      : [String(idx + 1), item.description, item.hsn_code || '-', String(item.quantity), `₹${Number(item.rate).toFixed(2)}`, `₹${Number(item.amount).toFixed(2)}`]
  })

  autoTable(pdf, {
    startY: y + 8,
    head,
    body,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [15, 111, 184], textColor: 255, fontSize: 8 },
    styles: { fontSize: 8 },
  })

  let finalY = (pdf as any).lastAutoTable.finalY + 8
  pdf.setFontSize(9.5)
  pdf.text(`Subtotal: ₹${Number(doc.subtotal || 0).toFixed(2)}`, pageWidth - margin, finalY, { align: 'right' })
  if (isGst) {
    finalY += 5.5
    pdf.text(`Estimated GST: ₹${Number(doc.total_gst || 0).toFixed(2)}`, pageWidth - margin, finalY, { align: 'right' })
  }
  finalY += 6.5
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.text(`Total: ₹${Number(doc.grand_total || 0).toFixed(2)}`, pageWidth - margin, finalY, { align: 'right' })
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)

  finalY += 12
  if (doc.notes) {
    pdf.setFont('helvetica', 'bold'); pdf.text('Notes:', margin, finalY); pdf.setFont('helvetica', 'normal')
    finalY += 5; pdf.text(pdf.splitTextToSize(doc.notes, pageWidth - margin * 2), margin, finalY)
    finalY += 10
  }
  if (doc.terms_conditions) {
    pdf.setFont('helvetica', 'bold'); pdf.text('Terms & Conditions:', margin, finalY); pdf.setFont('helvetica', 'normal')
    finalY += 5; pdf.text(pdf.splitTextToSize(doc.terms_conditions, pageWidth - margin * 2), margin, finalY)
  }

  pdf.setFontSize(7.5)
  pdf.setTextColor(140, 140, 140)
  pdf.text(
    doc.doc_type === 'quotation'
      ? 'This is a price estimate, not a tax invoice. Prices subject to change until an order is confirmed.'
      : 'This is a proforma invoice for reference/advance-payment purposes only, not a tax invoice.',
    pageWidth / 2, pdf.internal.pageSize.getHeight() - 8, { align: 'center' }
  )

  return {
    buffer: pdf.output('arraybuffer'),
    document: doc,
    filename: `${doc.doc_type}_${doc.document_number.replace(/\//g, '-')}.pdf`,
  }
}

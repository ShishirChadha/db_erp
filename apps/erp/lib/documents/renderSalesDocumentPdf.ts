import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabaseAdmin } from '@/lib/supabase/service'
import { STATE_CODE_TO_NAME } from '@/lib/gstStateCodes'

const DOC_LABELS: Record<string, string> = {
  quotation: 'QUOTATION',
  proforma: 'PROFORMA INVOICE',
}

// jsPDF's built-in Helvetica has no ₹ glyph -- it silently substitutes an
// unrelated character (renders as "¹") rather than erroring, so every amount
// on the generated PDF was subtly wrong. "Rs." avoids embedding a custom
// Unicode font just for the currency symbol.
function money(n: number): string {
  return `Rs. ${Number(n || 0).toFixed(2)}`
}

function filenameSafe(s: string): string {
  return (s || 'Customer').trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'Customer'
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
  // HSN/GST%/Tax columns are only meaningful for a GST-registered entity --
  // showing them (even blank) on a non-GST document implies a tax treatment
  // that doesn't apply.
  const head = isGst
    ? [['#', 'Description', 'HSN', 'Qty', 'Rate', 'GST%', 'Tax', 'Amount']]
    : [['#', 'Description', 'Qty', 'Rate', 'Amount']]

  const body = rows.map((item: any, idx: number) => {
    const taxLabel = item.gst_type === 'IGST'
      ? `IGST ${money(item.igst_amount)}`
      : item.gst_type === 'CGST_SGST'
        ? `C ${money(item.cgst_amount)} / S ${money(item.sgst_amount)}`
        : '-'
    return isGst
      ? [String(idx + 1), item.description, item.hsn_code || '-', String(item.quantity), money(item.rate), `${item.gst_rate || 0}%`, taxLabel, money(item.amount)]
      : [String(idx + 1), item.description, String(item.quantity), money(item.rate), money(item.amount)]
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
  pdf.text(`Subtotal: ${money(doc.subtotal)}`, pageWidth - margin, finalY, { align: 'right' })
  if (isGst) {
    finalY += 5.5
    pdf.text(`Estimated GST: ${money(doc.total_gst)}`, pageWidth - margin, finalY, { align: 'right' })
  }
  finalY += 6.5
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.text(`Total: ${money(doc.grand_total)}`, pageWidth - margin, finalY, { align: 'right' })
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)

  finalY += 12
  // splitTextToSize wraps to however many lines the text needs -- advancing
  // finalY by a fixed amount regardless of that line count is what caused
  // Terms & Conditions to overlap a multi-line Notes block.
  const lineHeight = 4.2
  if (doc.notes) {
    pdf.setFont('helvetica', 'bold'); pdf.text('Notes:', margin, finalY); pdf.setFont('helvetica', 'normal')
    finalY += 5
    const noteLines = pdf.splitTextToSize(doc.notes, pageWidth - margin * 2)
    pdf.text(noteLines, margin, finalY)
    finalY += noteLines.length * lineHeight + 6
  }
  if (doc.terms_conditions) {
    pdf.setFont('helvetica', 'bold'); pdf.text('Terms & Conditions:', margin, finalY); pdf.setFont('helvetica', 'normal')
    finalY += 5
    const termLines = pdf.splitTextToSize(doc.terms_conditions, pageWidth - margin * 2)
    pdf.text(termLines, margin, finalY)
    finalY += termLines.length * lineHeight
  }

  pdf.setFontSize(7.5)
  pdf.setTextColor(140, 140, 140)
  pdf.text(
    doc.doc_type === 'quotation'
      ? 'This is a price estimate, not a tax invoice. Prices subject to change until an order is confirmed.'
      : 'This is a proforma invoice for reference/advance-payment purposes only, not a tax invoice.',
    pageWidth / 2, pdf.internal.pageSize.getHeight() - 8, { align: 'center' }
  )

  const docLabel = doc.doc_type === 'quotation' ? 'Quotation' : 'Proforma'
  return {
    buffer: pdf.output('arraybuffer'),
    document: doc,
    filename: `${docLabel}_${filenameSafe(doc.customer_name)}_${doc.document_number.replace(/\//g, '-')}.pdf`,
  }
}

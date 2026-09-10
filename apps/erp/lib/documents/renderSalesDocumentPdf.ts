import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabaseAdmin } from '@/lib/supabase/service'
import { STATE_CODE_TO_NAME } from '@/lib/gstStateCodes'
import { fetchEntityBranding, fitWithinBox, type EntityImage } from '@/lib/documents/entityBranding'

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

const BORDER_GRAY: [number, number, number] = [200, 200, 200]

// Draws an image fitted (aspect-preserved, centered) within a box instead of
// stretching it to fill exact dimensions -- a source QR/logo/signature is
// rarely exactly the box's aspect ratio, and force-stretching it is what made
// a QR code unreadable and logos look distorted.
function drawFitted(pdf: jsPDF, image: EntityImage, boxX: number, boxY: number, boxW: number, boxH: number) {
  const props = pdf.getImageProperties(image.bytes)
  const { w, h } = fitWithinBox(props.width, props.height, boxW, boxH)
  pdf.addImage(image.bytes, image.format, boxX + (boxW - w) / 2, boxY + (boxH - h) / 2, w, h)
}

// Shared renderer used by both the direct-download route and the email-send
// route. Layout mirrors renderInvoicePdf.ts's boxed Zoho-style template (logo
// + big title top, a bordered meta strip, boxed To/Ship To, a gridded item
// table, totals box + signature bottom-right) so Quotations/Proforma look
// consistent with real invoices rather than a plain freeform layout.
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
  const branding = await fetchEntityBranding(entity)
  const bank = entity?.bank_details as Record<string, string> | null

  const pdf = new jsPDF()
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 14
  const contentW = pageWidth - margin * 2

  // ---------- Header: logo + seller block left, big doc title right ----------
  const logoW = 34
  const logoH = 20
  const textX = branding.logo ? margin + logoW + 6 : margin
  if (branding.logo) drawFitted(pdf, branding.logo, margin, 12, logoW, logoH)

  // The company-name/address column must stop before the big title's actual
  // rendered width, not a guessed constant -- "Digitalbluez Technologies
  // Private Limited" next to a 20pt bold "QUOTATION"/"PROFORMA INVOICE" title
  // is exactly the case a fixed guess got wrong (their horizontal zones
  // genuinely overlapped), so the reserved gap is measured via getTextWidth.
  const titleText = DOC_LABELS[doc.doc_type] || 'DOCUMENT'
  pdf.setFontSize(20)
  pdf.setFont('helvetica', 'bold')
  const titleWidth = pdf.getTextWidth(titleText)

  // splitTextToSize wraps to however many lines the text actually needs --
  // using jsPDF's `maxWidth` text option wraps visually but doesn't report
  // how many lines it used, so a fixed y-advance after it let a wrapped
  // second line of the company name run straight into the address below it.
  // Measuring lines up front and advancing by the real count fixes it.
  const headerTextW = pageWidth - margin - textX - titleWidth - 8
  let y = 18
  pdf.setFontSize(14)
  pdf.setFont('helvetica', 'bold')
  const nameLines = pdf.splitTextToSize(entity?.legal_name || 'Digitalbluez Technologies Private Limited', headerTextW)
  pdf.text(nameLines, textX, y)
  y += (nameLines.length - 1) * 5.5
  pdf.setFontSize(8.5)
  pdf.setFont('helvetica', 'normal')
  if (entity?.address) {
    y += 5.5
    const addrLines2 = pdf.splitTextToSize(entity.address, headerTextW)
    pdf.text(addrLines2, textX, y)
    y += (addrLines2.length - 1) * 4.2
  }
  if (isGst && entity?.gstin) { y += 4.8; pdf.text(`GSTIN: ${entity.gstin}`, textX, y) }

  pdf.setFontSize(20)
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(90, 90, 90)
  pdf.text(titleText, pageWidth - margin, 22, { align: 'right' })
  pdf.setFontSize(8)
  pdf.setFont('helvetica', 'italic')
  pdf.text('Not a Tax Invoice', pageWidth - margin, 28, { align: 'right' })
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(0, 0, 0)

  const headerBottom = Math.max(36, y + 6)
  pdf.setDrawColor(...BORDER_GRAY)
  pdf.line(margin, headerBottom, pageWidth - margin, headerBottom)

  // ---------- Meta strip: #/Date left, Place of Supply right, boxed ----------
  const metaY = headerBottom + 4
  const metaH = 14
  pdf.rect(margin, metaY, contentW, metaH)
  pdf.line(margin + contentW * 0.55, metaY, margin + contentW * 0.55, metaY + metaH)
  pdf.setFontSize(9)
  pdf.setFont('helvetica', 'bold')
  pdf.text('#', margin + 3, metaY + 5.5)
  pdf.text(doc.doc_type === 'quotation' ? 'Date' : 'Date', margin + 3, metaY + 11)
  pdf.setFont('helvetica', 'normal')
  pdf.text(`: ${doc.document_number}`, margin + 16, metaY + 5.5)
  pdf.text(`: ${doc.document_date}`, margin + 16, metaY + 11)
  if (doc.place_of_supply) {
    const label = STATE_CODE_TO_NAME[doc.place_of_supply] || doc.place_of_supply
    pdf.setFont('helvetica', 'bold')
    pdf.text('Place Of Supply', margin + contentW * 0.55 + 4, metaY + 5.5)
    pdf.setFont('helvetica', 'normal')
    pdf.text(`: ${label} (${doc.place_of_supply})`, margin + contentW * 0.55 + 34, metaY + 5.5)
  }
  if (doc.valid_until) {
    pdf.setFont('helvetica', 'bold')
    pdf.text('Valid Until', margin + contentW * 0.55 + 4, metaY + 11)
    pdf.setFont('helvetica', 'normal')
    pdf.text(`: ${doc.valid_until}`, margin + contentW * 0.55 + 34, metaY + 11)
  }

  // ---------- To box ----------
  // Box height is measured from actual wrapped line counts (not a fixed
  // guess) so a long customer address never overflows the border and runs
  // into the item table below it.
  const boxY = metaY + metaH + 4
  const toLines: string[] = []
  if (doc.customer_address) toLines.push(...pdf.splitTextToSize(doc.customer_address, contentW - 6))
  if (doc.customer_phone) toLines.push(`Mobile: ${doc.customer_phone}`)
  if (isGst && doc.customer_gst) toLines.push(`GSTIN: ${doc.customer_gst}`)
  const boxH = Math.max(26, 10 + toLines.length * 4 + 3)

  pdf.setFillColor(245, 245, 245)
  pdf.rect(margin, boxY, contentW, 6, 'F')
  pdf.setDrawColor(...BORDER_GRAY)
  pdf.rect(margin, boxY, contentW, boxH)
  pdf.setFontSize(8.5)
  pdf.setFont('helvetica', 'bold')
  pdf.text('To', margin + 3, boxY + 4.2)

  let toY = boxY + 10
  pdf.setFont('helvetica', 'bold')
  pdf.text(doc.customer_name || 'Customer', margin + 3, toY)
  pdf.setFont('helvetica', 'normal')
  toLines.forEach((line) => { toY += 4; pdf.text(line, margin + 3, toY) })

  // ---------- Line items ----------
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
    startY: boxY + boxH + 6,
    head,
    body,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [245, 245, 245], textColor: 30, fontStyle: 'bold', fontSize: 8, lineColor: BORDER_GRAY, lineWidth: 0.2 },
    bodyStyles: { lineColor: BORDER_GRAY, lineWidth: 0.2 },
    styles: { fontSize: 8 },
  })

  let finalY = (pdf as any).lastAutoTable.finalY + 6

  // ---------- Bottom-left: notes/terms/bank/UPI/QR ----------
  // ---------- Bottom-right: bordered totals box + signature/stamp ----------
  const leftW = contentW * 0.58
  const rightX = margin + leftW + 6
  const rightW = contentW - leftW - 6
  const lineHeight = 4.2

  // Right column (totals + signature) is drawn first, anchored to `finalY` on
  // this page, before the left column below -- the left column's Notes/Terms
  // can run long enough to trigger a page break (see ensureRoom below), and
  // doing the right column afterward would draw it onto whatever page jsPDF's
  // cursor happened to be on by then instead of staying with the item table.
  const totalsRows: [string, string][] = [['Subtotal', money(doc.subtotal)]]
  if (isGst) totalsRows.push(['Estimated GST', money(doc.total_gst)])
  autoTable(pdf, {
    startY: finalY,
    body: totalsRows,
    margin: { left: rightX, right: margin },
    tableWidth: rightW,
    theme: 'grid',
    styles: { fontSize: 8.5, lineColor: BORDER_GRAY, lineWidth: 0.2, cellPadding: 2 },
    columnStyles: { 1: { halign: 'right' } },
  })
  const totalsY = (pdf as any).lastAutoTable.finalY
  autoTable(pdf, {
    startY: totalsY,
    body: [['Total', money(doc.grand_total)]],
    margin: { left: rightX, right: margin },
    tableWidth: rightW,
    theme: 'grid',
    styles: { fontSize: 10, fontStyle: 'bold', lineColor: BORDER_GRAY, lineWidth: 0.2, cellPadding: 2.5 },
    columnStyles: { 1: { halign: 'right' } },
  })
  let sigY = (pdf as any).lastAutoTable.finalY + 10

  // Stamp/signature centered under the totals box, "Authorized Signatory"
  // label beneath -- absent images just leave the space blank.
  if (branding.signature || branding.stamp) {
    const sigBoxW = 26
    const sigBoxH = 17
    const gap = 3
    const totalW = (branding.stamp ? sigBoxW : 0) + (branding.signature ? sigBoxW : 0) + (branding.stamp && branding.signature ? gap : 0)
    let sigX = rightX + (rightW - totalW) / 2
    if (branding.stamp) { drawFitted(pdf, branding.stamp, sigX, sigY, sigBoxW, sigBoxH); sigX += sigBoxW + gap }
    if (branding.signature) drawFitted(pdf, branding.signature, sigX, sigY, sigBoxW, sigBoxH)
    sigY += sigBoxH + 4
  } else {
    sigY += 10
  }
  pdf.setFontSize(8)
  pdf.setFont('helvetica', 'normal')
  pdf.text('Authorized Signatory', rightX + rightW / 2, sigY, { align: 'center' })

  let leftY = finalY
  const BOTTOM_MARGIN = 16
  // Real Terms & Conditions/Bank Details text on this business's documents
  // routinely runs to 8-12 wrapped lines -- with nothing checking remaining
  // page space, that content (or the QR box after it) could run straight off
  // the bottom of the page and collide with the footer disclaimer. Adding a
  // page when a block won't fit keeps every block fully on one page or the
  // next, never straddling/overlapping the boundary.
  const ensureRoom = (neededHeight: number) => {
    if (leftY + neededHeight > pageHeight - BOTTOM_MARGIN) {
      pdf.addPage()
      leftY = 20
    }
  }
  const writeBlock = (label: string, text: string) => {
    const lines = pdf.splitTextToSize(text, leftW)
    ensureRoom(4.2 + lines.length * lineHeight + 3.5)
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5)
    pdf.text(label, margin, leftY)
    pdf.setFont('helvetica', 'normal')
    leftY += 4.2
    pdf.text(lines, margin, leftY)
    leftY += lines.length * lineHeight + 3.5
  }

  if (doc.notes) writeBlock('Notes', doc.notes)
  if (bank?.bank_name) {
    writeBlock('Bank Details',
      `A/C Holder: ${bank.account_holder_name || ''}\nBank: ${bank.bank_name}\nA/c No.: ${bank.account_number || ''}\nIFSC: ${bank.ifsc_code || ''}`
    )
  }
  if (entity?.upi_id) { ensureRoom(5); pdf.setFontSize(8.5); pdf.text(`UPI ID: ${entity.upi_id}`, margin, leftY); leftY += 5 }
  if (doc.terms_conditions) writeBlock('Terms & Conditions', doc.terms_conditions)

  if (branding.qrCode) {
    // A fixed 28x28 box with a visible border -- large enough to stay
    // scannable, aspect-preserved via drawFitted so a non-square source
    // image (quiet-zone margins baked in unevenly) doesn't get squashed.
    const qrBox = 28
    ensureRoom(qrBox + 8)
    pdf.setDrawColor(...BORDER_GRAY)
    pdf.rect(margin, leftY, qrBox, qrBox)
    drawFitted(pdf, branding.qrCode, margin, leftY, qrBox, qrBox)
    pdf.setFontSize(7)
    pdf.setTextColor(120, 120, 120)
    pdf.text('Scan to pay', margin + qrBox / 2, leftY + qrBox + 4, { align: 'center' })
    pdf.setTextColor(0, 0, 0)
    leftY += qrBox + 8
  }

  pdf.setFontSize(7.5)
  pdf.setTextColor(140, 140, 140)
  pdf.text(
    doc.doc_type === 'quotation'
      ? 'This is a price estimate, not a tax invoice. Prices subject to change until an order is confirmed.'
      : 'This is a proforma invoice for reference/advance-payment purposes only, not a tax invoice.',
    pageWidth / 2, pageHeight - 8, { align: 'center' }
  )

  const docLabel = doc.doc_type === 'quotation' ? 'Quotation' : 'Proforma'
  return {
    buffer: pdf.output('arraybuffer'),
    document: doc,
    filename: `${docLabel}_${filenameSafe(doc.customer_name)}_${doc.document_number.replace(/\//g, '-')}.pdf`,
  }
}

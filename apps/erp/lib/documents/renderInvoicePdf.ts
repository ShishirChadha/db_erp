import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabaseAdmin } from '@/lib/supabase/service'
import { STATE_CODE_TO_NAME } from '@/lib/gstStateCodes'
import { fetchEntityBranding, fitWithinBox, type EntityImage } from '@/lib/documents/entityBranding'

function amountInWords(n: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

  function twoDigits(num: number): string {
    if (num < 20) return ones[num]
    return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '')
  }
  function threeDigits(num: number): string {
    if (num < 100) return twoDigits(num)
    return ones[Math.floor(num / 100)] + ' Hundred' + (num % 100 ? ' ' + twoDigits(num % 100) : '')
  }

  const rupees = Math.floor(n)
  if (rupees === 0) return 'Zero'

  const crore = Math.floor(rupees / 10000000)
  const lakh = Math.floor((rupees % 10000000) / 100000)
  const thousand = Math.floor((rupees % 100000) / 1000)
  const hundred = rupees % 1000

  const parts: string[] = []
  if (crore) parts.push(threeDigits(crore) + ' Crore')
  if (lakh) parts.push(threeDigits(lakh) + ' Lakh')
  if (thousand) parts.push(threeDigits(thousand) + ' Thousand')
  if (hundred) parts.push(threeDigits(hundred))

  return parts.join(' ')
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

export interface RenderedInvoicePdf {
  buffer: ArrayBuffer
  invoice: any
  filename: string
}

const BORDER_GRAY: [number, number, number] = [200, 200, 200]

// Draws an image fitted (aspect-preserved, centered) within a box instead of
// stretching it to fill exact dimensions -- a source QR/logo/signature is
// rarely exactly the box's aspect ratio, and force-stretching it (the old
// behavior) is what made the QR unreadable and logos look distorted.
function drawFitted(doc: jsPDF, image: EntityImage, boxX: number, boxY: number, boxW: number, boxH: number): { w: number; h: number } {
  const props = doc.getImageProperties(image.bytes)
  const { w, h } = fitWithinBox(props.width, props.height, boxW, boxH)
  doc.addImage(image.bytes, image.format, boxX + (boxW - w) / 2, boxY + (boxH - h) / 2, w, h)
  return { w, h }
}

// Shared renderer used by both the direct-download route and the email-send
// route, so there is exactly one place that draws an invoice PDF. Layout
// mirrors the boxed Zoho-style template the business used before the ERP
// took over invoicing (logo + big title top, a bordered meta strip, boxed
// Bill To/Ship To, a gridded item table, and a totals box + signature at
// bottom-right) so switching from Zoho to the ERP doesn't change what staff
// and customers are used to seeing.
export async function renderInvoicePdf(invoiceId: string): Promise<RenderedInvoicePdf | null> {
  const { data: invoice, error: invErr } = await supabaseAdmin
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .single()

  if (invErr || !invoice) return null

  const { data: items } = await supabaseAdmin
    .from('invoice_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: true })

  const { data: entity } = await supabaseAdmin
    .from('business_profiles')
    .select('*')
    .eq('key', invoice.entity_key || 'digitalbluez')
    .single()

  const isGst = !!entity?.is_gst_registered
  const branding = await fetchEntityBranding(entity)
  const bank = entity?.bank_details as Record<string, string> | null

  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 14
  const contentW = pageWidth - margin * 2

  // ---------- Header: logo + seller block left, big doc title right ----------
  const logoW = 34
  const logoH = 20
  const textX = branding.logo ? margin + logoW + 6 : margin
  if (branding.logo) drawFitted(doc, branding.logo, margin, 12, logoW, logoH)

  // splitTextToSize wraps to however many lines the text actually needs --
  // using jsPDF's `maxWidth` text option wraps visually but doesn't report
  // how many lines it used, so a fixed y-advance after it (the old code) let
  // a wrapped second line of the company name run straight into the address
  // below it. Measuring lines up front and advancing by the real count fixes
  // it, same principle already applied to Notes/Terms further down this file.
  const headerTextW = pageWidth - margin - textX - 46
  let y = 18
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  const nameLines = doc.splitTextToSize(entity?.legal_name || 'Digitalbluez Technologies Private Limited', headerTextW)
  doc.text(nameLines, textX, y)
  y += (nameLines.length - 1) * 5.5
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'normal')
  if (entity?.address) {
    y += 5.5
    const addrLines = doc.splitTextToSize(entity.address, headerTextW)
    doc.text(addrLines, textX, y)
    y += (addrLines.length - 1) * 4.2
  }
  if (isGst && entity?.gstin) { y += 4.8; doc.text(`GSTIN: ${entity.gstin}`, textX, y) }

  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(90, 90, 90)
  doc.text(isGst ? 'TAX INVOICE' : 'BILL OF SUPPLY', pageWidth - margin, 24, { align: 'right' })
  doc.setTextColor(0, 0, 0)

  const headerBottom = Math.max(36, y + 6)
  doc.setDrawColor(...BORDER_GRAY)
  doc.line(margin, headerBottom, pageWidth - margin, headerBottom)

  // ---------- Meta strip: #/Date left, Place of Supply right, boxed ----------
  const metaY = headerBottom + 4
  const metaH = 14
  doc.rect(margin, metaY, contentW, metaH)
  doc.line(margin + contentW * 0.55, metaY, margin + contentW * 0.55, metaY + metaH)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('#', margin + 3, metaY + 5.5)
  doc.text('Date', margin + 3, metaY + 11)
  doc.setFont('helvetica', 'normal')
  doc.text(`: ${invoice.invoice_number}`, margin + 16, metaY + 5.5)
  doc.text(`: ${invoice.invoice_date}`, margin + 16, metaY + 11)
  if (invoice.place_of_supply) {
    const label = STATE_CODE_TO_NAME[invoice.place_of_supply] || invoice.place_of_supply
    doc.setFont('helvetica', 'bold')
    doc.text('Place Of Supply', margin + contentW * 0.55 + 4, metaY + 8.5)
    doc.setFont('helvetica', 'normal')
    doc.text(`: ${label} (${invoice.place_of_supply})`, margin + contentW * 0.55 + 34, metaY + 8.5)
  }

  // ---------- Bill To / Ship To boxes ----------
  const boxY = metaY + metaH + 4
  const halfW = contentW / 2
  const addrLines = (address: string | null, gst: string | null) => {
    const lines: string[] = []
    if (address) lines.push(...doc.splitTextToSize(address, halfW - 6))
    if (isGst && gst) lines.push(`GSTIN: ${gst}`)
    return lines
  }
  // Box height is measured from actual wrapped line counts (not a fixed guess)
  // so a long customer address never overflows the border and runs into the
  // item table below it.
  const billRest = addrLines(invoice.customer_address, invoice.customer_gst)
  const shipAddress = invoice.shipping_address || invoice.customer_address
  const shipRest = addrLines(shipAddress, null)
  const boxH = Math.max(30, 10 + Math.max(billRest.length, shipRest.length) * 4 + 3)

  doc.setFillColor(245, 245, 245)
  doc.rect(margin, boxY, halfW, 6, 'F')
  doc.rect(margin + halfW, boxY, halfW, 6, 'F')
  doc.setDrawColor(...BORDER_GRAY)
  doc.rect(margin, boxY, halfW, boxH)
  doc.rect(margin + halfW, boxY, halfW, boxH)
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bold')
  doc.text('Bill To', margin + 3, boxY + 4.2)
  doc.text('Ship To', margin + halfW + 3, boxY + 4.2)

  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bold')
  let billLineY = boxY + 10
  doc.text(invoice.customer_name || 'Customer', margin + 3, billLineY)
  doc.setFont('helvetica', 'normal')
  billRest.forEach((line) => { billLineY += 4; doc.text(line, margin + 3, billLineY) })

  let shipLineY = boxY + 10
  doc.setFont('helvetica', 'bold')
  doc.text(invoice.customer_name || 'Customer', margin + halfW + 3, shipLineY)
  doc.setFont('helvetica', 'normal')
  shipRest.forEach((line) => { shipLineY += 4; doc.text(line, margin + halfW + 3, shipLineY) })

  // ---------- Line items ----------
  const lineItems = items || []
  // HSN/GST%/Tax columns are only meaningful for a GST-registered entity --
  // showing them (even blank) on a non-GST document implies a tax treatment
  // that doesn't apply.
  const head = isGst
    ? [['#', 'Description', 'HSN', 'Qty', 'Rate', 'GST%', 'Tax', 'Amount']]
    : [['#', 'Description', 'Qty', 'Rate', 'Amount']]

  const body = lineItems.map((item: any, idx: number) => {
    const taxLabel = item.gst_type === 'IGST'
      ? `IGST ${money(item.igst_amount)}`
      : item.gst_type === 'CGST_SGST'
        ? `C ${money(item.cgst_amount)} / S ${money(item.sgst_amount)}`
        : '-'
    return isGst
      ? [String(idx + 1), item.description, item.hsn_code || '-', String(item.quantity), money(item.rate), `${item.gst_rate || 0}%`, taxLabel, money(item.amount)]
      : [String(idx + 1), item.description, String(item.quantity), money(item.rate), money(item.amount)]
  })

  autoTable(doc, {
    startY: boxY + boxH + 6,
    head,
    body,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [245, 245, 245], textColor: 30, fontStyle: 'bold', fontSize: 8, lineColor: BORDER_GRAY, lineWidth: 0.2 },
    bodyStyles: { lineColor: BORDER_GRAY, lineWidth: 0.2 },
    styles: { fontSize: 8 },
  })

  let finalY = (doc as any).lastAutoTable.finalY + 6

  // ---------- Bottom-left: amount in words, notes, terms, bank/UPI/QR ----------
  // ---------- Bottom-right: bordered totals box + signature/stamp ----------
  const leftW = contentW * 0.58
  const rightX = margin + leftW + 6
  const rightW = contentW - leftW - 6

  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bolditalic')
  const wordsLines = doc.splitTextToSize(
    `Total In Words: Indian Rupee ${amountInWords(Number(invoice.grand_total || 0))} Only`,
    leftW
  )
  doc.text(wordsLines, margin, finalY)
  let leftY = finalY + wordsLines.length * 4.2 + 4
  doc.setFont('helvetica', 'normal')

  const lineHeight = 4.2
  const writeBlock = (label: string, text: string) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5)
    doc.text(label, margin, leftY)
    doc.setFont('helvetica', 'normal')
    leftY += 4.2
    const lines = doc.splitTextToSize(text, leftW)
    doc.text(lines, margin, leftY)
    leftY += lines.length * lineHeight + 3.5
  }

  if (invoice.notes) writeBlock('Notes', invoice.notes)
  if (bank?.bank_name) {
    writeBlock('Bank Details',
      `A/C Holder: ${bank.account_holder_name || ''}\nBank: ${bank.bank_name}\nA/c No.: ${bank.account_number || ''}\nIFSC: ${bank.ifsc_code || ''}`
    )
  }
  if (entity?.upi_id) { doc.setFontSize(8.5); doc.text(`UPI ID: ${entity.upi_id}`, margin, leftY); leftY += 5 }
  if (invoice.terms_conditions) writeBlock('Terms & Conditions', invoice.terms_conditions)

  if (branding.qrCode) {
    // A fixed 28x28 box with a visible border -- large enough to stay
    // scannable, aspect-preserved via drawFitted so a non-square source
    // image (quiet-zone margins baked in unevenly) doesn't get squashed.
    const qrBox = 28
    doc.setDrawColor(...BORDER_GRAY)
    doc.rect(margin, leftY, qrBox, qrBox)
    drawFitted(doc, branding.qrCode, margin, leftY, qrBox, qrBox)
    doc.setFontSize(7)
    doc.setTextColor(120, 120, 120)
    doc.text('Scan to pay', margin + qrBox / 2, leftY + qrBox + 4, { align: 'center' })
    doc.setTextColor(0, 0, 0)
    leftY += qrBox + 8
  }

  // Totals box -- Sub Total / GST rows / bold Total, right-aligned figures,
  // via autoTable so the borders match the item table exactly.
  const totalsRows: [string, string][] = [['Sub Total', money(invoice.subtotal)]]
  if (isGst) {
    if (invoice.cgst_total !== undefined || invoice.sgst_total !== undefined) {
      if (Number(invoice.cgst_total) > 0) totalsRows.push(['CGST', money(invoice.cgst_total)])
      if (Number(invoice.sgst_total) > 0) totalsRows.push(['SGST', money(invoice.sgst_total)])
      if (Number(invoice.igst_total) > 0) totalsRows.push(['IGST', money(invoice.igst_total)])
    } else {
      totalsRows.push(['Total GST', money(invoice.total_gst)])
    }
  }
  autoTable(doc, {
    startY: finalY,
    body: totalsRows,
    margin: { left: rightX, right: margin },
    tableWidth: rightW,
    theme: 'grid',
    styles: { fontSize: 8.5, lineColor: BORDER_GRAY, lineWidth: 0.2, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: 'normal' }, 1: { halign: 'right' } },
  })
  let totalsY = (doc as any).lastAutoTable.finalY
  autoTable(doc, {
    startY: totalsY,
    body: [['Total', money(invoice.grand_total)]],
    margin: { left: rightX, right: margin },
    tableWidth: rightW,
    theme: 'grid',
    styles: { fontSize: 10, fontStyle: 'bold', lineColor: BORDER_GRAY, lineWidth: 0.2, cellPadding: 2.5 },
    columnStyles: { 1: { halign: 'right' } },
  })
  let sigY = (doc as any).lastAutoTable.finalY + 10

  // Stamp/signature centered under the totals box, "Authorized Signatory"
  // label beneath -- absent images just leave the space blank.
  if (branding.signature || branding.stamp) {
    const boxW = 26
    const boxH = 17
    const gap = 3
    const totalW = (branding.stamp ? boxW : 0) + (branding.signature ? boxW : 0) + (branding.stamp && branding.signature ? gap : 0)
    let sigX = rightX + (rightW - totalW) / 2
    if (branding.stamp) { drawFitted(doc, branding.stamp, sigX, sigY, boxW, boxH); sigX += boxW + gap }
    if (branding.signature) drawFitted(doc, branding.signature, sigX, sigY, boxW, boxH)
    sigY += boxH + 4
  } else {
    sigY += 10
  }
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text('Authorized Signatory', rightX + rightW / 2, sigY, { align: 'center' })

  doc.setFontSize(7.5)
  doc.setTextColor(140, 140, 140)
  doc.text('This is a computer generated invoice.', pageWidth / 2, pageHeight - 8, { align: 'center' })

  return {
    buffer: doc.output('arraybuffer'),
    invoice,
    filename: `Invoice_${filenameSafe(invoice.customer_name)}_${invoice.invoice_number.replace(/\//g, '-')}.pdf`,
  }
}

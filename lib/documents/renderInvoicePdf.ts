import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabaseAdmin } from '@/lib/supabase/service'
import { STATE_CODE_TO_NAME } from '@/lib/gstStateCodes'

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

export interface RenderedInvoicePdf {
  buffer: ArrayBuffer
  invoice: any
  filename: string
}

// Shared renderer used by both the direct-download route and the email-send
// route, so there is exactly one place that draws an invoice PDF.
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
  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 14
  let y = 18

  // ---------- Seller header ----------
  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.text(entity?.legal_name || 'Digitalbluez Technologies Private Limited', margin, y)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  if (entity?.address) { y += 6; doc.text(entity.address, margin, y) }
  if (isGst && entity?.gstin) { y += 5.5; doc.text(`GSTIN: ${entity.gstin}`, margin, y) }
  const bank = entity?.bank_details as Record<string, string> | null

  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(isGst ? 'TAX INVOICE' : 'BILL OF SUPPLY', pageWidth - margin, 18, { align: 'right' })

  doc.line(margin, y + 5, pageWidth - margin, y + 5)
  y += 14

  // ---------- Invoice meta ----------
  doc.setFontSize(9.5)
  doc.setFont('helvetica', 'normal')
  doc.text(`Invoice No: ${invoice.invoice_number}`, margin, y)
  doc.text(`Date: ${invoice.invoice_date}`, pageWidth - margin, y, { align: 'right' })
  y += 6
  if (invoice.place_of_supply) {
    const label = STATE_CODE_TO_NAME[invoice.place_of_supply] || invoice.place_of_supply
    doc.text(`Place of Supply: ${label}${invoice.place_of_supply ? ` (${invoice.place_of_supply})` : ''}`, margin, y)
    y += 6
  }

  // ---------- Bill To ----------
  y += 4
  doc.setFont('helvetica', 'bold')
  doc.text('Bill To:', margin, y)
  doc.setFont('helvetica', 'normal')
  y += 5.5
  doc.text(invoice.customer_name || 'Customer', margin, y)
  if (invoice.customer_address) { y += 5; doc.text(invoice.customer_address, margin, y) }
  if (isGst && invoice.customer_gst) { y += 5; doc.text(`GSTIN: ${invoice.customer_gst}`, margin, y) }

  // ---------- Line items ----------
  const lineItems = items || []
  const head = isGst
    ? [['#', 'Description', 'HSN', 'Qty', 'Rate', 'GST%', 'Tax', 'Amount']]
    : [['#', 'Description', 'HSN', 'Qty', 'Rate', 'Amount']]

  const body = lineItems.map((item: any, idx: number) => {
    const taxLabel = item.gst_type === 'IGST'
      ? `IGST ₹${Number(item.igst_amount || 0).toFixed(2)}`
      : item.gst_type === 'CGST_SGST'
        ? `C ₹${Number(item.cgst_amount || 0).toFixed(2)} / S ₹${Number(item.sgst_amount || 0).toFixed(2)}`
        : '-'
    return isGst
      ? [String(idx + 1), item.description, item.hsn_code || '-', String(item.quantity), `₹${Number(item.rate).toFixed(2)}`, `${item.gst_rate || 0}%`, taxLabel, `₹${Number(item.amount).toFixed(2)}`]
      : [String(idx + 1), item.description, item.hsn_code || '-', String(item.quantity), `₹${Number(item.rate).toFixed(2)}`, `₹${Number(item.amount).toFixed(2)}`]
  })

  autoTable(doc, {
    startY: y + 8,
    head,
    body,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [15, 111, 184], textColor: 255, fontSize: 8 },
    styles: { fontSize: 8 },
  })

  let finalY = (doc as any).lastAutoTable.finalY + 8

  // ---------- Totals ----------
  doc.setFontSize(9.5)
  doc.text(`Subtotal: ₹${Number(invoice.subtotal || 0).toFixed(2)}`, pageWidth - margin, finalY, { align: 'right' })
  if (isGst) {
    finalY += 5.5
    doc.text(`Total GST: ₹${Number(invoice.total_gst || 0).toFixed(2)}`, pageWidth - margin, finalY, { align: 'right' })
  }
  finalY += 6.5
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(`Grand Total: ₹${Number(invoice.grand_total || 0).toFixed(2)}`, pageWidth - margin, finalY, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)

  finalY += 8
  doc.text(`Amount in Words: Indian Rupee ${amountInWords(Number(invoice.grand_total || 0))} Only`, margin, finalY)

  // ---------- Notes / terms / bank ----------
  finalY += 10
  if (invoice.notes) {
    doc.setFont('helvetica', 'bold'); doc.text('Notes:', margin, finalY); doc.setFont('helvetica', 'normal')
    finalY += 5; doc.text(doc.splitTextToSize(invoice.notes, pageWidth - margin * 2), margin, finalY)
    finalY += 10
  }
  if (invoice.terms_conditions) {
    doc.setFont('helvetica', 'bold'); doc.text('Terms & Conditions:', margin, finalY); doc.setFont('helvetica', 'normal')
    finalY += 5; doc.text(doc.splitTextToSize(invoice.terms_conditions, pageWidth - margin * 2), margin, finalY)
    finalY += 10
  }
  if (bank?.bank_name) {
    doc.setFont('helvetica', 'bold'); doc.text('Bank Details:', margin, finalY); doc.setFont('helvetica', 'normal')
    finalY += 5
    doc.text(`${bank.account_holder_name || ''}  |  ${bank.bank_name}  |  A/c: ${bank.account_number || ''}  |  IFSC: ${bank.ifsc_code || ''}`, margin, finalY)
  }

  doc.setFontSize(7.5)
  doc.setTextColor(140, 140, 140)
  doc.text('This is a computer generated invoice.', pageWidth / 2, doc.internal.pageSize.getHeight() - 8, { align: 'center' })

  return {
    buffer: doc.output('arraybuffer'),
    invoice,
    filename: `Invoice_${invoice.invoice_number.replace(/\//g, '-')}.pdf`,
  }
}

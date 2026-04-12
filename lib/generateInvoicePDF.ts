import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface InvoiceData {
  invoice_number: string;
  invoice_date: string;
  customer_name: string;
  customer_address?: string;
  customer_gst?: string;
  place_of_supply?: string;
  items: Array<{
    description: string;
    hsn_code?: string;
    quantity: number;
    rate: number;
    gst_rate: number;
    gst_type: string;
    cgst_amount?: number;
    sgst_amount?: number;
    igst_amount?: number;
    amount: number;
  }>;
  subtotal: number;
  total_gst: number;
  grand_total: number;
  notes?: string;
  terms_conditions?: string;
  bank_details?: string;
}

export async function generateInvoicePDF(data: InvoiceData): Promise<Blob> {
  return new Promise((resolve) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    let y = 20;

    // Header
    doc.setFontSize(24);
    doc.setTextColor(40, 40, 40);
    doc.text("INVOICE", pageWidth - margin, y, { align: "right" });

    // Company Info
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text("Digital Bluez", margin, y);
    doc.text("Your Business Address", margin, y + 5);
    doc.text("GST: XXAAAAAAAAAA1Z", margin, y + 10);
    doc.text("Email: info@digitalbluez.com", margin, y + 15);

    // Invoice Details
    y = 50;
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.text(`Invoice Number: ${data.invoice_number}`, margin, y);
    doc.text(`Invoice Date: ${data.invoice_date}`, margin, y + 5);
    if (data.place_of_supply) {
      doc.text(`Place of Supply: ${data.place_of_supply}`, margin, y + 10);
    }

    // Customer Details
    y = 75;
    doc.setFontSize(11);
    doc.text("Bill To:", margin, y);
    doc.setFontSize(10);
    doc.text(data.customer_name, margin, y + 5);
    if (data.customer_address) doc.text(data.customer_address, margin, y + 10);
    if (data.customer_gst) doc.text(`GST: ${data.customer_gst}`, margin, y + 15);

    // Line Items Table
    const tableData = data.items.map((item) => [
      item.description,
      item.hsn_code || "-",
      item.quantity.toString(),
      `₹${item.rate.toFixed(2)}`,
      `${item.gst_rate}%`,
      item.gst_type === 'IGST' ? `IGST: ₹${(item.igst_amount || 0).toFixed(2)}` :
        `CGST: ₹${(item.cgst_amount || 0).toFixed(2)} / SGST: ₹${(item.sgst_amount || 0).toFixed(2)}`,
      `₹${item.amount.toFixed(2)}`,
    ]);

    autoTable(doc, {
      startY: y + 25,
      head: [["Description", "HSN", "Qty", "Rate", "GST%", "Tax Details", "Amount"]],
      body: tableData,
      margin: { left: margin, right: margin },
      theme: "striped",
      headStyles: { fillColor: [41, 128, 185], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 50 },
        6: { halign: "right" },
      },
    });

    // Totals
    let finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(10);
    doc.text(`Subtotal: ₹${data.subtotal.toFixed(2)}`, pageWidth - margin - 80, finalY, { align: "right" });
    doc.text(`Total GST: ₹${data.total_gst.toFixed(2)}`, pageWidth - margin - 80, finalY + 6, { align: "right" });
    doc.setFontSize(11);
    doc.text(`Grand Total: ₹${data.grand_total.toFixed(2)}`, pageWidth - margin - 80, finalY + 14, { align: "right" });

    // Notes & Terms
    let notesY = finalY + 30;
    if (data.notes) {
      doc.setFontSize(10);
      doc.text("Notes:", margin, notesY);
      doc.text(data.notes, margin, notesY + 5);
      notesY += 15;
    }
    if (data.terms_conditions) {
      doc.setFontSize(10);
      doc.text("Terms & Conditions:", margin, notesY);
      doc.text(data.terms_conditions, margin, notesY + 5);
      notesY += 15;
    }
    if (data.bank_details) {
      doc.setFontSize(10);
      doc.text("Bank Details:", margin, notesY);
      doc.text(data.bank_details, margin, notesY + 5);
    }

    // Footer
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Thank you for your business!`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 10,
        { align: "center" }
      );
    }

    resolve(doc.output("blob"));
  });
}
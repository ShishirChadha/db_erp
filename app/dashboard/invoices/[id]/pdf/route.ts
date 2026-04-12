import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateInvoicePDF } from "@/lib/generateInvoicePDF";
import { format } from "date-fns";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const { id } = params;

    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", id)
      .single();

    if (invoiceError) {
      return new NextResponse("Invoice not found", { status: 404 });
    }

    const { data: items } = await supabase
      .from("invoice_items")
      .select("*")
      .eq("invoice_id", id);

    const pdfBlob = await generateInvoicePDF({
      invoice_number: invoice.invoice_number,
      invoice_date: format(new Date(invoice.invoice_date), "dd/MM/yyyy"),
      customer_name: invoice.customer_name,
      customer_address: invoice.customer_address,
      customer_gst: invoice.customer_gst,
      place_of_supply: invoice.place_of_supply,
      items: (items || []).map((item) => ({
        description: item.description,
        hsn_code: item.hsn_code,
        quantity: item.quantity,
        rate: item.rate,
        gst_rate: item.gst_rate,
        gst_type: item.gst_type,
        cgst_amount: item.cgst_amount,
        sgst_amount: item.sgst_amount,
        igst_amount: item.igst_amount,
        amount: item.amount,
      })),
      subtotal: invoice.subtotal,
      total_gst: invoice.total_gst,
      grand_total: invoice.grand_total,
      notes: invoice.notes,
      terms_conditions: invoice.terms_conditions,
      bank_details: invoice.bank_details,
    });

    return new NextResponse(pdfBlob, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="invoice_${invoice.invoice_number}.pdf"`,
      },
    });
  } catch (error) {
    console.error(error);
    return new NextResponse("Failed to generate PDF", { status: 500 });
  }
}
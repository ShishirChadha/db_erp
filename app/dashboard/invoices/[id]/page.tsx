"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Edit, Printer, FileText } from "lucide-react";
import { format } from "date-fns";
import { generateInvoicePDF } from "@/lib/generateInvoicePDF";

const statusColors: Record<string, string> = {
  draft: "bg-gray-500",
  pending_approval: "bg-yellow-500",
  approved: "bg-blue-500",
  paid: "bg-green-500",
};

export default function ViewInvoicePage() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const fetchInvoice = async () => {
      const { data: invoiceData, error: invoiceError } = await supabase
        .from("invoices")
        .select("*")
        .eq("id", id)
        .single();

      if (invoiceError) {
        console.error(invoiceError);
        router.push("/dashboard/invoices");
        return;
      }

      const { data: itemsData, error: itemsError } = await supabase
        .from("invoice_items")
        .select("*")
        .eq("invoice_id", id);

      if (!itemsError) setItems(itemsData || []);

      setInvoice(invoiceData);
      setLoading(false);
    };

    if (id) fetchInvoice();
  }, [id, supabase, router]);

  const handleDownloadPDF = async () => {
    if (!invoice) return;
    const pdfBlob = await generateInvoicePDF({
      invoice_number: invoice.invoice_number,
      invoice_date: format(new Date(invoice.invoice_date), "dd/MM/yyyy"),
      customer_name: invoice.customer_name,
      customer_address: invoice.customer_address,
      customer_gst: invoice.customer_gst,
      place_of_supply: invoice.place_of_supply,
      items: items.map((item) => ({
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
    const url = URL.createObjectURL(pdfBlob);
    window.open(url, "_blank");
  };

  if (loading) return <div className="p-6">Loading...</div>;
  if (!invoice) return <div className="p-6">Invoice not found</div>;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex justify-between items-center">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <div className="space-x-2">
          {invoice.status === "draft" && (
            <Button variant="outline" onClick={() => router.push(`/dashboard/invoices/${id}/edit`)}>
              <Edit className="mr-2 h-4 w-4" /> Edit
            </Button>
          )}
          <Button variant="outline" onClick={handleDownloadPDF}>
            <FileText className="mr-2 h-4 w-4" /> Download PDF
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex justify-between">
            <CardTitle>Invoice #{invoice.invoice_number}</CardTitle>
            <Badge className={statusColors[invoice.status]}>
              {invoice.status.replace("_", " ").toUpperCase()}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="font-semibold">Invoice Details</h3>
              <p>Date: {format(new Date(invoice.invoice_date), "dd/MM/yyyy")}</p>
              {invoice.place_of_supply && <p>Place of Supply: {invoice.place_of_supply}</p>}
            </div>
            <div>
              <h3 className="font-semibold">Bill To</h3>
              <p>{invoice.customer_name}</p>
              {invoice.customer_address && <p>{invoice.customer_address}</p>}
              {invoice.customer_gst && <p>GST: {invoice.customer_gst}</p>}
              {invoice.customer_phone && <p>Phone: {invoice.customer_phone}</p>}
              {invoice.customer_email && <p>Email: {invoice.customer_email}</p>}
            </div>
          </div>

          {invoice.shipping_address && (
            <div>
              <h3 className="font-semibold">Ship To</h3>
              <p>{invoice.shipping_address}</p>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">Description</th>
                  <th className="text-left py-2">HSN</th>
                  <th className="text-right py-2">Qty</th>
                  <th className="text-right py-2">Rate</th>
                  <th className="text-right py-2">GST%</th>
                  <th className="text-right py-2">Tax</th>
                  <th className="text-right py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b">
                    <td className="py-2">{item.description}</td>
                    <td className="py-2">{item.hsn_code || "-"}</td>
                    <td className="text-right py-2">{item.quantity}</td>
                    <td className="text-right py-2">₹{item.rate.toFixed(2)}</td>
                    <td className="text-right py-2">{item.gst_rate}%</td>
                    <td className="text-right py-2">
                      {item.gst_type === 'IGST'
                        ? `IGST: ₹${(item.igst_amount || 0).toFixed(2)}`
                        : `CGST: ₹${(item.cgst_amount || 0).toFixed(2)} / SGST: ₹${(item.sgst_amount || 0).toFixed(2)}`}
                    </td>
                    <td className="text-right py-2">₹{item.amount.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col items-end space-y-1">
            <div className="w-64 flex justify-between">
              <span>Subtotal:</span>
              <span>₹{invoice.subtotal.toFixed(2)}</span>
            </div>
            <div className="w-64 flex justify-between">
              <span>Total GST:</span>
              <span>₹{invoice.total_gst.toFixed(2)}</span>
            </div>
            <div className="w-64 flex justify-between font-bold border-t pt-1">
              <span>Grand Total:</span>
              <span>₹{invoice.grand_total.toFixed(2)}</span>
            </div>
          </div>

          {invoice.notes && (
            <div>
              <h3 className="font-semibold">Notes</h3>
              <p className="text-sm text-muted-foreground">{invoice.notes}</p>
            </div>
          )}
          {invoice.terms_conditions && (
            <div>
              <h3 className="font-semibold">Terms & Conditions</h3>
              <p className="text-sm text-muted-foreground">{invoice.terms_conditions}</p>
            </div>
          )}
          {invoice.bank_details && (
            <div>
              <h3 className="font-semibold">Bank Details</h3>
              <p className="text-sm text-muted-foreground">{invoice.bank_details}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
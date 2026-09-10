"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Edit, Printer, FileText, Mail, Eye, Building2, User, Landmark } from "lucide-react";
import { format } from "date-fns";
import { apiFetch } from "@/lib/api-client";
import RequirePageAccess from "@/components/RequirePageAccess";
import { useAsyncAction } from "@/lib/useAsyncAction";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import { downloadPdfFromResponse, previewablePdfUrl } from "@/lib/download-pdf";
import { StatusBadge } from "@/components/StatusBadge";
import { INVOICE_STATUS_TONES, toneFor } from "@/lib/status-styles";

function money(n: number | null | undefined) {
  return `₹${Number(n || 0).toFixed(2)}`;
}

function ViewInvoicePage() {
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

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const { run: handleDownloadPDF, pending: downloading } = useAsyncAction(async () => {
    if (!invoice) return;
    const res = await apiFetch(`/api/invoices/${invoice.id}/pdf`);
    if (!res.ok) {
      console.error("Failed to generate PDF", await res.text());
      return;
    }
    await downloadPdfFromResponse(res, `Invoice_${invoice.invoice_number}.pdf`);
  });

  const { run: handlePreviewPDF, pending: previewing } = useAsyncAction(async () => {
    if (!invoice) return;
    const res = await apiFetch(`/api/invoices/${invoice.id}/pdf`);
    if (!res.ok) {
      console.error("Failed to generate PDF", await res.text());
      return;
    }
    setPreviewUrl(await previewablePdfUrl(res, `Invoice_${invoice.invoice_number}.pdf`));
  });

  const { run: handleEmail, pending: emailing } = useAsyncAction(async () => {
    if (!invoice) return;
    const to = window.prompt("Send invoice to which email address?", invoice.customer_email || "");
    if (!to) return;
    const res = await apiFetch(`/api/invoices/${invoice.id}/email`, {
      method: "POST",
      body: JSON.stringify({ to }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || "Failed to send email.");
    } else {
      alert(`Sent to ${data.sent_to}.`);
    }
  });

  if (loading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (!invoice) return <div className="p-6 text-muted-foreground">Invoice not found</div>;

  const isGst = items.some((i) => i.gst_type);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* ---------- Toolbar ---------- */}
      <div className="flex flex-wrap justify-between items-center gap-2">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <div className="flex flex-wrap gap-2">
          {invoice.status === "draft" && (
            <Button variant="outline" onClick={() => router.push(`/dashboard/invoices/${id}/edit`)}>
              <Edit className="mr-2 h-4 w-4" /> Edit
            </Button>
          )}
          <Button variant="outline" onClick={() => handlePreviewPDF()} loading={previewing}>
            <Eye className="mr-2 h-4 w-4" /> Preview
          </Button>
          <Button variant="outline" onClick={() => handleDownloadPDF()} loading={downloading}>
            <FileText className="mr-2 h-4 w-4" /> Download PDF
          </Button>
          <Button variant="outline" onClick={() => handleEmail()} loading={emailing}>
            <Mail className="mr-2 h-4 w-4" /> Email
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      {/* ---------- Document sheet ---------- */}
      <div className="border rounded-xl bg-card shadow-sm overflow-hidden">
        {/* Header band */}
        <div className="p-5 md:p-6 border-b bg-muted/30">
          <div className="flex flex-wrap justify-between items-start gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                {isGst ? "Tax Invoice" : "Bill of Supply"}
              </p>
              <h1 className="text-3xl font-bold tabular-nums">#{invoice.invoice_number}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {format(new Date(invoice.invoice_date), "dd MMM yyyy")}
                {invoice.place_of_supply && ` · Place of Supply: ${invoice.place_of_supply}`}
              </p>
            </div>
            <StatusBadge tone={toneFor(INVOICE_STATUS_TONES, invoice.status)} className="text-sm px-3 py-1">
              {invoice.status.replace("_", " ").toUpperCase()}
            </StatusBadge>
          </div>
        </div>

        <div className="p-5 md:p-6 space-y-6">
          {/* Parties */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="border rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground mb-2">
                <User className="h-4 w-4" /> Bill To
              </div>
              <p className="text-base font-medium">{invoice.customer_name}</p>
              {invoice.customer_address && <p className="text-sm text-muted-foreground mt-0.5">{invoice.customer_address}</p>}
              {invoice.customer_gst && <p className="text-sm text-muted-foreground mt-0.5">GSTIN: {invoice.customer_gst}</p>}
              {invoice.customer_phone && <p className="text-sm text-muted-foreground mt-0.5">Phone: {invoice.customer_phone}</p>}
              {invoice.customer_email && <p className="text-sm text-muted-foreground mt-0.5">Email: {invoice.customer_email}</p>}
            </div>
            {invoice.shipping_address ? (
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground mb-2">
                  <Building2 className="h-4 w-4" /> Ship To
                </div>
                <p className="text-sm text-muted-foreground">{invoice.shipping_address}</p>
              </div>
            ) : <div />}
          </div>

          {/* Line items */}
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left text-muted-foreground">
                  <th className="py-2.5 px-3 font-medium">Description</th>
                  <th className="py-2.5 px-3 font-medium">HSN</th>
                  <th className="py-2.5 px-3 font-medium text-right">Qty</th>
                  <th className="py-2.5 px-3 font-medium text-right">Rate</th>
                  <th className="py-2.5 px-3 font-medium text-right">GST%</th>
                  <th className="py-2.5 px-3 font-medium text-right">Tax</th>
                  <th className="py-2.5 px-3 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="py-2.5 px-3">{item.description}</td>
                    <td className="py-2.5 px-3 text-muted-foreground">{item.hsn_code || "-"}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{item.quantity}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{money(item.rate)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{item.gst_rate}%</td>
                    <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                      {item.gst_type === 'IGST'
                        ? `IGST ${money(item.igst_amount)}`
                        : item.gst_type
                          ? `C ${money(item.cgst_amount)} / S ${money(item.sgst_amount)}`
                          : '-'}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-medium">{money(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-full max-w-xs space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{money(invoice.subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total GST</span>
                <span className="tabular-nums">{money(invoice.total_gst)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold border-t pt-2 mt-1">
                <span>Grand Total</span>
                <span className="tabular-nums">{money(invoice.grand_total)}</span>
              </div>
            </div>
          </div>

          {/* Notes / terms / bank */}
          {(invoice.notes || invoice.terms_conditions || invoice.bank_details) && (
            <div className="grid md:grid-cols-3 gap-4 border-t pt-6">
              {invoice.notes && (
                <div>
                  <h3 className="text-sm font-semibold mb-1">Notes</h3>
                  <p className="text-sm text-muted-foreground whitespace-pre-line">{invoice.notes}</p>
                </div>
              )}
              {invoice.terms_conditions && (
                <div>
                  <h3 className="text-sm font-semibold mb-1">Terms & Conditions</h3>
                  <p className="text-sm text-muted-foreground whitespace-pre-line">{invoice.terms_conditions}</p>
                </div>
              )}
              {invoice.bank_details && (
                <div>
                  <h3 className="text-sm font-semibold mb-1 flex items-center gap-1.5"><Landmark className="h-3.5 w-3.5" /> Bank Details</h3>
                  <p className="text-sm text-muted-foreground whitespace-pre-line">{invoice.bank_details}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {previewUrl && (
        <PdfPreviewDialog url={previewUrl} title={`Invoice ${invoice.invoice_number}`} onClose={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }} />
      )}
    </div>
  );
}

export default function ViewInvoicePageGuarded() {
  return (
    <RequirePageAccess pageKey="invoices">
      <ViewInvoicePage />
    </RequirePageAccess>
  );
}

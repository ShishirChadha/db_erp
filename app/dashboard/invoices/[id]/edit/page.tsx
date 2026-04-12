"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { InvoiceForm } from "@/components/InvoiceForm";
import { toast } from "sonner";

export default function EditInvoicePage() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
        toast.error("Invoice not found");
        router.push("/dashboard/invoices");
        return;
      }

      const { data: itemsData } = await supabase
        .from("invoice_items")
        .select("*")
        .eq("invoice_id", id);

      setInvoice(invoiceData);
      setItems(itemsData || []);
      setLoading(false);
    };

    if (id) fetchInvoice();
  }, [id, supabase, router]);

  const handleSubmit = async (data: any) => {
    console.log("🟡 Edit page received data:", data);
    setIsSubmitting(true);
    try {
      const { items: newItems, ...invoiceData } = data;

      // Update invoice header
      const { error: invoiceError } = await supabase
        .from("invoices")
        .update({
          invoice_date: invoiceData.invoice_date,
          place_of_supply: invoiceData.place_of_supply,
          customer_id: invoiceData.customer_id,
          customer_name: invoiceData.customer_name,
          customer_gst: invoiceData.customer_gst,
          customer_address: invoiceData.customer_address,
          customer_phone: invoiceData.customer_phone,
          customer_email: invoiceData.customer_email,
          shipping_address: invoiceData.shipping_address,
          notes: invoiceData.notes,
          terms_conditions: invoiceData.terms_conditions,
          bank_details: invoiceData.bank_details,
          subtotal: invoiceData.subtotal,
          total_gst: invoiceData.total_gst,
          grand_total: invoiceData.grand_total,
          status: invoiceData.status,
        })
        .eq("id", id);

      if (invoiceError) throw invoiceError;

      // Delete old items and insert new ones
      await supabase.from("invoice_items").delete().eq("invoice_id", id);

      const lineItems = newItems.map((item: any) => ({
        ...item,
        invoice_id: id,
      }));

      const { error: itemsError } = await supabase
        .from("invoice_items")
        .insert(lineItems);

      if (itemsError) throw itemsError;

      toast.success("Invoice updated successfully!");
      router.push(`/dashboard/invoices/${id}`);
    } catch (error) {
      console.error("Update error:", error);
      toast.error("Failed to update invoice");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) return <div className="p-6">Loading...</div>;
  if (!invoice) return <div className="p-6">Invoice not found</div>;

 const formData = {
  ...invoice,
  invoice_date: new Date(invoice.invoice_date),
  subject: invoice.subject || "",   // 👈 ADD THIS LINE
  items: items.map((item) => ({
    ...item,
    item_type: item.item_type,
    asset_id: item.asset_id,
    accessory_id: item.accessory_id,
  })),
};

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Edit Invoice #{invoice.invoice_number}</h1>
      </div>
      <InvoiceForm
        initialData={formData}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
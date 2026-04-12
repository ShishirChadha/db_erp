"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { InvoiceForm } from "@/components/InvoiceForm";
import { suggestNextInvoiceNumber, isInvoiceNumberUnique } from "@/app/actions/invoice";
import { toast } from "sonner";

export default function NewInvoicePage() {
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  // Load the suggested invoice number when the page loads
  useEffect(() => {
    const loadNumber = async () => {
      const suggested = await suggestNextInvoiceNumber();
      setInvoiceNumber(suggested);
    };
    loadNumber();
  }, []);

  const handleSubmit = async (data: any) => {
    setIsSubmitting(true);
    try {
      // Use the invoice number from the form (user may have edited it)
      const finalInvoiceNumber = data.invoice_number;

      // Check uniqueness
      const isUnique = await isInvoiceNumberUnique(finalInvoiceNumber);
      if (!isUnique) {
        toast.error("Invoice number already exists. Please change it.");
        setIsSubmitting(false);
        return;
      }

      const { items, ...invoiceData } = data;

      // Insert the invoice
      const { data: newInvoice, error: invoiceError } = await supabase
        .from("invoices")
        .insert([
          {
            ...invoiceData,
            invoice_number: finalInvoiceNumber,
            created_by: (await supabase.auth.getUser()).data.user?.id,
          },
        ])
        .select()
        .single();

      if (invoiceError) throw invoiceError;

      // Insert line items
      const lineItems = items.map((item: any) => ({
        ...item,
        invoice_id: newInvoice.id,
      }));

      const { error: itemsError } = await supabase
        .from("invoice_items")
        .insert(lineItems);

      if (itemsError) throw itemsError;

      toast.success("Invoice saved successfully!");
      router.push("/dashboard/invoices");
    } catch (error) {
      console.error(error);
      toast.error("Failed to save invoice");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Create New Invoice</h1>
      </div>
      <InvoiceForm
        invoiceNumber={invoiceNumber}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
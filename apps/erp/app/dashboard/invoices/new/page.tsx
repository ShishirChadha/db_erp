"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { InvoiceForm } from "@/components/InvoiceForm";
import { mintInvoiceNumber } from "@/app/actions/invoice";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import RequirePageAccess from "@/components/RequirePageAccess";
import { useAsyncAction } from "@/lib/useAsyncAction";

// Digitalbluez is the only fully-configured GST entity today.
// TODO(Phase 1 follow-up): let the user pick Techtenth/Cash once the
// Business Profiles Settings UI exists.
const ENTITY_KEY = "digitalbluez";

function NewInvoicePage() {
  const router = useRouter();
  const supabase = createClient();

  const { run: handleSubmit, pending: isSubmitting } = useAsyncAction(async (data: any) => {
    try {
      // Mint the real number atomically, at the moment of save -- never
      // pre-fetched, never client-editable, never uniqueness-checked because
      // the atomic RPC guarantees uniqueness by construction.
      const finalInvoiceNumber = await mintInvoiceNumber(ENTITY_KEY);

      const { items, ...invoiceData } = data;

      // Insert the invoice
      const { data: newInvoice, error: invoiceError } = await supabase
        .from("invoices")
        .insert([
          {
            ...invoiceData,
            invoice_number: finalInvoiceNumber,
            entity_key: ENTITY_KEY,
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
    }
  });

  return (
    <div className="container mx-auto py-6 space-y-6">
      <Button variant="ghost" onClick={() => router.push("/dashboard/invoices")}>
        <ArrowLeft className="mr-2 h-4 w-4" /> Back
      </Button>
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Create New Invoice</h1>
      </div>
      <InvoiceForm
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}

export default function NewInvoicePageGuarded() {
  return (
    <RequirePageAccess pageKey="invoices">
      <NewInvoicePage />
    </RequirePageAccess>
  );
}
"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { InvoiceForm } from "@/components/InvoiceForm";
import { mintInvoiceNumber } from "@/app/actions/invoice";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import RequirePageAccess from "@/components/RequirePageAccess";
import { useAsyncAction } from "@/lib/useAsyncAction";
import type { InvoiceFormData } from "@/lib/schemas/invoiceSchema";

function NewInvoicePage() {
  const router = useRouter();
  const supabase = createClient();
  // `?clone=<invoiceId>` opens this same New form prefilled from that invoice --
  // nothing is created (and no number minted) until the user saves.
  const cloneId = useSearchParams().get("clone");
  // Which entity issues this invoice. Owned here rather than inside the form
  // because the number series is per-entity -- mintInvoiceNumber() and the
  // entity_key written to the row have to come from the same choice.
  const [entityKey, setEntityKey] = useState("digitalbluez");
  const [cloneData, setCloneData] = useState<{ number: string; data: InvoiceFormData } | null>(null);
  const [loadingClone, setLoadingClone] = useState(!!cloneId);

  useEffect(() => {
    if (!cloneId) return;
    (async () => {
      const { data: inv } = await supabase.from("invoices").select("*").eq("id", cloneId).single();
      const { data: lines } = await supabase.from("invoice_items").select("*").eq("invoice_id", cloneId);
      if (!inv) { toast.error("Invoice to clone not found"); setLoadingClone(false); return; }
      setEntityKey(inv.entity_key || "digitalbluez");
      // Only the content is copied: a fresh number/date/status, and lines carry no
      // sale/asset link (a clone is a standalone charge, never a second invoice
      // for an already-invoiced sale).
      setCloneData({
        number: inv.invoice_number,
        data: {
          invoice_number: "",
          invoice_date: new Date(),
          status: "draft",
          place_of_supply: inv.place_of_supply || "",
          customer_id: inv.customer_id,
          customer_name: inv.customer_name || "",
          customer_gst: inv.customer_gst || "",
          customer_address: inv.customer_address || "",
          customer_phone: inv.customer_phone || "",
          customer_email: inv.customer_email || "",
          shipping_address: inv.shipping_address || "",
          subject: inv.subject || "",
          notes: inv.notes || "",
          terms_conditions: inv.terms_conditions || "",
          bank_details: inv.bank_details || "",
          items: (lines || []).map((l: any) => ({
            item_type: "custom",
            asset_id: null,
            accessory_id: null,
            sku_id: l.sku_id || null,
            description: l.description || "",
            hsn_code: l.hsn_code || "",
            quantity: Number(l.quantity) || 1,
            rate: Number(l.rate) || 0,
            gst_rate: Number(l.gst_rate) || 0,
            gst_type: null,
            amount: 0,
            cgst_amount: 0,
            sgst_amount: 0,
            igst_amount: 0,
          })),
          subtotal: 0,
          total_gst: 0,
          grand_total: 0,
        },
      });
      setLoadingClone(false);
    })();
  }, [cloneId, supabase]);

  const { run: handleSubmit, pending: isSubmitting } = useAsyncAction(async (data: any) => {
    try {
      // Mint the real number atomically, at the moment of save -- never
      // pre-fetched, never client-editable, never uniqueness-checked because
      // the atomic RPC guarantees uniqueness by construction. The number the
      // form showed was only a preview.
      const finalInvoiceNumber = await mintInvoiceNumber(entityKey);

      const { items, ...invoiceData } = data;

      // Insert the invoice
      const { data: newInvoice, error: invoiceError } = await supabase
        .from("invoices")
        .insert([
          {
            ...invoiceData,
            invoice_number: finalInvoiceNumber,
            entity_key: entityKey,
            // Pre-GST total, same meaning the sale-to-invoice path gives it.
            total_amount: invoiceData.subtotal,
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

      if (data.invoice_number && data.invoice_number !== finalInvoiceNumber) {
        toast.success(`Invoice saved as ${finalInvoiceNumber} (${data.invoice_number} was taken in the meantime).`);
      } else {
        toast.success(`Invoice ${finalInvoiceNumber} saved.`);
      }
      router.push(`/dashboard/invoices/${newInvoice.id}`);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error && error.message ? error.message : "Failed to save invoice");
    }
  });

  return (
    <div className="container mx-auto py-6 space-y-6">
      <Button variant="ghost" onClick={() => router.back()}>
        <ArrowLeft className="mr-2 h-4 w-4" /> Back
      </Button>
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">
          {cloneData ? `New Invoice (cloned from ${cloneData.number})` : "Create New Invoice"}
        </h1>
      </div>
      {loadingClone ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <InvoiceForm
          initialData={cloneData?.data}
          isClone={!!cloneData}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          onCancel={() => router.back()}
          entityKey={entityKey}
          onEntityKeyChange={setEntityKey}
        />
      )}
    </div>
  );
}

export default function NewInvoicePageGuarded() {
  return (
    <RequirePageAccess pageKey="invoices">
      <Suspense>
        <NewInvoicePage />
      </Suspense>
    </RequirePageAccess>
  );
}

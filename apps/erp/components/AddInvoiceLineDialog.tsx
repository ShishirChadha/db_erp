"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorBanner } from "@/components/ErrorBanner";
import { apiFetch } from "@/lib/api-client";
import { useAsyncAction } from "@/lib/useAsyncAction";

// A manual charge with no SKU/asset of its own -- shipping, packing,
// installation, a one-off adjustment, etc. -- added onto an EXISTING invoice
// (draft or already-approved; POST /api/invoices/[id]/items has no status
// gate, unlike the full edit form, and requires a reason since it's changing
// a document that may already be with the customer). GST% is a plain editable
// number defaulting to 18 -- clear it to 0 to charge it as a pure
// reimbursement with no tax.
export function AddInvoiceLineDialog({
  invoiceId,
  defaultGstRate,
  onClose,
  onAdded,
}: {
  invoiceId: string;
  defaultGstRate: number;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [description, setDescription] = useState("");
  const [hsnCode, setHsnCode] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [rate, setRate] = useState("");
  const [gstRate, setGstRate] = useState(String(defaultGstRate));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const { run: save, pending } = useAsyncAction(async () => {
    if (!description.trim()) { setError("Description is required."); return; }
    if (!rate.trim() || Number(rate) < 0) { setError("Enter a rate of 0 or more."); return; }
    if (!reason.trim()) { setError("A reason is required to add a charge to an existing invoice."); return; }
    setError("");

    const res = await apiFetch(`/api/invoices/${invoiceId}/items`, {
      method: "POST",
      body: JSON.stringify({
        description: description.trim(),
        hsn_code: hsnCode.trim(),
        quantity: Number(quantity) || 1,
        rate: Number(rate),
        gst_rate: gstRate.trim() === "" ? 0 : Number(gstRate),
        reason: reason.trim(),
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error || "Failed to add the line item."); return; }
    onAdded();
    onClose();
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Charge</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {error && <ErrorBanner message={error} />}
          <div>
            <Label className="text-sm mb-1 block">Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Shipping Charge" className="h-8" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm mb-1 block">HSN/SAC</Label>
              <Input value={hsnCode} onChange={(e) => setHsnCode(e.target.value)} placeholder="996812" className="h-8" />
            </div>
            <div>
              <Label className="text-sm mb-1 block">Quantity</Label>
              <Input type="number" step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-8" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm mb-1 block">Rate (₹)</Label>
              <Input type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="284" className="h-8" />
            </div>
            <div>
              <Label className="text-sm mb-1 block">GST%</Label>
              <Input type="number" step="0.01" value={gstRate} onChange={(e) => setGstRate(e.target.value)} className="h-8" />
              <p className="text-xs text-muted-foreground mt-1">Set to 0 for a tax-free reimbursement.</p>
            </div>
          </div>
          <div>
            <Label className="text-sm mb-1 block">Reason <span className="text-destructive">*</span></Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being added?" className="h-8" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={pending} onClick={() => save()}>
              {pending ? "Adding…" : "Add Charge"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

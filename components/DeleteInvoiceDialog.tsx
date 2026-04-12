"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function DeleteInvoiceDialog({
  invoice,
  open,
  onOpenChange,
  onConfirm,
}: {
  invoice: { id: string; invoice_number: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (remarks: string) => void;
}) {
  const [remarks, setRemarks] = useState("");

  // Guard: if no invoice, don't render anything
  if (!invoice) return null;

  const handleConfirm = () => {
    onConfirm(remarks);
    setRemarks("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Invoice #{invoice.invoice_number}</DialogTitle>
          <DialogDescription>
            This action will move the invoice to trash. You can restore it later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="remarks">Reason for deletion (optional)</Label>
            <Textarea
              id="remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g., Wrong customer, duplicate entry, etc."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm}>
            Delete Invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
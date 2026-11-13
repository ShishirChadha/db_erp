"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import CustomerForm, {
  customerDialogClass,
  customerDialogHeaderClass,
  customerDialogTitleClass,
  type CustomerDialogSize,
} from "@/components/CustomerForm";

// Opened from the Customers page (size="page", Zoho's full New Customer page)
// and from every sell-side flow (default "modal", Zoho's ~850px dialog): Sell,
// Service, Quotation/Proforma, Customer Detail -> reassign. The form inside
// adapts to whichever width it gets.
export default function AddCustomerDialog({ onAdd, size = "modal" }: { onAdd: (created?: any) => void; size?: CustomerDialogSize }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Add Customer
        </Button>
      </DialogTrigger>
      <DialogContent className={customerDialogClass(size)}>
        <DialogHeader className={customerDialogHeaderClass}>
          <DialogTitle className={customerDialogTitleClass}>New Customer</DialogTitle>
        </DialogHeader>
        {open && (
          <CustomerForm
            submitLabel="Save"
            onCancel={() => setOpen(false)}
            onSaved={(row) => {
              setOpen(false);
              onAdd(row);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

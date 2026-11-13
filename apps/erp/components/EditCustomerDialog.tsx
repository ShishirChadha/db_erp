"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import CustomerForm, {
  customerDialogClass,
  customerDialogHeaderClass,
  customerDialogTitleClass,
  type CustomerDialogSize,
} from "@/components/CustomerForm";

export default function EditCustomerDialog({
  customer,
  open,
  onOpenChange,
  onUpdate,
  size = "modal",
}: {
  customer: { id: string; customer_name: string; [key: string]: any };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: () => void;
  size?: CustomerDialogSize;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={customerDialogClass(size)}>
        <DialogHeader className={customerDialogHeaderClass}>
          <DialogTitle className={customerDialogTitleClass}>Edit Customer: {customer.customer_name}</DialogTitle>
        </DialogHeader>
        {open && (
          <CustomerForm
            customer={customer}
            submitLabel="Save"
            onCancel={() => onOpenChange(false)}
            onSaved={() => {
              onOpenChange(false);
              onUpdate();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

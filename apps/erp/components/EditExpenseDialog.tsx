"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAsyncAction } from "@/lib/useAsyncAction";
import { useCustomOptions } from "@/lib/useCustomOptions";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useRole } from "@/lib/auth/useRole";
import { ExpenseAttachmentsField, type ExpenseAttachment } from "@/components/ExpenseAttachmentsField";
import { AddVendorDialog, type Vendor } from "@/components/AddVendorDialog";
import { isLocationRelevantType, isVendorRelevantType } from "@/lib/expense-type-rules";

const PAYMENT_ACCOUNTS = ["Digitalbluez", "Techtenth", "Cash"];

interface Expense {
  id: string;
  expense_date: string;
  description: string;
  type: string;
  payment_account?: string | null;
  from_location: string;
  to_location: string;
  amount: number | null;
  vendor_id?: string | null;
  attachments?: ExpenseAttachment[];
  paid_by_staff?: string | null;
}

export default function EditExpenseDialog({
  expense,
  open,
  onOpenChange,
  onUpdate,
}: {
  expense: Expense;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: () => void;
}) {
  const [formData, setFormData] = useState<Partial<Expense>>({});
  const { values: expenseTypes, addOption: addExpenseType } = useCustomOptions("expense_types");
  const { values: staffNames, addOption: addStaffName } = useCustomOptions("staff_names");
  const { isOwner } = useRole();
  const [vendors, setVendors] = useState<{ id: string; company_name: string }[]>([]);
  const [addingVendor, setAddingVendor] = useState(false);

  const showLocationFields = isLocationRelevantType(formData.type || "");
  const showVendorField = isOwner && isVendorRelevantType(formData.type || "");
  const showPaidFromField = !formData.paid_by_staff;

  useEffect(() => {
    setFormData(expense);
  }, [expense]);

  useEffect(() => {
    if (!open || !isOwner) return;
    apiFetch("/api/vendors").then((res) => res.ok ? res.json() : []).then(setVendors).catch(() => {});
  }, [open, isOwner]);

  const handleChange = (field: keyof Expense, value: string | number | null) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleVendorAdded = (vendor: Vendor) => {
    setVendors((prev) => [...prev, vendor]);
    handleChange("vendor_id", vendor.id);
    setAddingVendor(false);
  };

  const { run: handleSubmit, pending: loading } = useAsyncAction(async (e: React.FormEvent) => {
    e.preventDefault();
    const { id, ...updateData } = formData;
    // From/To and Vendor are purely type-driven -- clear stale values if the
    // type was changed to something they no longer apply to. Paid From is
    // deliberately left untouched when hidden (paid_by_staff set): it may
    // already carry the entity a reimbursement settled it against, and
    // clearing it here on every edit would destroy that.
    if (!showLocationFields) { updateData.from_location = ""; updateData.to_location = ""; }
    if (!showVendorField) updateData.vendor_id = "";
    const res = await apiFetch(`/api/expenses/${expense.id}`, { method: "PATCH", body: JSON.stringify(updateData) });
    if (!res.ok) {
      console.error(await res.json().catch(() => ({})));
      alert("Update failed.");
    } else {
      onOpenChange(false);
      onUpdate();
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Expense</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Expense Date</Label>
              <Input
                type="date"
                value={formData.expense_date?.slice(0, 10) || ""}
                onChange={(e) => handleChange("expense_date", e.target.value)}
              />
            </div>
            <div>
              <Label>Type</Label>
              <SearchableSelect
                options={expenseTypes}
                value={formData.type || ""}
                onChange={(val) => handleChange("type", val)}
                placeholder="Select type..."
                onOtherCommit={(val) => addExpenseType(val)}
              />
            </div>
            <div>
              <Label>Paid By Staff (if out of pocket)</Label>
              <SearchableSelect
                options={staffNames}
                value={formData.paid_by_staff || ""}
                onChange={(val) => handleChange("paid_by_staff", val)}
                placeholder="Company account (default)..."
                onOtherCommit={(val) => addStaffName(val)}
              />
            </div>
            {showPaidFromField && (
              <div>
                <Label>Paid From</Label>
                <Select value={formData.payment_account || ""} onValueChange={(val) => handleChange("payment_account", val)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{PAYMENT_ACCOUNTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {!showPaidFromField && (
              <div className="text-xs text-muted-foreground self-end pb-2">
                Reimbursed later from Digitalbluez/Techtenth/Cash when settled — see Staff Reimbursements.
              </div>
            )}
            {showLocationFields && (
              <>
                <div>
                  <Label>From</Label>
                  <Input
                    value={formData.from_location || ""}
                    onChange={(e) => handleChange("from_location", e.target.value)}
                  />
                </div>
                <div>
                  <Label>To</Label>
                  <Input
                    value={formData.to_location || ""}
                    onChange={(e) => handleChange("to_location", e.target.value)}
                  />
                </div>
              </>
            )}
            <div>
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.amount ?? ""}
                onChange={(e) =>
                  handleChange("amount", e.target.value === "" ? null : parseFloat(e.target.value))
                }
              />
            </div>
            {showVendorField && (
              <div className="col-span-2">
                <Label>Vendor</Label>
                <div className="flex gap-2">
                  <Select value={formData.vendor_id || "none"} onValueChange={(val) => handleChange("vendor_id", val === "none" ? "" : val)}>
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.company_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" onClick={() => setAddingVendor(true)}>+ New</Button>
                </div>
              </div>
            )}
            <div className="col-span-2">
              <Label>Description</Label>
              <Input
                value={formData.description || ""}
                onChange={(e) => handleChange("description", e.target.value)}
              />
            </div>
            <ExpenseAttachmentsField
              value={formData.attachments || []}
              onChange={(next) => setFormData((prev) => ({ ...prev, attachments: next }))}
            />
          </div>
          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              Save Changes
            </Button>
          </div>
        </form>
        {addingVendor && <AddVendorDialog onAdded={handleVendorAdded} onClose={() => setAddingVendor(false)} />}
      </DialogContent>
    </Dialog>
  );
}

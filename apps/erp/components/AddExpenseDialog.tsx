"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Plus } from "lucide-react";
import { useAsyncAction } from "@/lib/useAsyncAction";
import { useCustomOptions } from "@/lib/useCustomOptions";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useRole } from "@/lib/auth/useRole";
import { ExpenseAttachmentsField, type ExpenseAttachment } from "@/components/ExpenseAttachmentsField";
import { AddVendorDialog, type Vendor } from "@/components/AddVendorDialog";
import { isLocationRelevantType, isVendorRelevantType } from "@/lib/expense-type-rules";

const PAYMENT_ACCOUNTS = ["Digitalbluez", "Techtenth", "Cash"];

export default function AddExpenseDialog({ onAdd }: { onAdd: () => void }) {
  const [open, setOpen] = useState(false);
  const { isOwner } = useRole();
  const { values: expenseTypes, addOption: addExpenseType } = useCustomOptions("expense_types");
  const { values: staffNames, addOption: addStaffName } = useCustomOptions("staff_names");
  const [vendors, setVendors] = useState<{ id: string; company_name: string }[]>([]);
  const [addingVendor, setAddingVendor] = useState(false);
  const [formData, setFormData] = useState({
    expense_date: "",
    description: "",
    type: "",
    payment_account: "",
    from_location: "",
    to_location: "",
    amount: null as number | null,
    vendor_id: "",
    paid_by_staff: "",
  });
  const [attachments, setAttachments] = useState<ExpenseAttachment[]>([]);

  const showLocationFields = isLocationRelevantType(formData.type);
  const showVendorField = isOwner && isVendorRelevantType(formData.type);
  const showPaidFromField = !formData.paid_by_staff;

  // Vendor identity defaults to owner-only everywhere in this app except the one
  // narrow accessory-receipt exception -- expenses aren't that exception, so the
  // vendor picker (and the vendor list fetch itself) is owner-only.
  useEffect(() => {
    if (!open || !isOwner) return;
    apiFetch("/api/vendors").then((res) => res.ok ? res.json() : []).then(setVendors).catch(() => {});
  }, [open, isOwner]);

  const handleChange = (field: string, value: string | number | null) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleVendorAdded = (vendor: Vendor) => {
    setVendors((prev) => [...prev, vendor]);
    handleChange("vendor_id", vendor.id);
    setAddingVendor(false);
  };

  const { run: handleSubmit, pending: loading } = useAsyncAction(async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiFetch("/api/expenses", {
      method: "POST",
      body: JSON.stringify({
        ...formData,
        // These fields don't apply once hidden by the type/paid-by-staff rules above --
        // clear them rather than silently submit a stale value from before the type/staff changed.
        from_location: showLocationFields ? formData.from_location : "",
        to_location: showLocationFields ? formData.to_location : "",
        vendor_id: showVendorField ? formData.vendor_id : "",
        payment_account: showPaidFromField ? formData.payment_account : "",
        attachments,
      }),
    });
    if (!res.ok) {
      console.error(await res.json().catch(() => ({})));
      alert("Failed to add expense.");
    } else {
      setOpen(false);
      onAdd();
      setFormData({
        expense_date: "",
        description: "",
        type: "",
        payment_account: "",
        from_location: "",
        to_location: "",
        amount: null,
        vendor_id: "",
        paid_by_staff: "",
      });
      setAttachments([]);
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Add Expense
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add New Expense</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Expense Date *</Label><Input type="date" required value={formData.expense_date} onChange={(e) => handleChange("expense_date", e.target.value)} /></div>
            <div>
              <Label>Type</Label>
              <SearchableSelect
                options={expenseTypes}
                value={formData.type}
                onChange={(val) => handleChange("type", val)}
                placeholder="Select type..."
                onOtherCommit={(val) => addExpenseType(val)}
              />
            </div>
            <div>
              <Label>Paid By Staff (if out of pocket)</Label>
              <SearchableSelect
                options={staffNames}
                value={formData.paid_by_staff}
                onChange={(val) => handleChange("paid_by_staff", val)}
                placeholder="Company account (default)..."
                onOtherCommit={(val) => addStaffName(val)}
              />
            </div>
            {showPaidFromField && (
              <div>
                <Label>Paid From</Label>
                <Select value={formData.payment_account} onValueChange={(val) => handleChange("payment_account", val)}>
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
                <div><Label>From</Label><Input value={formData.from_location} onChange={(e) => handleChange("from_location", e.target.value)} /></div>
                <div><Label>To</Label><Input value={formData.to_location} onChange={(e) => handleChange("to_location", e.target.value)} /></div>
              </>
            )}
            <div><Label>Amount</Label><Input type="number" step="0.01" value={formData.amount ?? ""} onChange={(e) => handleChange("amount", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
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
            <div className="col-span-2"><Label>Description</Label><Input value={formData.description} onChange={(e) => handleChange("description", e.target.value)} /></div>
            <ExpenseAttachmentsField value={attachments} onChange={setAttachments} />
          </div>
          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={loading}>Add Expense</Button>
          </div>
        </form>
        {addingVendor && <AddVendorDialog onAdded={handleVendorAdded} onClose={() => setAddingVendor(false)} />}
      </DialogContent>
    </Dialog>
  );
}

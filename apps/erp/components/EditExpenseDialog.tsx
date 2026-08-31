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

interface Expense {
  id: string;
  expense_date: string;
  description: string;
  type: string;
  from_location: string;
  to_location: string;
  amount: number | null;
  remarks: string;
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

  useEffect(() => {
    setFormData(expense);
  }, [expense]);

const handleChange = (field: keyof Expense, value: string | number | null) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const { run: handleSubmit, pending: loading } = useAsyncAction(async (e: React.FormEvent) => {
    e.preventDefault();
    const { id, ...updateData } = formData;
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
              <Label>Description</Label>
              <Input
                value={formData.description || ""}
                onChange={(e) => handleChange("description", e.target.value)}
              />
            </div>
            <div>
              <Label>Type</Label>
              <Select
                value={formData.type || ""}
                onValueChange={(val) => handleChange("type", val)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Food">Food</SelectItem>
                  <SelectItem value="Transport">Transport</SelectItem>
                  <SelectItem value="Stationary">Stationary</SelectItem>
                  <SelectItem value="Water">Water</SelectItem>
                  <SelectItem value="Birthday">Birthday</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
            <div className="col-span-2">
              <Label>Remarks</Label>
              <Input
                value={formData.remarks || ""}
                onChange={(e) => handleChange("remarks", e.target.value)}
              />
            </div>
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
      </DialogContent>
    </Dialog>
  );
}
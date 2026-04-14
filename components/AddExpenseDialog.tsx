"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
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

export default function AddExpenseDialog({ onAdd }: { onAdd: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    expense_date: "",
    description: "",
    type: "Food",
    from_location: "",
    to_location: "",
    amount: null as number | null,
    remarks: "",
  });
  const supabase = createClient();

  const handleChange = (field: string, value: string | number | null) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.from("expenses").insert([formData]);
    setLoading(false);
    if (error) {
      console.error(error);
      alert("Failed to add expense.");
    } else {
      setOpen(false);
      onAdd();
      setFormData({
        expense_date: "",
        description: "",
        type: "Food",
        from_location: "",
        to_location: "",
        amount: null,
        remarks: "",
      });
    }
  };

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
            <div><Label>Description</Label><Input value={formData.description} onChange={(e) => handleChange("description", e.target.value)} /></div>
            <div><Label>Type</Label><Select value={formData.type} onValueChange={(val) => handleChange("type", val)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Food">Food</SelectItem><SelectItem value="Transport">Transport</SelectItem><SelectItem value="Stationary">Stationary</SelectItem><SelectItem value="Water">Water</SelectItem><SelectItem value="Birthday">Birthday</SelectItem></SelectContent></Select></div>
            <div><Label>From</Label><Input value={formData.from_location} onChange={(e) => handleChange("from_location", e.target.value)} /></div>
            <div><Label>To</Label><Input value={formData.to_location} onChange={(e) => handleChange("to_location", e.target.value)} /></div>
            <div><Label>Amount</Label><Input type="number" step="0.01" value={formData.amount ?? ""} onChange={(e) => handleChange("amount", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
            <div className="col-span-2"><Label>Remarks</Label><Input value={formData.remarks} onChange={(e) => handleChange("remarks", e.target.value)} /></div>
          </div>
          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? "Adding..." : "Add Expense"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
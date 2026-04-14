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

export default function AddSaleDialog({ onAdd }: { onAdd: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    sale_date: "",
    invoice_number: "",
    customer_name: "",
    asset_number: "",
    sku: "",
    type: "Laptop",
    asset_description: "",
    serial_number: "",
    sale_base_price: null as number | null,
    sale_gst: null as number | null,
    sale_total: null as number | null,
    sale_type: "GST",
  });
  const supabase = createClient();

const handleChange = (field: string, value: string | number | null) => {
  setFormData((prev) => ({ ...prev, [field]: value }));
};

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.from("sales").insert([formData]);
    setLoading(false);
    if (error) {
      console.error(error);
      alert("Failed to add sale.");
    } else {
      setOpen(false);
      onAdd();
      setFormData({
        sale_date: "",
        invoice_number: "",
        customer_name: "",
        asset_number: "",
        sku: "",
        type: "Laptop",
        asset_description: "",
        serial_number: "",
        sale_base_price: null,
        sale_gst: null,
        sale_total: null,
        sale_type: "GST",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Add Sale
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Sale</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Sale Date *</Label><Input type="date" required value={formData.sale_date} onChange={(e) => handleChange("sale_date", e.target.value)} /></div>
            <div><Label>Invoice Number *</Label><Input required value={formData.invoice_number} onChange={(e) => handleChange("invoice_number", e.target.value)} /></div>
            <div><Label>Customer Name</Label><Input value={formData.customer_name} onChange={(e) => handleChange("customer_name", e.target.value)} /></div>
            <div><Label>Asset Number</Label><Input value={formData.asset_number} onChange={(e) => handleChange("asset_number", e.target.value)} /></div>
            <div><Label>SKU</Label><Input value={formData.sku} onChange={(e) => handleChange("sku", e.target.value)} /></div>
            <div><Label>Type</Label><Select value={formData.type} onValueChange={(val) => handleChange("type", val)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Laptop">Laptop</SelectItem><SelectItem value="Desktop">Desktop</SelectItem><SelectItem value="Monitor">Monitor</SelectItem></SelectContent></Select></div>
            <div className="col-span-2"><Label>Description</Label><Input value={formData.asset_description} onChange={(e) => handleChange("asset_description", e.target.value)} /></div>
            <div><Label>Serial Number</Label><Input value={formData.serial_number} onChange={(e) => handleChange("serial_number", e.target.value)} /></div>
            <div><Label>Base Price</Label><Input type="number" step="0.01" value={formData.sale_base_price ?? ""} onChange={(e) => handleChange("sale_base_price", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
            <div><Label>GST</Label><Input type="number" step="0.01" value={formData.sale_gst ?? ""} onChange={(e) => handleChange("sale_gst", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
            <div><Label>Total Price</Label><Input type="number" step="0.01" value={formData.sale_total ?? ""} onChange={(e) => handleChange("sale_total", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
            <div><Label>Sale Type</Label><Select value={formData.sale_type} onValueChange={(val) => handleChange("sale_type", val)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="GST">GST</SelectItem><SelectItem value="Cash">Cash</SelectItem></SelectContent></Select></div>
          </div>
          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? "Adding..." : "Add Sale"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
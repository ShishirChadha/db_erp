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

export default function AddPurchaseDialog({ onAdd }: { onAdd: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    purchase_date: "",
    vendor_name: "",
    asset_number: "",
    sku: "",
    type: "Laptop",
    asset_description: "",
    serial_number: "",
    base_price: null as number | null,
    gst: null as number | null,
    total_price: null as number | null,
    stock_status: "In Stock",
    purchased_by: "",
    purchase_type: "GST",
  });
  const supabase = createClient();

  const handleChange = (field: string, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.from("purchases").insert([formData]);
    setLoading(false);
    if (error) {
      console.error(error);
      alert("Failed to add purchase.");
    } else {
      setOpen(false);
      onAdd();
      setFormData({
        purchase_date: "",
        vendor_name: "",
        asset_number: "",
        sku: "",
        type: "Laptop",
        asset_description: "",
        serial_number: "",
        base_price: null,
        gst: null,
        total_price: null,
        stock_status: "In Stock",
        purchased_by: "",
        purchase_type: "GST",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Add Purchase
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Purchase</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Purchase Date *</Label>
              <Input
                type="date"
                required
                value={formData.purchase_date}
                onChange={(e) => handleChange("purchase_date", e.target.value)}
              />
            </div>
            <div>
              <Label>Vendor Name</Label>
              <Input
                value={formData.vendor_name}
                onChange={(e) => handleChange("vendor_name", e.target.value)}
              />
            </div>
            <div>
              <Label>Asset Number * (unique)</Label>
              <Input
                required
                value={formData.asset_number}
                onChange={(e) => handleChange("asset_number", e.target.value)}
              />
            </div>
            <div>
              <Label>SKU</Label>
              <Input
                value={formData.sku}
                onChange={(e) => handleChange("sku", e.target.value)}
              />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={formData.type} onValueChange={(val) => handleChange("type", val)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Laptop">Laptop</SelectItem>
                  <SelectItem value="Desktop">Desktop</SelectItem>
                  <SelectItem value="Monitor">Monitor</SelectItem>
                  <SelectItem value="Tablet">Tablet</SelectItem>
                  <SelectItem value="Tiny">Tiny</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Asset Description</Label>
              <Input
                value={formData.asset_description}
                onChange={(e) => handleChange("asset_description", e.target.value)}
              />
            </div>
            <div>
              <Label>Serial Number</Label>
              <Input
                value={formData.serial_number}
                onChange={(e) => handleChange("serial_number", e.target.value)}
              />
            </div>
            <div>
              <Label>Base Price</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.base_price ?? ""}
                onChange={(e) => handleChange("base_price", e.target.value === "" ? null : parseFloat(e.target.value))}
              />
            </div>
            <div>
              <Label>GST</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.gst ?? ""}
                onChange={(e) => handleChange("gst", e.target.value === "" ? null : parseFloat(e.target.value))}
              />
            </div>
            <div>
              <Label>Total Price</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.total_price ?? ""}
                onChange={(e) => handleChange("total_price", e.target.value === "" ? null : parseFloat(e.target.value))}
              />
            </div>
            <div>
              <Label>Stock Status</Label>
              <Select value={formData.stock_status} onValueChange={(val) => handleChange("stock_status", val)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="In Stock">In Stock</SelectItem>
                  <SelectItem value="Ready for Sale">Ready for Sale</SelectItem>
                  <SelectItem value="Sold">Sold</SelectItem>
                  <SelectItem value="Available">Available</SelectItem>
                  <SelectItem value="Rent">Rent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Purchased By</Label>
              <Input
                value={formData.purchased_by}
                onChange={(e) => handleChange("purchased_by", e.target.value)}
              />
            </div>
            <div>
              <Label>Purchase Type</Label>
              <Select value={formData.purchase_type} onValueChange={(val) => handleChange("purchase_type", val)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="GST">GST</SelectItem>
                  <SelectItem value="Cash">Cash</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? "Adding..." : "Add Purchase"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
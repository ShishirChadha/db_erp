"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
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

interface Sale {
  id: string;
  sale_date: string;
  invoice_number: string;
  customer_name: string;
  asset_number: string;
  sku: string;
  type: string;
  asset_description: string;
  serial_number: string;
  sale_base_price: number | null;
  sale_gst: number | null;
  sale_total: number | null;
  sale_type: string;
  // Add other fields as needed
}

export default function EditSaleDialog({
  sale,
  open,
  onOpenChange,
  onUpdate,
}: {
  sale: Sale;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: () => void;
}) {
  const [formData, setFormData] = useState<Partial<Sale>>({});
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    setFormData(sale);
  }, [sale]);

  const handleChange = (field: keyof Sale, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { id, ...updateData } = formData;
    const { error } = await supabase
      .from("sales")
      .update(updateData)
      .eq("id", sale.id);
    setLoading(false);
    if (error) {
      console.error(error);
      alert("Update failed.");
    } else {
      onOpenChange(false);
      onUpdate();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Sale: {sale.invoice_number}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Sale Date</Label>
              <Input
                type="date"
                value={formData.sale_date?.slice(0, 10) || ""}
                onChange={(e) => handleChange("sale_date", e.target.value)}
              />
            </div>
            <div>
              <Label>Invoice Number</Label>
              <Input
                value={formData.invoice_number || ""}
                onChange={(e) => handleChange("invoice_number", e.target.value)}
              />
            </div>
            <div>
              <Label>Customer Name</Label>
              <Input
                value={formData.customer_name || ""}
                onChange={(e) => handleChange("customer_name", e.target.value)}
              />
            </div>
            <div>
              <Label>Asset Number</Label>
              <Input
                value={formData.asset_number || ""}
                disabled
                title="Asset number cannot be changed because it links to purchase"
              />
            </div>
            <div>
              <Label>SKU</Label>
              <Input
                value={formData.sku || ""}
                onChange={(e) => handleChange("sku", e.target.value)}
              />
            </div>
            <div>
              <Label>Type</Label>
              <Input
                value={formData.type || ""}
                onChange={(e) => handleChange("type", e.target.value)}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Input
                value={formData.asset_description || ""}
                onChange={(e) => handleChange("asset_description", e.target.value)}
              />
            </div>
            <div>
              <Label>Serial Number</Label>
              <Input
                value={formData.serial_number || ""}
                onChange={(e) => handleChange("serial_number", e.target.value)}
              />
            </div>
            <div>
              <Label>Base Price</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.sale_base_price ?? ""}
                onChange={(e) =>
                  handleChange("sale_base_price", e.target.value === "" ? null : parseFloat(e.target.value))
                }
              />
            </div>
            <div>
              <Label>GST</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.sale_gst ?? ""}
                onChange={(e) =>
                  handleChange("sale_gst", e.target.value === "" ? null : parseFloat(e.target.value))
                }
              />
            </div>
            <div>
              <Label>Total Price</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.sale_total ?? ""}
                onChange={(e) =>
                  handleChange("sale_total", e.target.value === "" ? null : parseFloat(e.target.value))
                }
              />
            </div>
            <div>
              <Label>Sale Type</Label>
              <Select
                value={formData.sale_type || ""}
                onValueChange={(val) => handleChange("sale_type", val)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GST">GST</SelectItem>
                  <SelectItem value="Cash">Cash</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
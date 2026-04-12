"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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

interface Purchase {
  id: string;
  purchase_date: string;
  vendor_name: string;
  asset_number: string;
  sku: string;
  type: string;
  asset_description: string;
  serial_number: string;
  base_price: number | null;
  gst: number | null;
  total_price: number | null;
  stock_status: string;
  purchased_by: string;
  purchase_type: string;
}

export default function EditPurchaseDialog({
  purchase,
  open,
  onOpenChange,
  onUpdate,
}: {
  purchase: Purchase;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: () => void; // to refresh the list after update
}) {
  const [formData, setFormData] = useState<Partial<Purchase>>({});
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  // Pre-fill form when purchase changes
  useEffect(() => {
    setFormData(purchase);
  }, [purchase]);

  const handleChange = (field: keyof Purchase, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Remove id from update data
    const { id, ...updateData } = formData;

    const { error } = await supabase
      .from("purchases")
      .update(updateData)
      .eq("id", purchase.id);

    setLoading(false);

    if (error) {
      console.error("Error updating purchase:", error);
      alert("Failed to update. Check console.");
    } else {
      onOpenChange(false);
      onUpdate(); // refresh the parent list
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Purchase: {purchase.asset_number}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Purchase Date</Label>
              <Input
                type="date"
                value={formData.purchase_date?.slice(0, 10) || ""}
                onChange={(e) => handleChange("purchase_date", e.target.value)}
              />
            </div>
            <div>
              <Label>Vendor Name</Label>
              <Input
                value={formData.vendor_name || ""}
                onChange={(e) => handleChange("vendor_name", e.target.value)}
              />
            </div>
            <div>
              <Label>Asset Number</Label>
              <Input
                value={formData.asset_number || ""}
                onChange={(e) => handleChange("asset_number", e.target.value)}
                disabled // if you want to keep it read-only
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
              <Label>Asset Description</Label>
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
                value={formData.base_price ?? ""}
                onChange={(e) =>
                  handleChange("base_price", e.target.value === "" ? null : parseFloat(e.target.value))
                }
              />
            </div>
            <div>
              <Label>GST</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.gst ?? ""}
                onChange={(e) =>
                  handleChange("gst", e.target.value === "" ? null : parseFloat(e.target.value))
                }
              />
            </div>
            <div>
              <Label>Total Price</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.total_price ?? ""}
                onChange={(e) =>
                  handleChange("total_price", e.target.value === "" ? null : parseFloat(e.target.value))
                }
              />
            </div>
            <div>
              <Label>Stock Status</Label>
              <Select
                value={formData.stock_status || ""}
                onValueChange={(val) => handleChange("stock_status", val)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="In Stock">In Stock</SelectItem>
                  <SelectItem value="Ready for Sale">Ready for Sale</SelectItem>
                  <SelectItem value="Sold">Sold</SelectItem>
                  <SelectItem value="Available">Available</SelectItem>
                  <SelectItem value="Rent">Rent</SelectItem>
                  <SelectItem value="Faulty">Faulty</SelectItem>
                  <SelectItem value="Curitics">Curitics</SelectItem>
                  <SelectItem value="Rental">Rental</SelectItem>
                  <SelectItem value="DB">DB</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Purchased By</Label>
              <Input
                value={formData.purchased_by || ""}
                onChange={(e) => handleChange("purchased_by", e.target.value)}
              />
            </div>
            <div>
              <Label>Purchase Type</Label>
              <Select
                value={formData.purchase_type || ""}
                onValueChange={(val) => handleChange("purchase_type", val)}
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

          <div className="flex justify-end space-x-2 pt-4">
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
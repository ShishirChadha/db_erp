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

interface Customer {
  id: string;
  customer_name: string;
  type: string;
  has_gst: boolean;
  gst_number: string;
  address: string;
  phone: string;
  email: string;
  source: string;
  google_review: boolean;
  social_following: string;
}

export default function EditCustomerDialog({
  customer,
  open,
  onOpenChange,
  onUpdate,
}: {
  customer: Customer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: () => void;
}) {
  const [formData, setFormData] = useState<Partial<Customer>>({});
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    setFormData(customer);
  }, [customer]);

  const handleChange = (field: keyof Customer, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { id, ...updateData } = formData;
    const { error } = await supabase
      .from("customers")
      .update(updateData)
      .eq("id", customer.id);
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Customer: {customer.customer_name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Customer Name</Label>
              <Input
                value={formData.customer_name || ""}
                onChange={(e) => handleChange("customer_name", e.target.value)}
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
                  <SelectItem value="Business">Business</SelectItem>
                  <SelectItem value="Individual">Individual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="has_gst"
                checked={formData.has_gst || false}
                onChange={(e) => handleChange("has_gst", e.target.checked)}
                className="h-4 w-4"
              />
              <Label htmlFor="has_gst">Has GST</Label>
            </div>
            <div>
              <Label>GST Number</Label>
              <Input
                value={formData.gst_number || ""}
                onChange={(e) => handleChange("gst_number", e.target.value)}
              />
            </div>
            <div>
              <Label>Address</Label>
              <Input
                value={formData.address || ""}
                onChange={(e) => handleChange("address", e.target.value)}
              />
            </div>
            <div>
              <Label>Phone</Label>
              <Input
                value={formData.phone || ""}
                onChange={(e) => handleChange("phone", e.target.value)}
              />
            </div>
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={formData.email || ""}
                onChange={(e) => handleChange("email", e.target.value)}
              />
            </div>
            <div>
              <Label>Source</Label>
              <Input
                value={formData.source || ""}
                onChange={(e) => handleChange("source", e.target.value)}
              />
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="google_review"
                checked={formData.google_review || false}
                onChange={(e) => handleChange("google_review", e.target.checked)}
                className="h-4 w-4"
              />
              <Label htmlFor="google_review">Google Review</Label>
            </div>
            <div>
              <Label>Social Following</Label>
              <Select
                value={formData.social_following || ""}
                onValueChange={(val) => handleChange("social_following", val)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FB">FB</SelectItem>
                  <SelectItem value="Insta">Insta</SelectItem>
                  <SelectItem value="Both">Both</SelectItem>
                  <SelectItem value="None">None</SelectItem>
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
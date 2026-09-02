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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useAsyncAction } from "@/lib/useAsyncAction";

interface Customer {
  id: string;
  customer_name: string;
  type: string;
  contact_person?: string | null;
  has_gst: boolean;
  gst_number: string;
  address: string;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  pincode?: string | null;
  phone: string;
  email: string;
  alt_email?: string | null;
  source: string;
  google_review: boolean;
  social_following: string;
  state?: string;
  state_code?: string;
}

// Composes the legacy flat `address` column from the structured sub-fields on
// every save -- see the matching comment in AddCustomerDialog.tsx.
function composeAddress(f: { address_line1?: string | null; address_line2?: string | null; city?: string | null; state?: string | null; pincode?: string | null }): string {
  return [f.address_line1, f.address_line2, f.city, [f.state, f.pincode].filter(Boolean).join(" - ")]
    .filter(Boolean)
    .join(", ");
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
  const [gstFetching, setGstFetching] = useState(false);
  const [gstError, setGstError] = useState("");
  const supabase = createClient();

  useEffect(() => {
    // A customer created before structured address fields existed has them all
    // null with the old data only in the flat `address` -- fall back to showing
    // that in Address Line 1 rather than presenting a blank form and silently
    // discarding it the next time this customer is saved.
    const needsAddressFallback = !customer.address_line1 && !customer.address_line2 && !customer.city && !customer.pincode && customer.address;
    setFormData(needsAddressFallback ? { ...customer, address_line1: customer.address } : customer);
    setGstError("");
  }, [customer]);

  const handleChange = (field: keyof Customer, value: string | boolean) => {
    // Business-only fields (contact person, GST) don't apply to an Individual --
    // clear them on switch so a stale value can't get silently submitted while hidden.
    if (field === "type" && value === "Individual") {
      setFormData((prev) => ({ ...prev, type: value, contact_person: "", has_gst: false, gst_number: "" }));
      return;
    }
    // GST Number only applies once Has GST is checked -- clear it on uncheck so a
    // stale value can't get silently submitted while the field is hidden.
    if (field === "has_gst" && value === false) {
      setFormData((prev) => ({ ...prev, has_gst: false, gst_number: "" }));
      return;
    }
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleFetchGst = async () => {
    if (!formData.gst_number?.trim()) return;
    setGstFetching(true);
    setGstError("");
    try {
      const res = await apiFetch(`/api/gst?gst=${encodeURIComponent(formData.gst_number.trim())}`);
      const data = await res.json();
      setFormData((prev) => ({
        ...prev,
        customer_name: data.company_name || prev.customer_name,
        address_line1: data.address || prev.address_line1,
        state: data.state || prev.state,
        state_code: data.state_code || prev.state_code,
      }));
      if (!res.ok) setGstError(data.error || "Could not verify this GSTIN, but state was derived from it.");
    } catch (err: any) {
      setGstError("Failed to reach GST lookup service.");
    } finally {
      setGstFetching(false);
    }
  };

  const { run: handleSubmit, pending: loading } = useAsyncAction(async (e: React.FormEvent) => {
    e.preventDefault();
    const { id, ...updateData } = formData;
    const payload = { ...updateData, address: composeAddress(formData) };
    const { error } = await supabase
      .from("customers")
      .update(payload)
      .eq("id", customer.id);
    if (error) {
      console.error(error);
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
            {formData.type === "Business" && (
              <div>
                <Label>Contact Person</Label>
                <Input
                  value={formData.contact_person || ""}
                  onChange={(e) => handleChange("contact_person", e.target.value)}
                />
              </div>
            )}
            {formData.type === "Business" && (
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="has_gst"
                  checked={formData.has_gst || false}
                  onCheckedChange={(v) => handleChange("has_gst", !!v)}
                />
                <Label htmlFor="has_gst">Has GST</Label>
              </div>
            )}
            {formData.type === "Business" && formData.has_gst && (
              <div>
                <Label>GST Number</Label>
                <div className="flex gap-2">
                  <Input
                    value={formData.gst_number || ""}
                    onChange={(e) => handleChange("gst_number", e.target.value.toUpperCase())}
                  />
                  <Button type="button" variant="outline" disabled={gstFetching || !formData.gst_number?.trim()} onClick={handleFetchGst}>
                    {gstFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fetch"}
                  </Button>
                </div>
                {gstError && <p className="text-xs text-destructive mt-1">{gstError}</p>}
                {formData.state && <p className="text-xs text-muted-foreground mt-1">State: {formData.state} ({formData.state_code})</p>}
              </div>
            )}
            <div className="col-span-2">
              <Label>Address Line 1</Label>
              <Input
                value={formData.address_line1 || ""}
                onChange={(e) => handleChange("address_line1", e.target.value)}
              />
            </div>
            <div className="col-span-2">
              <Label>Address Line 2</Label>
              <Input
                value={formData.address_line2 || ""}
                onChange={(e) => handleChange("address_line2", e.target.value)}
              />
            </div>
            <div>
              <Label>City</Label>
              <Input
                value={formData.city || ""}
                onChange={(e) => handleChange("city", e.target.value)}
              />
            </div>
            <div>
              <Label>Pincode</Label>
              <Input
                value={formData.pincode || ""}
                onChange={(e) => handleChange("pincode", e.target.value)}
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
            <div className="col-span-2">
              <Label>Email 2 (optional)</Label>
              <Input
                type="email"
                value={formData.alt_email || ""}
                onChange={(e) => handleChange("alt_email", e.target.value)}
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
              <Checkbox
                id="google_review"
                checked={formData.google_review || false}
                onCheckedChange={(v) => handleChange("google_review", !!v)}
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
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

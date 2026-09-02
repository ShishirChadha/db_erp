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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useAsyncAction } from "@/lib/useAsyncAction";
import { checkDuplicateCustomer } from "@/lib/customer-dedupe";

const emptyForm = {
  customer_name: "",
  type: "Individual",
  contact_person: "",
  has_gst: false,
  gst_number: "",
  address_line1: "",
  address_line2: "",
  city: "",
  pincode: "",
  phone: "",
  email: "",
  alt_email: "",
  source: "",
  google_review: false,
  social_following: "None",
  state: "",
  state_code: "",
};

// Composes the legacy flat `address` column from the structured sub-fields --
// kept in sync on every save (rather than left null going forward, unlike the
// Vendors precedent) because customer address is actively read elsewhere
// (GST invoice generation/PDF rendering, lib/invoice-finalize.ts) and those
// call sites shouldn't need to be rewritten just to keep working.
function composeAddress(f: { address_line1: string; address_line2: string; city: string; state: string; pincode: string }): string {
  return [f.address_line1, f.address_line2, f.city, [f.state, f.pincode].filter(Boolean).join(" - ")]
    .filter(Boolean)
    .join(", ");
}

export default function AddCustomerDialog({ onAdd }: { onAdd: (created?: any) => void }) {
  const [open, setOpen] = useState(false);
  const [gstFetching, setGstFetching] = useState(false);
  const [gstError, setGstError] = useState("");
  const [formData, setFormData] = useState(emptyForm);
  const [duplicateError, setDuplicateError] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState("");
  const supabase = createClient();

  const handleChange = (field: string, value: string | boolean) => {
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

  // Auto-fills legal name, address, and state from the GSTIN itself -- the
  // state code is what the GST engine (IGST vs CGST/SGST) actually needs. The
  // GST lookup only ever returns one flat address string (no structured
  // city/pincode breakdown), so it's dropped into Address Line 1 as a starting
  // point -- still fully editable/splittable by hand afterward.
  const handleFetchGst = async () => {
    if (!formData.gst_number.trim()) return;
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
    setDuplicateError("");
    setDuplicateWarning("");

    const { blockingMatch, nameWarningMatch } = await checkDuplicateCustomer(supabase, {
      customer_name: formData.customer_name,
      phone: formData.phone,
    });
    if (blockingMatch) {
      setDuplicateError(`A customer with this phone number already exists: "${blockingMatch.customer_name}". Use that customer instead of creating a duplicate.`);
      return;
    }
    if (nameWarningMatch) {
      setDuplicateWarning(`Note: a customer named "${nameWarningMatch.customer_name}" already exists with a different phone number. Continuing will create a separate customer.`);
    }

    const payload = { ...formData, address: composeAddress(formData) };
    const { data, error } = await supabase.from("customers").insert([payload]).select().single();
    if (error) {
      console.error(error);
      // 23505 = unique_violation -- the customers_active_phone_unique index catching a
      // race the pre-check above missed (two staff saving the same new phone at once).
      if ((error as any).code === "23505") {
        setDuplicateError("A customer with this phone number already exists.");
      } else {
        alert("Failed to add customer.");
      }
    } else {
      setOpen(false);
      onAdd(data);
      setFormData(emptyForm);
      setGstError("");
      setDuplicateWarning("");
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Add Customer
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Add New Customer</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Customer Name *</Label><Input required value={formData.customer_name} onChange={(e) => handleChange("customer_name", e.target.value)} /></div>
            <div><Label>Type</Label><Select value={formData.type} onValueChange={(val) => handleChange("type", val)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Business">Business</SelectItem><SelectItem value="Individual">Individual</SelectItem></SelectContent></Select></div>
            {formData.type === "Business" && (
              <div><Label>Contact Person</Label><Input value={formData.contact_person} onChange={(e) => handleChange("contact_person", e.target.value)} /></div>
            )}
            {formData.type === "Business" && (
              <div className="flex items-center space-x-2"><Checkbox id="has_gst" checked={formData.has_gst} onCheckedChange={(v) => handleChange("has_gst", !!v)} /><Label htmlFor="has_gst">Has GST</Label></div>
            )}
            {formData.type === "Business" && formData.has_gst && (
              <div className="col-span-2">
                <Label>GST Number</Label>
                <div className="flex gap-2">
                  <Input value={formData.gst_number} onChange={(e) => handleChange("gst_number", e.target.value.toUpperCase())} placeholder="e.g. 09AAICD2790D1ZM" />
                  <Button type="button" variant="outline" disabled={gstFetching || !formData.gst_number.trim()} onClick={handleFetchGst}>
                    {gstFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fetch"}
                  </Button>
                </div>
                {gstError && <p className="text-xs text-destructive mt-1">{gstError}</p>}
                {formData.state && <p className="text-xs text-muted-foreground mt-1">State: {formData.state} ({formData.state_code})</p>}
              </div>
            )}
            <div className="col-span-2"><Label>Address Line 1</Label><Input value={formData.address_line1} onChange={(e) => handleChange("address_line1", e.target.value)} /></div>
            <div className="col-span-2"><Label>Address Line 2</Label><Input value={formData.address_line2} onChange={(e) => handleChange("address_line2", e.target.value)} /></div>
            <div><Label>City</Label><Input value={formData.city} onChange={(e) => handleChange("city", e.target.value)} /></div>
            <div><Label>Pincode</Label><Input value={formData.pincode} onChange={(e) => handleChange("pincode", e.target.value)} /></div>
            <div>
              <Label>Phone</Label>
              <Input value={formData.phone} onChange={(e) => { handleChange("phone", e.target.value); setDuplicateError(""); }} />
              {duplicateError && <p className="text-xs text-destructive mt-1">{duplicateError}</p>}
            </div>
            <div><Label>Email</Label><Input type="email" value={formData.email} onChange={(e) => handleChange("email", e.target.value)} /></div>
            <div className="col-span-2"><Label>Email 2 (optional)</Label><Input type="email" value={formData.alt_email} onChange={(e) => handleChange("alt_email", e.target.value)} /></div>
            <div><Label>Source</Label><Input value={formData.source} onChange={(e) => handleChange("source", e.target.value)} /></div>
            <div className="flex items-center space-x-2"><Checkbox id="google_review" checked={formData.google_review} onCheckedChange={(v) => handleChange("google_review", !!v)} /><Label htmlFor="google_review">Google Review</Label></div>
            <div><Label>Social Following</Label><Select value={formData.social_following} onValueChange={(val) => handleChange("social_following", val)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="FB">FB</SelectItem><SelectItem value="Insta">Insta</SelectItem><SelectItem value="Both">Both</SelectItem><SelectItem value="None">None</SelectItem></SelectContent></Select></div>
          </div>
          {duplicateWarning && (
            <p className="text-xs text-warning bg-warning/10 rounded px-3 py-2">{duplicateWarning}</p>
          )}
          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>Cancel</Button>
            <Button type="submit" loading={loading}>Add Customer</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

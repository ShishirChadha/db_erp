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
import { Plus, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useAsyncAction } from "@/lib/useAsyncAction";

export default function AddCustomerDialog({ onAdd }: { onAdd: (created?: any) => void }) {
  const [open, setOpen] = useState(false);
  const [gstFetching, setGstFetching] = useState(false);
  const [gstError, setGstError] = useState("");
  const [formData, setFormData] = useState({
    customer_name: "",
    type: "Individual",
    has_gst: false,
    gst_number: "",
    address: "",
    phone: "",
    email: "",
    source: "",
    google_review: false,
    social_following: "None",
    state: "",
    state_code: "",
  });
  const supabase = createClient();

  const handleChange = (field: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Auto-fills legal name, address, and state from the GSTIN itself -- the
  // state code is what the GST engine (IGST vs CGST/SGST) actually needs.
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
        address: data.address || prev.address,
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
    const { data, error } = await supabase.from("customers").insert([formData]).select().single();
    if (error) {
      console.error(error);
      alert("Failed to add customer.");
    } else {
      setOpen(false);
      onAdd(data);
      setFormData({
        customer_name: "",
        type: "Individual",
        has_gst: false,
        gst_number: "",
        address: "",
        phone: "",
        email: "",
        source: "",
        google_review: false,
        social_following: "None",
        state: "",
        state_code: "",
      });
      setGstError("");
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
            <div className="flex items-center space-x-2"><input type="checkbox" id="has_gst" checked={formData.has_gst} onChange={(e) => handleChange("has_gst", e.target.checked)} /><Label htmlFor="has_gst">Has GST</Label></div>
            <div className="col-span-2">
              <Label>GST Number</Label>
              <div className="flex gap-2">
                <Input value={formData.gst_number} onChange={(e) => handleChange("gst_number", e.target.value.toUpperCase())} placeholder="e.g. 09AAICD2790D1ZM" />
                <Button type="button" variant="outline" disabled={gstFetching || !formData.gst_number.trim()} onClick={handleFetchGst}>
                  {gstFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fetch"}
                </Button>
              </div>
              {gstError && <p className="text-xs text-red-500 mt-1">{gstError}</p>}
              {formData.state && <p className="text-xs text-gray-400 mt-1">State: {formData.state} ({formData.state_code})</p>}
            </div>
            <div><Label>Address</Label><Input value={formData.address} onChange={(e) => handleChange("address", e.target.value)} /></div>
            <div><Label>Phone</Label><Input value={formData.phone} onChange={(e) => handleChange("phone", e.target.value)} /></div>
            <div><Label>Email</Label><Input type="email" value={formData.email} onChange={(e) => handleChange("email", e.target.value)} /></div>
            <div><Label>Source</Label><Input value={formData.source} onChange={(e) => handleChange("source", e.target.value)} /></div>
            <div className="flex items-center space-x-2"><input type="checkbox" id="google_review" checked={formData.google_review} onChange={(e) => handleChange("google_review", e.target.checked)} /><Label htmlFor="google_review">Google Review</Label></div>
            <div><Label>Social Following</Label><Select value={formData.social_following} onValueChange={(val) => handleChange("social_following", val)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="FB">FB</SelectItem><SelectItem value="Insta">Insta</SelectItem><SelectItem value="Both">Both</SelectItem><SelectItem value="None">None</SelectItem></SelectContent></Select></div>
          </div>
          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>Cancel</Button>
            <Button type="submit" loading={loading}>Add Customer</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
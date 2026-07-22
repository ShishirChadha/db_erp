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

// Lightweight customer-add for the Sell/Service quick-entry flows -- just enough to
// identify who the customer is (individual or business) and reach them. The full CRM
// fields (GST, marketing source, social following, etc.) stay on the main Customers
// page's AddCustomerDialog; this form doesn't need or show them.
export default function QuickAddCustomerDialog({ onAdd }: { onAdd: (created?: any) => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    customer_name: "",
    type: "Individual",
    address: "",
    phone: "",
    email: "",
    has_gst: false,
    gst_number: "",
  });
  const supabase = createClient();

  const handleChange = (field: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.from("customers").insert([formData]).select().single();
    setLoading(false);
    if (error) {
      console.error(error);
      alert("Failed to add customer.");
    } else {
      setOpen(false);
      onAdd(data);
      setFormData({ customer_name: "", type: "Individual", address: "", phone: "", email: "", has_gst: false, gst_number: "" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Plus className="mr-2 h-4 w-4" /> New Customer
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add New Customer</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><Label>Customer Name *</Label><Input required value={formData.customer_name} onChange={(e) => handleChange("customer_name", e.target.value)} /></div>
          <div>
            <Label>Type</Label>
            <Select value={formData.type} onValueChange={(val) => handleChange("type", val)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Individual">Individual</SelectItem>
                <SelectItem value="Business">Business</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Phone</Label><Input value={formData.phone} onChange={(e) => handleChange("phone", e.target.value)} /></div>
          <div><Label>Email</Label><Input type="email" value={formData.email} onChange={(e) => handleChange("email", e.target.value)} /></div>
          <div><Label>Address</Label><Input value={formData.address} onChange={(e) => handleChange("address", e.target.value)} /></div>
          {formData.type === "Business" && (
            <>
              <div className="flex items-center space-x-2">
                <input type="checkbox" id="qa_has_gst" checked={formData.has_gst} onChange={(e) => handleChange("has_gst", e.target.checked)} />
                <Label htmlFor="qa_has_gst">Has GST</Label>
              </div>
              <div><Label>GST Number</Label><Input value={formData.gst_number} onChange={(e) => handleChange("gst_number", e.target.value)} /></div>
            </>
          )}
          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? "Adding..." : "Add Customer"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

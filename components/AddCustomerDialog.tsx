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

export default function AddCustomerDialog({ onAdd }: { onAdd: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
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
  });
  const supabase = createClient();

  const handleChange = (field: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.from("customers").insert([formData]);
    setLoading(false);
    if (error) {
      console.error(error);
      alert("Failed to add customer.");
    } else {
      setOpen(false);
      onAdd();
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
      });
    }
  };

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
            <div><Label>GST Number</Label><Input value={formData.gst_number} onChange={(e) => handleChange("gst_number", e.target.value)} /></div>
            <div><Label>Address</Label><Input value={formData.address} onChange={(e) => handleChange("address", e.target.value)} /></div>
            <div><Label>Phone</Label><Input value={formData.phone} onChange={(e) => handleChange("phone", e.target.value)} /></div>
            <div><Label>Email</Label><Input type="email" value={formData.email} onChange={(e) => handleChange("email", e.target.value)} /></div>
            <div><Label>Source</Label><Input value={formData.source} onChange={(e) => handleChange("source", e.target.value)} /></div>
            <div className="flex items-center space-x-2"><input type="checkbox" id="google_review" checked={formData.google_review} onChange={(e) => handleChange("google_review", e.target.checked)} /><Label htmlFor="google_review">Google Review</Label></div>
            <div><Label>Social Following</Label><Select value={formData.social_following} onValueChange={(val) => handleChange("social_following", val)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="FB">FB</SelectItem><SelectItem value="Insta">Insta</SelectItem><SelectItem value="Both">Both</SelectItem><SelectItem value="None">None</SelectItem></SelectContent></Select></div>
          </div>
          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? "Adding..." : "Add Customer"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
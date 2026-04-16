"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import FileUpload from "@/components/FileUpload";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";

// ---------- Inline Add Vendor Component (same as in AddPurchaseDialog) ----------
function AddVendorInline({ onVendorAdded }: { onVendorAdded: (vendorId: string, vendorName: string) => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    company_name: "",
    spoc_name: "",
    owner_name: "",
    phone: "",
    email: "",
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    pincode: "",
    has_gst: false,
    gst_number: "",
    gst_company_name: "",
  });
  const supabase = createClient();

  const handleChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.company_name) {
      alert("Company name is required");
      return;
    }
    setLoading(true);
    const payload = {
      company_name: formData.company_name,
      spoc_name: formData.spoc_name,
      owner_name: formData.owner_name,
      phone: formData.phone,
      email: formData.email,
      address_line1: formData.address_line1,
      address_line2: formData.address_line2,
      city: formData.city,
      state: formData.state,
      pincode: formData.pincode,
      has_gst: formData.has_gst,
      gst_number: formData.gst_number,
      gst_company_name: formData.gst_company_name,
    };
    const { data, error } = await supabase.from("vendors").insert([payload]).select().single();
    setLoading(false);
    if (error) {
      alert("Failed to add vendor: " + error.message);
    } else {
      onVendorAdded(data.id, data.company_name);
      setOpen(false);
      setFormData({
        company_name: "",
        spoc_name: "",
        owner_name: "",
        phone: "",
        email: "",
        address_line1: "",
        address_line2: "",
        city: "",
        state: "",
        pincode: "",
        has_gst: false,
        gst_number: "",
        gst_company_name: "",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="mt-2 w-full">
          <Plus className="mr-2 h-3 w-3" /> Add New Vendor
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Vendor</DialogTitle>
          <DialogDescription className="sr-only">Fill in all vendor details</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div><Label>Company Name *</Label><Input required value={formData.company_name} onChange={(e) => handleChange("company_name", e.target.value)} /></div>
          <div><Label>SPOC Name</Label><Input value={formData.spoc_name} onChange={(e) => handleChange("spoc_name", e.target.value)} /></div>
          <div><Label>Owner Name</Label><Input value={formData.owner_name} onChange={(e) => handleChange("owner_name", e.target.value)} /></div>
          <div><Label>Phone</Label><Input value={formData.phone} onChange={(e) => handleChange("phone", e.target.value)} /></div>
          <div><Label>Email</Label><Input type="email" value={formData.email} onChange={(e) => handleChange("email", e.target.value)} /></div>
          <div><Label>Address Line 1</Label><Input value={formData.address_line1} onChange={(e) => handleChange("address_line1", e.target.value)} /></div>
          <div><Label>Address Line 2</Label><Input value={formData.address_line2} onChange={(e) => handleChange("address_line2", e.target.value)} /></div>
          <div><Label>City</Label><Input value={formData.city} onChange={(e) => handleChange("city", e.target.value)} /></div>
          <div><Label>State</Label><Input value={formData.state} onChange={(e) => handleChange("state", e.target.value)} /></div>
          <div><Label>Pincode</Label><Input value={formData.pincode} onChange={(e) => handleChange("pincode", e.target.value)} /></div>
          <div className="flex items-center space-x-2">
            <input type="checkbox" id="has_gst" checked={formData.has_gst} onChange={(e) => handleChange("has_gst", e.target.checked)} />
            <Label htmlFor="has_gst">Has GST</Label>
          </div>
          {formData.has_gst && (
            <>
              <div><Label>GST Number</Label><Input value={formData.gst_number} onChange={(e) => handleChange("gst_number", e.target.value.toUpperCase())} /></div>
              <div><Label>GST Company Name</Label><Input value={formData.gst_company_name} onChange={(e) => handleChange("gst_company_name", e.target.value)} /></div>
            </>
          )}
          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? "Saving..." : "Save Vendor"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Purchase Interface ----------
interface Purchase {
  id: string;
  entry_date: string;
  purchase_date: string;
  vendor_id: string | null;
  vendor_name: string;
  asset_number: string;
  type: string;
  brand: string;
  model: string;
  cpu: string;
  ram: string;
  ssd: string;
  charger: boolean;
  screen_size: string;
  monitor_size: string;
  has_keyboard: boolean;
  has_mouse: boolean;
  sku: string;
  asset_description: string;
  serial_number: string;
  base_price: number | null;
  gst: number | null;
  total_price: number | null;
  selling_price: number | null;
  expense: boolean;
  expense_amount: number | null;
  expense_description: string;
  stock_status: string;
  status_purchase: string;
  status_other: string;
  purchased_by_type: string;
  purchased_by_other: string;
  remarks: string;
  purchase_type: string;
  purchased_invoice_number: string;
  eway_bill_no: string;
  public_photo_url: string;   // ✅ new field
}

// ---------- Main EditPurchaseDialog ----------
export default function EditPurchaseDialog({
  purchase,
  open,
  onOpenChange,
  onUpdate,
}: {
  purchase: Purchase;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: () => void;
}) {
  const [formData, setFormData] = useState<Partial<Purchase>>({});
  const [loading, setLoading] = useState(false);
  const [vendors, setVendors] = useState<{ id: string; company_name: string }[]>([]);
  const [loadingVendors, setLoadingVendors] = useState(false);
  const supabase = createClient();

  const fetchVendors = async () => {
    setLoadingVendors(true);
    const { data, error } = await supabase
      .from("vendors")
      .select("id, company_name")
      .eq("is_deleted", false)
      .order("company_name");
    if (!error && data) setVendors(data);
    setLoadingVendors(false);
  };

  useEffect(() => {
    if (open) fetchVendors();
  }, [open]);

  useEffect(() => {
    setFormData(purchase);
  }, [purchase]);

  const handleChange = (field: keyof Purchase, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Auto-calc total price when base_price, gst, or purchase_type changes
    if (field === "base_price" || field === "gst" || field === "purchase_type") {
      const base = field === "base_price" ? value : formData.base_price;
      const gstRate = field === "gst" ? value : formData.gst;
      const type = field === "purchase_type" ? value : formData.purchase_type;
      if (base !== null && base !== undefined) {
        if (type === "GST" && gstRate !== null && gstRate !== undefined && gstRate > 0) {
          const total = base + (base * gstRate) / 100;
          setFormData((prev) => ({ ...prev, total_price: total }));
        } else {
          setFormData((prev) => ({ ...prev, total_price: base }));
        }
      }
    }
    if (field === "purchase_type" && value !== "GST") {
      setFormData((prev) => ({ ...prev, gst: null }));
    }
    if (field === "vendor_id") {
      const selected = vendors.find((v) => v.id === value);
      if (selected) setFormData((prev) => ({ ...prev, vendor_name: selected.company_name }));
    }
  };

  const handleVendorAdded = (vendorId: string, vendorName: string) => {
    setVendors((prev) => [...prev, { id: vendorId, company_name: vendorName }]);
    setFormData((prev) => ({ ...prev, vendor_id: vendorId, vendor_name: vendorName }));
    fetchVendors();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { id, ...updateData } = formData;
    const { error } = await supabase
      .from("purchases")
      .update(updateData)
      .eq("id", purchase.id);
    setLoading(false);
    if (error) {
      console.error(error);
      alert(`Update failed: ${error.message}`);
    } else {
      onOpenChange(false);
      onUpdate();
    }
  };

  const isGST = formData.purchase_type === "GST";
  const isDesktop = formData.type === "Desktop";
  const isLaptopOrMonitor = formData.type === "Laptop" || formData.type === "Monitor";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Purchase: {purchase.asset_number}</DialogTitle>
          <DialogDescription className="sr-only">Edit purchase details</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Row 1: Entry Date, Purchase Date */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Entry Date</Label>
              <Input type="date" value={formData.entry_date?.slice(0, 10) || ""} disabled className="bg-gray-100" />
            </div>
            <div>
              <Label>Purchase Date</Label>
              <Input type="date" value={formData.purchase_date?.slice(0, 10) || ""} onChange={(e) => handleChange("purchase_date", e.target.value)} />
            </div>
          </div>

          {/* Row 2: Vendor and Asset Number */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="min-w-0">
              <Label>Vendor</Label>
              <Select value={formData.vendor_id || ""} onValueChange={(val) => handleChange("vendor_id", val)}>
                <SelectTrigger className="w-full truncate">
                  <SelectValue placeholder={loadingVendors ? "Loading vendors..." : "Select vendor"} />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id} className="truncate">
                      {v.company_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <AddVendorInline onVendorAdded={handleVendorAdded} />
            </div>
            <div>
              <Label>Asset Number</Label>
              <Input value={formData.asset_number || ""} onChange={(e) => handleChange("asset_number", e.target.value)} />
            </div>
          </div>

          {/* Row 3: Type, Brand, Model, SKU */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label>Type</Label>
              <Select value={formData.type || ""} onValueChange={(val) => handleChange("type", val)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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
              <Label>Brand</Label>
              <Input value={formData.brand || ""} onChange={(e) => handleChange("brand", e.target.value)} />
            </div>
            <div>
              <Label>Model</Label>
              <Input value={formData.model || ""} onChange={(e) => handleChange("model", e.target.value)} />
            </div>
            <div>
              <Label>SKU</Label>
              <Input value={formData.sku || ""} disabled className="bg-gray-100" />
            </div>
          </div>

          {/* Hardware Specifications (Laptop/Desktop/Tiny) */}
          {(formData.type === "Laptop" || formData.type === "Desktop" || formData.type === "Tiny") && (
            <div className="border rounded-lg p-4 space-y-4">
              <h3 className="font-semibold">Hardware Specifications</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <Label>CPU</Label>
                  <Input value={formData.cpu || ""} onChange={(e) => handleChange("cpu", e.target.value)} />
                </div>
                <div>
                  <Label>RAM</Label>
                  <Input value={formData.ram || ""} onChange={(e) => handleChange("ram", e.target.value)} />
                </div>
                <div>
                  <Label>SSD / HDD</Label>
                  <Input value={formData.ssd || ""} onChange={(e) => handleChange("ssd", e.target.value)} />
                </div>
                <div className="flex items-center space-x-2">
                  <input type="checkbox" id="charger" checked={formData.charger || false} onChange={(e) => handleChange("charger", e.target.checked)} />
                  <Label htmlFor="charger">Charger Included?</Label>
                </div>
              </div>
            </div>
          )}

          {/* Screen Size for Laptop / Monitor */}
          {isLaptopOrMonitor && (
            <div>
              <Label>Screen Size (inches)</Label>
              <Input value={formData.screen_size || ""} onChange={(e) => handleChange("screen_size", e.target.value)} placeholder="e.g., 15.6, 14.0, 27" />
            </div>
          )}

          {/* Desktop-specific fields */}
          {isDesktop && (
            <div className="border rounded-lg p-4 space-y-4">
              <h3 className="font-semibold">Desktop Accessories</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Monitor Size (inches)</Label>
                  <Input value={formData.monitor_size || ""} onChange={(e) => handleChange("monitor_size", e.target.value)} placeholder="e.g., 24, 27" />
                </div>
                <div className="flex items-center space-x-2">
                  <input type="checkbox" id="has_keyboard" checked={formData.has_keyboard || false} onChange={(e) => handleChange("has_keyboard", e.target.checked)} />
                  <Label htmlFor="has_keyboard">Keyboard Included?</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <input type="checkbox" id="has_mouse" checked={formData.has_mouse || false} onChange={(e) => handleChange("has_mouse", e.target.checked)} />
                  <Label htmlFor="has_mouse">Mouse Included?</Label>
                </div>
              </div>
            </div>
          )}

          {/* Asset Description, Serial Number, Pricing, Public Photo URL */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label>Asset Description</Label>
              <Input value={formData.asset_description || ""} onChange={(e) => handleChange("asset_description", e.target.value)} />
            </div>
            <div>
              <Label>Serial Number</Label>
              <Input value={formData.serial_number || ""} onChange={(e) => handleChange("serial_number", e.target.value)} />
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
              <Label>Purchase Type</Label>
              <Select value={formData.purchase_type || "GST"} onValueChange={(val) => handleChange("purchase_type", val)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GST">GST</SelectItem>
                  <SelectItem value="Cash">Cash</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isGST && (
              <>
                <div>
                  <Label>GST (%)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.gst ?? ""}
                    onChange={(e) => handleChange("gst", e.target.value === "" ? null : parseFloat(e.target.value))}
                  />
                </div>
                <div>
                  <Label>Purchased Invoice Number</Label>
                  <Input value={formData.purchased_invoice_number || ""} onChange={(e) => handleChange("purchased_invoice_number", e.target.value)} />
                </div>
                <div>
                  <Label>Eway Bill No.</Label>
                  <Input value={formData.eway_bill_no || ""} onChange={(e) => handleChange("eway_bill_no", e.target.value)} />
                </div>
              </>
            )}
            <div>
              <Label>Total Price (Auto)</Label>
              <Input type="number" step="0.01" value={formData.total_price ?? ""} disabled className="bg-gray-100" />
            </div>
            <div>
              <Label>Selling Price</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.selling_price ?? ""}
                onChange={(e) => handleChange("selling_price", e.target.value === "" ? null : parseFloat(e.target.value))}
              />
            </div>
            <div className="md:col-span-2">
              <Label>Public Photo URL</Label>
              <Input
                value={formData.public_photo_url || ""}
                onChange={(e) => handleChange("public_photo_url", e.target.value)}
                placeholder="https://yourwebsite.com/images/product.jpg"
              />
              <p className="text-xs text-gray-500 mt-1">Permanent link to product photo (for WhatsApp/email sharing)</p>
            </div>
          </div>

          {/* Expense Section */}
          <div className="border rounded-lg p-4 space-y-4">
            <div className="flex items-center space-x-2">
              <input type="checkbox" id="expense" checked={formData.expense || false} onChange={(e) => handleChange("expense", e.target.checked)} />
              <Label htmlFor="expense">Any extra expense incurred?</Label>
            </div>
            {formData.expense && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Expense Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.expense_amount ?? ""}
                    onChange={(e) => handleChange("expense_amount", e.target.value === "" ? null : parseFloat(e.target.value))}
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>Expense Description</Label>
                  <Input value={formData.expense_description || ""} onChange={(e) => handleChange("expense_description", e.target.value)} />
                </div>
              </div>
            )}
          </div>

          {/* Status, Purchased By, Remarks */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Status</Label>
              <Select value={formData.status_purchase || ""} onValueChange={(val) => handleChange("status_purchase", val)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Ready for Sale">Ready for Sale</SelectItem>
                  <SelectItem value="QC Pending">QC Pending</SelectItem>
                  <SelectItem value="Faulty">Faulty</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formData.status_purchase === "Other" && (
              <div>
                <Label>Other Status</Label>
                <Input value={formData.status_other || ""} onChange={(e) => handleChange("status_other", e.target.value)} />
              </div>
            )}
            <div>
              <Label>Purchased By</Label>
              <Select value={formData.purchased_by_type || ""} onValueChange={(val) => handleChange("purchased_by_type", val)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Digitalbluez">Digitalbluez</SelectItem>
                  <SelectItem value="Techtenth">Techtenth</SelectItem>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formData.purchased_by_type === "Other" && (
              <div>
                <Label>Other Purchased By</Label>
                <Input value={formData.purchased_by_other || ""} onChange={(e) => handleChange("purchased_by_other", e.target.value)} />
              </div>
            )}
          </div>

          <div>
            <Label>Remarks</Label>
            <textarea className="w-full border rounded-md p-2" rows={2} value={formData.remarks || ""} onChange={(e) => handleChange("remarks", e.target.value)} />
          </div>
<div className="mt-6 pt-4 border-t border-gray-200">
  <h4 className="text-sm font-medium mb-3">Attached Files (Invoices, E-Way Bills, Receipts)</h4>
  <FileUpload purchaseId={purchase.id} assetNumber={purchase.asset_number} />
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
"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

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

// ---------- Helper: suggest next asset number (without consuming) ----------
async function suggestAssetNumber(prefix: string = "DBAS"): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("purchases")
    .select("asset_number")
    .ilike("asset_number", `${prefix}%`)
    .order("asset_number", { ascending: false })
    .limit(1);
  if (error) throw error;
  let maxNum = 0;
  if (data && data.length > 0) {
    const match = data[0].asset_number.match(/\d+$/);
    if (match) maxNum = parseInt(match[0], 10);
  }
  const nextNum = maxNum + 1;
  return `${prefix}${nextNum.toString().padStart(4, "0")}`;
}

// ---------- Inline Add Vendor Component ----------
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

// ---------- Main AddPurchaseDialog (controllable) ----------
interface AddPurchaseDialogProps {
  onAdd: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: any;
}

export default function AddPurchaseDialog({ onAdd, open, onOpenChange, initialData }: AddPurchaseDialogProps) {
  const [loading, setLoading] = useState(false);
  const [skuGenerated, setSkuGenerated] = useState(false);
  const [vendors, setVendors] = useState<{ id: string; company_name: string }[]>([]);
  const [loadingVendors, setLoadingVendors] = useState(false);
  const [suggestedAssetNumber, setSuggestedAssetNumber] = useState("");
  const today = new Date().toISOString().split("T")[0];
  const supabase = createClient();

  const [quantity, setQuantity] = useState(1);
  const [serialNumbersList, setSerialNumbersList] = useState("");

  const [formData, setFormData] = useState({
    entry_date: today,
    purchase_date: "",
    vendor_id: "",
    vendor_name: "",
    asset_number: "",
    type: "Laptop",
    brand: "",
    model: "",
    cpu: "",
    ram: "",
    ssd: "",
    charger: false,
    screen_size: "",
    monitor_size: "",
    has_keyboard: false,
    has_mouse: false,
    sku: "",
    asset_description: "",
    serial_number: "",
    base_price: null as number | null,
    gst: null as number | null,
    total_price: null as number | null,
    selling_price: null as number | null,
    expense: false,
    expense_amount: null as number | null,
    expense_description: "",
    stock_status: "In Stock",
    status_purchase: "QC Pending",
    status_other: "",
    purchased_by_type: "Digitalbluez",
    purchased_by_other: "",
    remarks: "",
    purchase_type: "GST",
    purchased_invoice_number: "",
    eway_bill_no: "",
    public_photo_url: "",   // ✅ new field
  });

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

  // Reset and pre‑fill when dialog opens
  useEffect(() => {
    if (open) {
      fetchVendors();
      if (initialData) {
        // Duplicate mode: pre‑fill all fields except asset_number and serial_number
        setFormData({
          entry_date: initialData.entry_date || today,
          purchase_date: initialData.purchase_date || "",
          vendor_id: initialData.vendor_id || "",
          vendor_name: initialData.vendor_name || "",
          asset_number: "",
          type: initialData.type || "Laptop",
          brand: initialData.brand || "",
          model: initialData.model || "",
          cpu: initialData.cpu || "",
          ram: initialData.ram || "",
          ssd: initialData.ssd || "",
          charger: initialData.charger || false,
          screen_size: initialData.screen_size || "",
          monitor_size: initialData.monitor_size || "",
          has_keyboard: initialData.has_keyboard || false,
          has_mouse: initialData.has_mouse || false,
          sku: initialData.sku || "",
          asset_description: initialData.asset_description || "",
          serial_number: "",
          base_price: initialData.base_price || null,
          gst: initialData.gst || null,
          total_price: initialData.total_price || null,
          selling_price: initialData.selling_price || null,
          expense: initialData.expense || false,
          expense_amount: initialData.expense_amount || null,
          expense_description: initialData.expense_description || "",
          stock_status: initialData.stock_status || "In Stock",
          status_purchase: initialData.status_purchase || "QC Pending",
          status_other: initialData.status_other || "",
          purchased_by_type: initialData.purchased_by_type || "Digitalbluez",
          purchased_by_other: initialData.purchased_by_other || "",
          remarks: initialData.remarks || "",
          purchase_type: initialData.purchase_type || "GST",
          purchased_invoice_number: initialData.purchased_invoice_number || "",
          eway_bill_no: initialData.eway_bill_no || "",
          public_photo_url: initialData.public_photo_url || "",   // ✅ copy public photo URL
        });
        setQuantity(1);
        setSerialNumbersList("");
        setSkuGenerated(false);
        // Get asset number suggestion
        suggestAssetNumber().then(num => setSuggestedAssetNumber(num));
      } else {
        // Normal add: reset everything
        setFormData({
          entry_date: today,
          purchase_date: "",
          vendor_id: "",
          vendor_name: "",
          asset_number: "",
          type: "Laptop",
          brand: "",
          model: "",
          cpu: "",
          ram: "",
          ssd: "",
          charger: false,
          screen_size: "",
          monitor_size: "",
          has_keyboard: false,
          has_mouse: false,
          sku: "",
          asset_description: "",
          serial_number: "",
          base_price: null,
          gst: null,
          total_price: null,
          selling_price: null,
          expense: false,
          expense_amount: null,
          expense_description: "",
          stock_status: "In Stock",
          status_purchase: "QC Pending",
          status_other: "",
          purchased_by_type: "Digitalbluez",
          purchased_by_other: "",
          remarks: "",
          purchase_type: "GST",
          purchased_invoice_number: "",
          eway_bill_no: "",
          public_photo_url: "",   // ✅ empty
        });
        setQuantity(1);
        setSerialNumbersList("");
        setSkuGenerated(false);
        suggestAssetNumber().then(num => setSuggestedAssetNumber(num));
      }
    }
  }, [open, initialData, today]);

  // When suggestion arrives, pre‑fill asset_number field (if still empty)
  useEffect(() => {
    if (suggestedAssetNumber && !formData.asset_number && !initialData) {
      setFormData(prev => ({ ...prev, asset_number: suggestedAssetNumber }));
    } else if (suggestedAssetNumber && initialData && !formData.asset_number) {
      setFormData(prev => ({ ...prev, asset_number: suggestedAssetNumber }));
    }
  }, [suggestedAssetNumber, formData.asset_number, initialData]);

  // Auto-generate SKU
  useEffect(() => {
    if (formData.brand && formData.model && !skuGenerated) {
      const brandPrefix = formData.brand.substring(0, 3).toUpperCase();
      const modelCode = formData.model.replace(/\s/g, "").substring(0, 5).toUpperCase();
      setFormData((prev) => ({ ...prev, sku: `${brandPrefix}-${modelCode}` }));
      setSkuGenerated(true);
    }
  }, [formData.brand, formData.model, skuGenerated]);

  // Auto-calculate total price
  useEffect(() => {
    if (formData.base_price !== null) {
      if (formData.purchase_type === "GST" && formData.gst !== null && formData.gst > 0) {
        const total = formData.base_price + (formData.base_price * formData.gst) / 100;
        setFormData((prev) => ({ ...prev, total_price: total }));
      } else {
        setFormData((prev) => ({ ...prev, total_price: formData.base_price }));
      }
    }
  }, [formData.base_price, formData.gst, formData.purchase_type]);

  const handleChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (field === "brand" || field === "model") setSkuGenerated(false);
    if (field === "vendor_id") {
      const selected = vendors.find((v) => v.id === value);
      if (selected) setFormData((prev) => ({ ...prev, vendor_name: selected.company_name }));
    }
    if (field === "purchase_type" && value !== "GST") {
      setFormData((prev) => ({ ...prev, gst: null }));
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

    // Determine final asset number
    let finalAssetNumber = formData.asset_number?.trim();
    if (!finalAssetNumber) {
      finalAssetNumber = await suggestAssetNumber();
    } else {
      // Check if user's number already exists
      const { data: existing } = await supabase
        .from("purchases")
        .select("id")
        .eq("asset_number", finalAssetNumber)
        .maybeSingle();
      if (existing) {
        alert(`Asset number "${finalAssetNumber}" already exists. Please choose a different one.`);
        setLoading(false);
        return;
      }
    }

    const baseRecord = {
      entry_date: formData.entry_date,
      purchase_date: formData.purchase_date,
      vendor_id: formData.vendor_id,
      vendor_name: formData.vendor_name,
      type: formData.type,
      brand: formData.brand,
      model: formData.model,
      cpu: formData.cpu,
      ram: formData.ram,
      ssd: formData.ssd,
      charger: formData.charger,
      screen_size: formData.screen_size,
      monitor_size: formData.monitor_size,
      has_keyboard: formData.has_keyboard,
      has_mouse: formData.has_mouse,
      sku: formData.sku,
      asset_description: formData.asset_description,
      base_price: formData.base_price,
      gst: formData.gst,
      total_price: formData.total_price,
      selling_price: formData.selling_price,
      expense: formData.expense,
      expense_amount: formData.expense_amount,
      expense_description: formData.expense_description,
      stock_status: formData.stock_status,
      status_purchase: formData.status_purchase,
      status_other: formData.status_other,
      purchased_by_type: formData.purchased_by_type,
      purchased_by_other: formData.purchased_by_other,
      remarks: formData.remarks,
      purchase_type: formData.purchase_type === "GST" ? "GST" : "Cash",
      purchased_invoice_number: formData.purchased_invoice_number,
      eway_bill_no: formData.eway_bill_no,
      public_photo_url: formData.public_photo_url,   // ✅ include new field
    };

    let serials: string[] = [];
    if (quantity > 1) {
      const enteredSerials = serialNumbersList.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
      serials = Array(quantity).fill("");
      for (let i = 0; i < Math.min(enteredSerials.length, quantity); i++) {
        serials[i] = enteredSerials[i];
      }
    } else {
      serials = [formData.serial_number || ""];
    }

    // Generate asset numbers sequentially for each record
    const recordsToInsert = [];
    let currentAssetNumber = finalAssetNumber;
    for (let i = 0; i < serials.length; i++) {
      if (i > 0) {
        const match = currentAssetNumber.match(/(\D+)(\d+)$/);
        if (match) {
          const prefix = match[1];
          const num = parseInt(match[2], 10);
          const nextNum = num + 1;
          currentAssetNumber = `${prefix}${nextNum.toString().padStart(4, "0")}`;
        } else {
          currentAssetNumber = await suggestAssetNumber();
        }
      }
      recordsToInsert.push({
        ...baseRecord,
        asset_number: currentAssetNumber,
        serial_number: serials[i],
      });
    }

    // Final duplicate check across all generated numbers
    const assetNumbersToCheck = recordsToInsert.map(r => r.asset_number);
    const { data: duplicates } = await supabase
      .from("purchases")
      .select("asset_number")
      .in("asset_number", assetNumbersToCheck);
    if (duplicates && duplicates.length > 0) {
      alert(`Asset numbers already exist: ${duplicates.map(d => d.asset_number).join(", ")}. Please try again.`);
      setLoading(false);
      return;
    }

    const { error } = await supabase.from("purchases").insert(recordsToInsert);
    setLoading(false);
    if (error) {
      console.error("Insert error:", error);
      alert(`Failed to add purchases: ${error.message}`);
    } else {
      onOpenChange(false);
      onAdd();
    }
  };

  const isGST = formData.purchase_type === "GST";
  const showSerialTextarea = quantity > 1;
  const isDesktop = formData.type === "Desktop";
  const isLaptopOrMonitor = formData.type === "Laptop" || formData.type === "Monitor";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialData ? "Duplicate Purchase" : "Add New Purchase"}</DialogTitle>
          <DialogDescription className="sr-only">
            {initialData ? "Create a new purchase based on existing data" : "Fill in purchase details"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Entry Date & Purchase Date */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Entry Date</Label>
              <Input type="date" value={formData.entry_date} disabled className="bg-gray-100" />
            </div>
            <div>
              <Label>Purchase Date *</Label>
              <Input type="date" required value={formData.purchase_date} onChange={(e) => handleChange("purchase_date", e.target.value)} />
            </div>
          </div>

          {/* Vendor & Quantity */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="min-w-0">
              <Label>Vendor</Label>
              <Select value={formData.vendor_id} onValueChange={(val) => handleChange("vendor_id", val)}>
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
              <Label>Quantity</Label>
              <Input type="number" min="1" value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value) || 1)} />
            </div>
          </div>

          {/* Asset Number & Serial Number (single entry) */}
          {!showSerialTextarea && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Asset Number *</Label>
                <Input required placeholder="e.g., DBAS0001" value={formData.asset_number} onChange={(e) => handleChange("asset_number", e.target.value)} />
              </div>
              <div>
                <Label>Serial Number</Label>
                <Input value={formData.serial_number} onChange={(e) => handleChange("serial_number", e.target.value)} />
              </div>
            </div>
          )}

          {/* Serial numbers textarea for multi‑entry */}
          {showSerialTextarea && (
            <div>
              <Label>Serial Numbers (optional, one per line)</Label>
              <Textarea
                rows={Math.min(quantity, 10)}
                placeholder="Enter one serial number per line (optional)&#10;e.g.,&#10;SN001&#10;SN002&#10;SN003"
                value={serialNumbersList}
                onChange={(e) => setSerialNumbersList(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">
                You entered {serialNumbersList.split(/\r?\n/).filter((s) => s.trim()).length} of {quantity} serial numbers. Remaining will be empty.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Asset numbers will be generated sequentially starting from the number you enter above.
              </p>
            </div>
          )}

          {/* Type, Brand, Model, SKU */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label>Type</Label>
              <Select value={formData.type} onValueChange={(val) => handleChange("type", val)}>
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
              <Input placeholder="e.g., Dell, HP" value={formData.brand} onChange={(e) => handleChange("brand", e.target.value)} />
            </div>
            <div>
              <Label>Model</Label>
              <Input placeholder="e.g., Latitude 7440" value={formData.model} onChange={(e) => handleChange("model", e.target.value)} />
            </div>
            <div>
              <Label>SKU (Auto)</Label>
              <Input value={formData.sku} disabled className="bg-gray-100" />
            </div>
          </div>

          {/* Hardware Specifications */}
          {(formData.type === "Laptop" || formData.type === "Desktop" || formData.type === "Tiny") && (
            <div className="border rounded-lg p-4 space-y-4">
              <h3 className="font-semibold">Hardware Specifications</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <Label>CPU</Label>
                  <Input placeholder="e.g., Intel i5 8th Gen" value={formData.cpu} onChange={(e) => handleChange("cpu", e.target.value)} />
                </div>
                <div>
                  <Label>RAM</Label>
                  <Input placeholder="e.g., 8GB DDR4" value={formData.ram} onChange={(e) => handleChange("ram", e.target.value)} />
                </div>
                <div>
                  <Label>SSD / HDD</Label>
                  <Input placeholder="e.g., 256GB SSD" value={formData.ssd} onChange={(e) => handleChange("ssd", e.target.value)} />
                </div>
                <div className="flex items-center space-x-2">
                  <input type="checkbox" id="charger" checked={formData.charger} onChange={(e) => handleChange("charger", e.target.checked)} />
                  <Label htmlFor="charger">Charger Included?</Label>
                </div>
              </div>
            </div>
          )}

          {/* Screen Size for Laptop / Monitor */}
          {isLaptopOrMonitor && (
            <div>
              <Label>Screen Size (inches)</Label>
              <Input placeholder="e.g., 15.6, 14.0, 27" value={formData.screen_size} onChange={(e) => handleChange("screen_size", e.target.value)} />
            </div>
          )}

          {/* Desktop-specific fields */}
          {isDesktop && (
            <div className="border rounded-lg p-4 space-y-4">
              <h3 className="font-semibold">Desktop Accessories</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>Monitor Size (inches)</Label>
                  <Input placeholder="e.g., 24, 27" value={formData.monitor_size} onChange={(e) => handleChange("monitor_size", e.target.value)} />
                </div>
                <div className="flex items-center space-x-2">
                  <input type="checkbox" id="has_keyboard" checked={formData.has_keyboard} onChange={(e) => handleChange("has_keyboard", e.target.checked)} />
                  <Label htmlFor="has_keyboard">Keyboard Included?</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <input type="checkbox" id="has_mouse" checked={formData.has_mouse} onChange={(e) => handleChange("has_mouse", e.target.checked)} />
                  <Label htmlFor="has_mouse">Mouse Included?</Label>
                </div>
              </div>
            </div>
          )}

          {/* Asset Description, Pricing, Public Photo URL */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label>Asset Description</Label>
              <Input value={formData.asset_description} onChange={(e) => handleChange("asset_description", e.target.value)} />
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
              <Select value={formData.purchase_type} onValueChange={(val) => handleChange("purchase_type", val)}>
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
                  <Input value={formData.purchased_invoice_number} onChange={(e) => handleChange("purchased_invoice_number", e.target.value)} />
                </div>
                <div>
                  <Label>Eway Bill No.</Label>
                  <Input value={formData.eway_bill_no} onChange={(e) => handleChange("eway_bill_no", e.target.value)} />
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
              <Label>Public Photo URL (optional)</Label>
              <Input
                value={formData.public_photo_url}
                onChange={(e) => handleChange("public_photo_url", e.target.value)}
                placeholder="https://yourwebsite.com/images/product.jpg"
              />
              <p className="text-xs text-gray-500 mt-1">
                Permanent link to product photo (for WhatsApp/email sharing)
              </p>
            </div>
          </div>

          {/* Expense Section */}
          <div className="border rounded-lg p-4 space-y-4">
            <div className="flex items-center space-x-2">
              <input type="checkbox" id="expense" checked={formData.expense} onChange={(e) => handleChange("expense", e.target.checked)} />
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
                  <Input value={formData.expense_description} onChange={(e) => handleChange("expense_description", e.target.value)} />
                </div>
              </div>
            )}
          </div>

          {/* Status, Purchased By, Remarks */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Status</Label>
              <Select value={formData.status_purchase} onValueChange={(val) => handleChange("status_purchase", val)}>
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
                <Input value={formData.status_other} onChange={(e) => handleChange("status_other", e.target.value)} placeholder="Specify" />
              </div>
            )}
            <div>
              <Label>Purchased By</Label>
              <Select value={formData.purchased_by_type} onValueChange={(val) => handleChange("purchased_by_type", val)}>
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
                <Input value={formData.purchased_by_other} onChange={(e) => handleChange("purchased_by_other", e.target.value)} placeholder="Specify" />
              </div>
            )}
          </div>

          <div>
            <Label>Remarks</Label>
            <textarea className="w-full border rounded-md p-2" rows={2} value={formData.remarks} onChange={(e) => handleChange("remarks", e.target.value)} placeholder="Any additional notes..." />
          </div>

          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Adding..." : initialData ? "Duplicate Purchase" : "Add Purchase"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
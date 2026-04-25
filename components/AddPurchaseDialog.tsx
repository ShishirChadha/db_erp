"use client";

import { useState, useEffect, useRef } from "react";
import { ModelSelect } from "@/components/ModelSelect";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, Plus } from "lucide-react";
import { format } from "date-fns";

// ---------- Helper: generate next asset number (without leading zeros) ----------
async function getNextAssetNumber(prefix: string): Promise<string> {
  const supabase = createClient();
  
  // Special handling for TechTenth (with year and hyphen)
if (prefix === "TTAS") {
  const currentYear = new Date().getFullYear() % 100; // 26 for 2026
  // Fetch all TTAS numbers (any year) to find the maximum numeric suffix
  const { data, error } = await supabase
    .from("purchases")
    .select("asset_number")
    .ilike("asset_number", "TTAS%")
    .limit(1000); // adjust limit if needed
  if (error) throw error;
  let maxSeq = 0;
  if (data && data.length > 0) {
    for (const item of data) {
      const match = item.asset_number.match(/-(\d+)$/);
      if (match) {
        const seq = parseInt(match[1], 10);
        if (seq > maxSeq) maxSeq = seq;
      }
    }
  }
  const nextSeq = maxSeq + 1;
  return `TTAS${currentYear}-${nextSeq}`;
}
  
  // For other prefixes (DBAS, CSAS, OTHR) – simple increment without year
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
  return `${prefix}${nextNum}`;
}

const getAssetPrefix = (purchasedBy: string, purchasedByOther?: string): string => {
  switch (purchasedBy) {
    case "Digitalbluez": return "DBAS";
    case "Techtenth": return "TTAS";
    case "Cash": return "CSAS";
    case "Other": return purchasedByOther ? purchasedByOther.toUpperCase().substring(0, 4) : "OTHR";
    default: return "DBAS";
  }
};

// ---------- Inline Add Vendor Component (full) ----------
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
    model_id: null as string | null,
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
  model_id: null,   // ✅ add this line
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

// ---------- Main AddPurchaseDialog ----------
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
  const today = new Date().toISOString().split("T")[0];
  const supabase = createClient();

  const updateVendorInvoiceTotal = async (vendorId: string, invoiceNumber: string) => {
    console.log("updateVendorInvoiceTotal called with:", { vendorId, invoiceNumber });
    if (!invoiceNumber || !vendorId) {
      console.log("Missing vendorId or invoiceNumber – skipping update");
      return;
    }
    const { data, error } = await supabase
      .from("purchases")
      .select("total_price")
      .eq("vendor_id", vendorId)
      .eq("purchased_invoice_number", invoiceNumber)
      .eq("is_deleted", false);
    if (error) {
      console.error("Error fetching sum:", error);
      return;
    }
    const totalSum = data.reduce((sum, row) => sum + (row.total_price || 0), 0);
    console.log("Total sum for vendor/invoice:", totalSum);
    const { error: updateError } = await supabase
      .from("purchases")
      .update({ vendor_invoice_total: totalSum })
      .eq("vendor_id", vendorId)
      .eq("purchased_invoice_number", invoiceNumber)
      .eq("is_deleted", false);
    if (updateError) {
      console.error("Error updating vendor_invoice_total:", updateError);
    } else {
      console.log("Successfully updated vendor_invoice_total for all matching records");
    }
  };

  const [quantity, setQuantity] = useState(1);
  const [serialNumbersList, setSerialNumbersList] = useState("");
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const BRAND_OPTIONS = ["Apple", "Dell", "HP", "Lenovo", "Windows", "Asus", "Acer", "Other"];

  const [formData, setFormData] = useState({
    entry_date: today,
    purchase_date: "",
    vendor_id: "",
    vendor_name: "",
    type: "Laptop",
    brand: "",
    brand_other: "",
    model: "",
    model_id: null as string | null, 
    make_year: null as number | null,
    sku: "",
    asset_description: "",
    serial_number: "",
    cpu: "",
    generation: null as number | null,
    ram: null as number | null,
    ssd: null as number | null,
    screen_size: null as number | null,
    charger: false,
    monitor_size: null as number | null,
    has_keyboard: false,
    has_mouse: false,
    base_price: null as number | null,
    gst: null as number | null,
    gst_amount: null as number | null,
    total_price: null as number | null,
    selling_price: null as number | null,
    vendor_invoice_total: null as number | null,
    purchase_type: "GST",
    purchased_invoice_number: "",
    eway_bill_no: "",
    expense: false,
    expense_amount: null as number | null,
    expense_description: "",
    stock_status: "In Stock",
    status_purchase: "QC Pending",
    status_other: "",
    purchased_by_type: "Digitalbluez",
    purchased_by_other: "",
    remarks: "",
    public_photo_url: "",
    asset_number: "",

  });

  const isInitialized = useRef(false);
  const isUpdating = useRef(false);

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

  const loadInitialData = async () => {
    const originalPurchasedBy = initialData?.purchased_by_type || formData.purchased_by_type;
    const originalPurchasedByOther = initialData?.purchased_by_other || formData.purchased_by_other;
    const prefix = getAssetPrefix(originalPurchasedBy, originalPurchasedByOther);
    const nextAsset = await getNextAssetNumber(prefix);
    setFormData(prev => ({ ...prev, asset_number: nextAsset }));

    if (initialData) {
      setFormData(prev => ({
        ...prev,
        ...initialData,
        serial_number: "",
        asset_number: nextAsset,
        purchased_by_type: initialData.purchased_by_type || "Digitalbluez",
        purchased_by_other: initialData.purchased_by_other || "",
        model_id: initialData.model_id || null,
      }));
      setQuantity(1);
      setSerialNumbersList("");
      setSkuGenerated(false);
    } else {
      setFormData({
        entry_date: today,
        model_id: null,
        purchase_date: "",
        vendor_id: "",
        vendor_name: "",
        type: "Laptop",
        brand: "",
        brand_other: "",
        model: "",
        make_year: null,
        sku: "",
        asset_description: "",
        serial_number: "",
        cpu: "",
        generation: null,
        ram: null,
        ssd: null,
        screen_size: null,
        charger: false,
        monitor_size: null,
        has_keyboard: false,
        has_mouse: false,
        base_price: null,
        gst: null,
        gst_amount: null,
        total_price: null,
        selling_price: null,
        vendor_invoice_total: null,
        purchase_type: "GST",
        purchased_invoice_number: "",
        eway_bill_no: "",
        expense: false,
        expense_amount: null,
        expense_description: "",
        stock_status: "In Stock",
        status_purchase: "QC Pending",
        status_other: "",
        purchased_by_type: "Digitalbluez",
        purchased_by_other: "",
        remarks: "",
        public_photo_url: "",
        asset_number: nextAsset,
       
      });
      setQuantity(1);
      setSerialNumbersList("");
      setSkuGenerated(false);
    }
    isInitialized.current = true;
  };

  useEffect(() => {
    if (open) {
      fetchVendors();
      loadInitialData();
    }
  }, [open, initialData, today]);

  // Auto‑generate SKU
  useEffect(() => {
    if (formData.brand && formData.model && !skuGenerated) {
      const brandPart = formData.brand.substring(0, 3).toUpperCase();
      const modelPart = formData.model.replace(/\s/g, "").substring(0, 5).toUpperCase();
      setFormData((prev) => ({ ...prev, sku: `${brandPart}-${modelPart}` }));
      setSkuGenerated(true);
    }
  }, [formData.brand, formData.model, skuGenerated]);

  // Bi‑directional price calculation
  useEffect(() => {
    if (isUpdating.current) return;
    const base = formData.base_price;
    const gstRate = formData.gst;
    if (formData.purchase_type === "GST" && base !== null && base !== undefined) {
      const gstAmount = Math.round((base * (gstRate || 0)) / 100);
      const newTotal = base + gstAmount;
      if (formData.total_price !== newTotal || formData.gst_amount !== gstAmount) {
        isUpdating.current = true;
        setFormData(prev => ({ ...prev, gst_amount: gstAmount, total_price: newTotal }));
        setTimeout(() => { isUpdating.current = false; }, 0);
      }
    }
  }, [formData.base_price, formData.gst, formData.purchase_type]);

  useEffect(() => {
    if (isUpdating.current) return;
    const total = formData.total_price;
    const gstRate = formData.gst;
    if (formData.purchase_type === "GST" && total !== null && total !== undefined && gstRate !== null && gstRate !== undefined && gstRate !== 0) {
      const basePrice = Math.round(total / (1 + gstRate / 100));
      const gstAmount = total - basePrice;
      if (formData.base_price !== basePrice || formData.gst_amount !== gstAmount) {
        isUpdating.current = true;
        setFormData(prev => ({ ...prev, base_price: basePrice, gst_amount: gstAmount }));
        setTimeout(() => { isUpdating.current = false; }, 0);
      }
    }
  }, [formData.total_price, formData.gst, formData.purchase_type]);

  const handleChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (field === "vendor_id") {
      const selected = vendors.find((v) => v.id === value);
      if (selected) setFormData((prev) => ({ ...prev, vendor_name: selected.company_name }));
    }
    if (field === "purchase_type" && value !== "GST") {
      setFormData((prev) => ({ ...prev, gst: null, gst_amount: null }));
    }
    if (field === "brand" && value !== "Other") setFormData((prev) => ({ ...prev, brand_other: "" }));
    if (field === "brand" || field === "model") setSkuGenerated(false);
    if ((field === "purchased_by_type" || field === "purchased_by_other") && isInitialized.current) {
      const prefix = getAssetPrefix(
        field === "purchased_by_type" ? value : formData.purchased_by_type,
        field === "purchased_by_other" ? value : formData.purchased_by_other
      );
      getNextAssetNumber(prefix).then(num => {
        setFormData(prev => ({ ...prev, asset_number: num }));
      });
    }
  };

  const handleVendorAdded = (vendorId: string, vendorName: string) => {
    setVendors((prev) => [...prev, { id: vendorId, company_name: vendorName }]);
    setFormData((prev) => ({ ...prev, vendor_id: vendorId, vendor_name: vendorName }));
    fetchVendors();
  };

  const insertPurchase = async (status: 'draft' | 'submitted') => {
    setLoading(true);
    try {
      if (!formData.purchase_date) throw new Error("Purchase date is required.");
      if (!formData.vendor_id) throw new Error("Please select a vendor.");
      if (!formData.type) throw new Error("Type is required.");

      let finalAssetNumber = null;
      if (status === 'submitted') {
        finalAssetNumber = formData.asset_number?.trim();
        if (!finalAssetNumber) {
          const prefix = getAssetPrefix(formData.purchased_by_type, formData.purchased_by_other);
          finalAssetNumber = await getNextAssetNumber(prefix);
        } else {
          const { data: existing } = await supabase
            .from("purchases")
            .select("id")
            .eq("asset_number", finalAssetNumber)
            .maybeSingle();
          if (existing) throw new Error(`Asset number "${finalAssetNumber}" already exists. Please change it.`);
        }
      }

      const baseRecord = {
        entry_date: formData.entry_date,
        purchase_date: formData.purchase_date,
        vendor_id: formData.vendor_id,
        vendor_name: formData.vendor_name,
        type: formData.type,
        brand: formData.brand === "Other" ? (formData.brand_other || "Other") : formData.brand,
        brand_other: formData.brand === "Other" ? formData.brand_other : null,
        model: formData.model,
        model_id: formData.model_id,
        make_year: formData.make_year,
        sku: formData.sku,
        asset_description: formData.asset_description,
        cpu: formData.cpu,
        generation: formData.generation,
        ram: formData.ram,
        ssd: formData.ssd,
        screen_size: formData.screen_size,
        charger: formData.charger,
        monitor_size: formData.monitor_size,
        has_keyboard: formData.has_keyboard,
        has_mouse: formData.has_mouse,
        base_price: formData.base_price,
        gst: formData.gst,
        gst_amount: formData.gst_amount,
        total_price: formData.total_price ?? formData.base_price ?? 0,
        selling_price: formData.selling_price,
        vendor_invoice_total: formData.vendor_invoice_total,
        purchase_type: formData.purchase_type === "GST" ? "GST" : "Cash",
        purchased_invoice_number: formData.purchased_invoice_number,
        eway_bill_no: formData.eway_bill_no,
        expense: formData.expense,
        expense_amount: formData.expense_amount,
        expense_description: formData.expense_description,
        stock_status: formData.stock_status,
        status_purchase: formData.status_purchase,
        status_other: formData.status_purchase === "Other" ? formData.status_other : null,
        purchased_by_type: formData.purchased_by_type,
        purchased_by_other: formData.purchased_by_type === "Other" ? formData.purchased_by_other : null,
        remarks: formData.remarks,
        public_photo_url: formData.public_photo_url,
        status: status,
        submitted_at: status === 'submitted' ? new Date().toISOString() : null,
        is_deleted: false,
        asset_number: finalAssetNumber,
      };

      let serials: string[] = [];
      if (quantity > 1) {
        const entered = serialNumbersList.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
        serials = Array(quantity).fill("");
        for (let i = 0; i < Math.min(entered.length, quantity); i++) {
          serials[i] = entered[i];
        }
      } else {
        serials = [formData.serial_number || ""];
      }

      const records = [];
      let currentAsset = finalAssetNumber;
      for (let i = 0; i < serials.length; i++) {
        if (i > 0 && currentAsset && status === 'submitted') {
          const hyphenMatch = currentAsset.match(/^(.+?)-(\d+)$/);
          if (hyphenMatch) {
            const prefix = hyphenMatch[1];
            const num = parseInt(hyphenMatch[2], 10);
            const nextNum = num + 1;
            currentAsset = `${prefix}-${nextNum}`;
          } else {
            const suffixMatch = currentAsset.match(/(\D+)(\d+)$/);
            if (suffixMatch) {
              const prefix = suffixMatch[1];
              const num = parseInt(suffixMatch[2], 10);
              const nextNum = num + 1;
              currentAsset = `${prefix}${nextNum}`;
            } else {
              const prefix = getAssetPrefix(formData.purchased_by_type, formData.purchased_by_other);
              currentAsset = await getNextAssetNumber(prefix);
            }
          }
        }
        records.push({ ...baseRecord, asset_number: currentAsset, serial_number: serials[i] });
      }

      if (status === 'submitted') {
        const assetNumbers = records.map(r => r.asset_number).filter(Boolean);
        if (assetNumbers.length) {
          const { data: dup } = await supabase.from("purchases").select("asset_number").in("asset_number", assetNumbers);
          if (dup && dup.length > 0) throw new Error(`Asset numbers already exist: ${dup.map(d => d.asset_number).join(", ")}`);
        }
      }

      const { error } = await supabase.from("purchases").insert(records);
      if (error) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
      if (formData.purchased_invoice_number) {
        await updateVendorInvoiceTotal(formData.vendor_id, formData.purchased_invoice_number);
      }
      onOpenChange(false);
      onAdd();
    } catch (err: any) {
      console.error("Insert error:", err);
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const isGST = formData.purchase_type === "GST";
  const showSerialTextarea = quantity > 1;
  const isDesktop = formData.type === "Desktop";
  const isLaptopOrMonitor = formData.type === "Laptop" || formData.type === "Monitor";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[90vw] md:max-w-4xl lg:max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialData ? "Duplicate Purchase" : "Add New Purchase"}</DialogTitle>
          <DialogDescription className="sr-only">
            {initialData ? "Create a new purchase based on existing data" : "Fill in purchase details"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          {/* Entry Date & Purchase Date */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Entry Date</Label>
              <Input type="date" value={formData.entry_date} disabled className="bg-gray-100" />
            </div>
            <div>
              <Label>Purchase Date *</Label>
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen} modal>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start" type="button">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.purchase_date ? format(new Date(formData.purchase_date), "dd/MM/yyyy") : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={formData.purchase_date ? new Date(formData.purchase_date) : undefined}
                    onSelect={(date) => {
                      if (date) {
                        handleChange("purchase_date", format(date, "yyyy-MM-dd"));
                        setDatePickerOpen(false);
                      }
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Vendor & Quantity */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="min-w-0">
              <Label>Vendor *</Label>
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

          {/* Purchased By */}
          <div>
            <Label>Purchased By</Label>
            <Select value={formData.purchased_by_type} onValueChange={(val) => handleChange("purchased_by_type", val)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Digitalbluez">Digitalbluez</SelectItem>
                <SelectItem value="Techtenth">Techtenth</SelectItem>
                <SelectItem value="Cash">Cash</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
            {formData.purchased_by_type === "Other" && (
              <div className="mt-2">
                <Label>Other Purchased By</Label>
                <Input value={formData.purchased_by_other} onChange={(e) => handleChange("purchased_by_other", e.target.value)} placeholder="Specify" />
              </div>
            )}
          </div>

          {/* Asset Number */}
          <div>
            <Label>Asset Number {quantity > 1 && "(starting number)"}</Label>
            <Input
              value={formData.asset_number}
              onChange={(e) => handleChange("asset_number", e.target.value)}
              placeholder="e.g., DBAS582"
            />
            {quantity > 1 && (
              <p className="text-xs text-muted-foreground mt-1">Subsequent numbers will be auto‑incremented.</p>
            )}
          </div>

          {/* Serial Numbers */}
          {!showSerialTextarea ? (
            <div>
              <Label>Serial Number</Label>
              <Input value={formData.serial_number} onChange={(e) => handleChange("serial_number", e.target.value)} />
            </div>
          ) : (
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
            </div>
          )}

          {/* Type, Brand, Model, Make Year */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div><Label>Type *</Label><Select value={formData.type} onValueChange={(val) => handleChange("type", val)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Laptop">Laptop</SelectItem><SelectItem value="Desktop">Desktop</SelectItem><SelectItem value="Monitor">Monitor</SelectItem><SelectItem value="Tablet">Tablet</SelectItem><SelectItem value="Tiny">Tiny</SelectItem></SelectContent></Select></div>
            <div><Label>Brand</Label><Select value={formData.brand || ""} onValueChange={(val) => handleChange("brand", val)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{BRAND_OPTIONS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select></div>
            {formData.brand === "Other" && <div><Label>Other Brand</Label><Input value={formData.brand_other || ""} onChange={(e) => handleChange("brand_other", e.target.value)} /></div>}
            <div><Label>Model</Label><ModelSelect value={formData.model_id} onChange={(id, name) => { setFormData(prev => ({ ...prev, model_id: id, model: name })); }} /></div>
            <div><Label>Make Year</Label><Input type="number" step="1" value={formData.make_year ?? ""} onChange={(e) => handleChange("make_year", e.target.value === "" ? null : parseInt(e.target.value))} /></div>
          </div>

          {/* Hardware Specifications */}
          <div className="border rounded-lg p-4 space-y-4">
            <h3 className="font-semibold">Hardware Specifications</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div><Label>CPU</Label><Input value={formData.cpu} onChange={(e) => handleChange("cpu", e.target.value)} /></div>
              <div><Label>Generation</Label><Input type="number" step="1" value={formData.generation ?? ""} onChange={(e) => handleChange("generation", e.target.value === "" ? null : parseInt(e.target.value))} /></div>
              <div><Label>RAM (GB)</Label><Input type="number" step="1" value={formData.ram ?? ""} onChange={(e) => handleChange("ram", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
              <div><Label>SSD / HDD (GB)</Label><Input type="number" step="1" value={formData.ssd ?? ""} onChange={(e) => handleChange("ssd", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
              {isLaptopOrMonitor && <div><Label>Screen Size (inches)</Label><Input type="number" step="0.1" value={formData.screen_size ?? ""} onChange={(e) => handleChange("screen_size", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>}
              {isDesktop && (
                <>
                  <div><Label>Monitor Size (inches)</Label><Input type="number" step="0.1" value={formData.monitor_size ?? ""} onChange={(e) => handleChange("monitor_size", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
                  <div className="flex items-center space-x-2"><input type="checkbox" id="has_keyboard" checked={formData.has_keyboard} onChange={(e) => handleChange("has_keyboard", e.target.checked)} /><Label htmlFor="has_keyboard">Keyboard Included?</Label></div>
                  <div className="flex items-center space-x-2"><input type="checkbox" id="has_mouse" checked={formData.has_mouse} onChange={(e) => handleChange("has_mouse", e.target.checked)} /><Label htmlFor="has_mouse">Mouse Included?</Label></div>
                </>
              )}
              <div className="flex items-center space-x-2"><input type="checkbox" id="charger" checked={formData.charger} onChange={(e) => handleChange("charger", e.target.checked)} /><Label htmlFor="charger">Charger Included?</Label></div>
              <div className="md:col-span-2 lg:col-span-3"><Label>Asset Description</Label><Input value={formData.asset_description} onChange={(e) => handleChange("asset_description", e.target.value)} /></div>
            </div>
          </div>

          {/* SKU (auto) */}
          <div><Label>SKU (Auto)</Label><Input value={formData.sku} disabled className="bg-gray-100" /></div>

          {/* Pricing Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div><Label>Base Price</Label><Input type="number" step="0.01" value={formData.base_price ?? ""} onChange={(e) => handleChange("base_price", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
            <div><Label>Purchase Type</Label><Select value={formData.purchase_type} onValueChange={(val) => handleChange("purchase_type", val)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="GST">GST</SelectItem><SelectItem value="Cash">Cash</SelectItem></SelectContent></Select></div>
            <div><Label>Purchased Invoice Number</Label><Input value={formData.purchased_invoice_number} onChange={(e) => handleChange("purchased_invoice_number", e.target.value)} /></div>
            {isGST && (
              <>
                <div><Label>GST (%)</Label><Input type="number" step="0.01" value={formData.gst ?? ""} onChange={(e) => handleChange("gst", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
                <div><Label>Eway Bill No.</Label><Input value={formData.eway_bill_no} onChange={(e) => handleChange("eway_bill_no", e.target.value)} /></div>
              </>
            )}
            <div><Label>GST Amount (Auto)</Label><Input type="number" step="0.01" value={formData.gst_amount ?? ""} disabled className="bg-gray-100" /></div>
            <div><Label>Total Price (Auto)</Label><Input type="number" step="0.01" value={formData.total_price ?? ""} onChange={(e) => handleChange("total_price", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
            <div><Label>Selling Price</Label><Input type="number" step="0.01" value={formData.selling_price ?? ""} onChange={(e) => handleChange("selling_price", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
            <div><Label>Vendor Invoice Total</Label><Input type="number" step="0.01" value={formData.vendor_invoice_total ?? ""} disabled className="bg-gray-100" /></div>
          </div>

          {quantity > 1 && formData.total_price && (
            <div className="text-right text-sm text-gray-600">Total for {quantity} units: ₹{(formData.total_price * quantity).toFixed(2)}</div>
          )}

          <div><Label>Public Photo URL (optional)</Label><Input value={formData.public_photo_url} onChange={(e) => handleChange("public_photo_url", e.target.value)} placeholder="https://yourwebsite.com/images/product.jpg" /><p className="text-xs text-gray-500 mt-1">Permanent link to product photo (for WhatsApp/email sharing)</p></div>

          {/* Expense Section */}
          <div className="border rounded-lg p-4 space-y-4">
            <div className="flex items-center space-x-2"><input type="checkbox" id="expense" checked={formData.expense} onChange={(e) => handleChange("expense", e.target.checked)} /><Label htmlFor="expense">Any extra expense incurred?</Label></div>
            {formData.expense && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><Label>Expense Amount</Label><Input type="number" step="0.01" value={formData.expense_amount ?? ""} onChange={(e) => handleChange("expense_amount", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
                <div className="md:col-span-2"><Label>Expense Description</Label><Input value={formData.expense_description} onChange={(e) => handleChange("expense_description", e.target.value)} /></div>
              </div>
            )}
          </div>

          {/* Status & Remarks */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label>Status</Label><Select value={formData.status_purchase} onValueChange={(val) => handleChange("status_purchase", val)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Ready for Sale">Ready for Sale</SelectItem><SelectItem value="QC Pending">QC Pending</SelectItem><SelectItem value="Faulty">Faulty</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent></Select></div>
            {formData.status_purchase === "Other" && <div><Label>Other Status</Label><Input value={formData.status_other} onChange={(e) => handleChange("status_other", e.target.value)} placeholder="Specify" /></div>}
          </div>

          <div><Label>Remarks</Label><textarea className="w-full border rounded-md p-2" rows={2} value={formData.remarks} onChange={(e) => handleChange("remarks", e.target.value)} placeholder="Any additional notes..." /></div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="button" variant="secondary" disabled={loading} onClick={() => insertPurchase('draft')}>
              {loading ? "Saving..." : "Save Draft"}
            </Button>
            <Button type="button" variant="default" disabled={loading} onClick={() => insertPurchase('submitted')}>
              {loading ? "Submitting..." : "Submit"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
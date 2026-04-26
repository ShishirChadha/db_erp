"use client";

import { useState, useEffect, useRef } from "react";
import { ModelSelect } from "@/components/ModelSelect";
import { createClient } from "@/lib/supabase/client";
import FileUpload from "@/components/FileUpload";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
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
import SkuBaseFormModal from "./SkuBaseFormModal";
import SkuVariantFormModal from "./SkuVariantFormModal";

function getAssetPrefix(purchasedBy: string, purchasedByOther?: string): string {
  switch (purchasedBy) {
    case "Digitalbluez": return "DBAS";
    case "Techtenth": return "TTAS";
    case "Cash": return "CSAS";
    case "Other": return purchasedByOther ? purchasedByOther.toUpperCase().substring(0, 4) : "OTHR";
    default: return "DBAS";
  }
}

async function getNextAssetNumber(prefix: string): Promise<string> {
  const supabase = createClient();
  if (prefix === "TTAS") {
    const currentYear = new Date().getFullYear() % 100;
    const { data } = await supabase.from("purchases").select("asset_number").ilike("asset_number", "TTAS%").limit(1000);
    let maxSeq = 0;
    if (data) {
      for (const item of data) {
        const match = item.asset_number.match(/-(\d+)$/);
        if (match) maxSeq = Math.max(maxSeq, parseInt(match[1], 10));
      }
    }
    return `TTAS${currentYear}-${maxSeq + 1}`;
  }
  const { data } = await supabase.from("purchases").select("asset_number").ilike("asset_number", `${prefix}%`).order("asset_number", { ascending: false }).limit(1);
  let maxNum = 0;
  if (data && data.length) {
    const match = data[0].asset_number.match(/\d+$/);
    if (match) maxNum = parseInt(match[0], 10);
  }
  return `${prefix}${maxNum + 1}`;
}

function AddVendorInline({ onVendorAdded }: { onVendorAdded: (vendorId: string, vendorName: string) => void }) {
  // same as in AddPurchaseDialog – copied for brevity, you can import a shared component
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    company_name: "", spoc_name: "", owner_name: "", phone: "", email: "",
    address_line1: "", address_line2: "", city: "", state: "", pincode: "",
    has_gst: false, gst_number: "", gst_company_name: "", model_id: null as string | null,
  });
  const supabase = createClient();
  const handleChange = (field: string, value: any) => setFormData(prev => ({ ...prev, [field]: value }));
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.company_name) return alert("Company name required");
    setLoading(true);
    const payload = { ...formData };
    const { data, error } = await supabase.from("vendors").insert([payload]).select().single();
    setLoading(false);
    if (error) alert("Failed: " + error.message);
    else {
      onVendorAdded(data.id, data.company_name);
      setOpen(false);
      setFormData({ company_name: "", spoc_name: "", owner_name: "", phone: "", email: "", address_line1: "", address_line2: "", city: "", state: "", pincode: "", has_gst: false, gst_number: "", gst_company_name: "", model_id: null });
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm" className="mt-2 w-full"><Plus className="mr-2 h-3 w-3" /> Add New Vendor</Button></DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add New Vendor</DialogTitle><DialogDescription className="sr-only">Fill details</DialogDescription></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div><Label>Company Name *</Label><Input required value={formData.company_name} onChange={e => handleChange("company_name", e.target.value)} /></div>
          <div><Label>SPOC Name</Label><Input value={formData.spoc_name} onChange={e => handleChange("spoc_name", e.target.value)} /></div>
          <div><Label>Owner Name</Label><Input value={formData.owner_name} onChange={e => handleChange("owner_name", e.target.value)} /></div>
          <div><Label>Phone</Label><Input value={formData.phone} onChange={e => handleChange("phone", e.target.value)} /></div>
          <div><Label>Email</Label><Input type="email" value={formData.email} onChange={e => handleChange("email", e.target.value)} /></div>
          <div><Label>Address Line 1</Label><Input value={formData.address_line1} onChange={e => handleChange("address_line1", e.target.value)} /></div>
          <div><Label>Address Line 2</Label><Input value={formData.address_line2} onChange={e => handleChange("address_line2", e.target.value)} /></div>
          <div><Label>City</Label><Input value={formData.city} onChange={e => handleChange("city", e.target.value)} /></div>
          <div><Label>State</Label><Input value={formData.state} onChange={e => handleChange("state", e.target.value)} /></div>
          <div><Label>Pincode</Label><Input value={formData.pincode} onChange={e => handleChange("pincode", e.target.value)} /></div>
          <div className="flex items-center space-x-2"><input type="checkbox" id="has_gst" checked={formData.has_gst} onChange={e => handleChange("has_gst", e.target.checked)} /><Label htmlFor="has_gst">Has GST</Label></div>
          {formData.has_gst && (<><div><Label>GST Number</Label><Input value={formData.gst_number} onChange={e => handleChange("gst_number", e.target.value.toUpperCase())} /></div><div><Label>GST Company Name</Label><Input value={formData.gst_company_name} onChange={e => handleChange("gst_company_name", e.target.value)} /></div></>)}
          <div className="flex justify-end space-x-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={loading}>{loading ? "Saving..." : "Save Vendor"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface Purchase {
  id: string;
  entry_date: string;
  purchase_date: string;
  vendor_id: string | null;
  vendor_name: string;
  asset_number: string | null;
  type: string;
  brand: string;
  brand_other?: string;
  model: string;
  model_id: string | null;
  make_year: number | null;
  cpu: string;
  generation: number | null;
  ram: string;
  ssd: string;
  screen_size: string;
  charger: boolean;
  monitor_size: string;
  has_keyboard: boolean;
  has_mouse: boolean;
  sku: string;
  asset_description: string;
  serial_number: string;
  base_price: number | null;
  gst: number | null;
  gst_amount: number | null;
  total_price: number | null;
  selling_price: number | null;
  vendor_invoice_total: number | null;
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
  public_photo_url: string;
  status: string;
  submitted_at?: string;
  sku_variant_id?: string | null;
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
  onUpdate: () => void;
}) {
  const [formData, setFormData] = useState<Partial<Purchase>>({});
  const isUpdating = useRef(false);
  const [loading, setLoading] = useState(false);
  const [vendors, setVendors] = useState<{ id: string; company_name: string }[]>([]);
  const [loadingVendors, setLoadingVendors] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const supabase = createClient();

  // SKU state
  const [skuBases, setSkuBases] = useState<any[]>([]);
  const [selectedBaseId, setSelectedBaseId] = useState("");
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [variants, setVariants] = useState<any[]>([]);
  const [showBaseModal, setShowBaseModal] = useState(false);
  const [showVariantModal, setShowVariantModal] = useState(false);

  const BRAND_OPTIONS = ["Apple", "Dell", "HP", "Lenovo", "Windows", "Asus", "Acer", "Other"];

  const updateVendorInvoiceTotal = async (vendorId: string, invoiceNumber: string) => {
    if (!invoiceNumber) return;
    const { data } = await supabase
      .from("purchases")
      .select("total_price")
      .eq("vendor_id", vendorId)
      .eq("purchased_invoice_number", invoiceNumber)
      .eq("is_deleted", false);
    const totalSum = data?.reduce((sum, row) => sum + (row.total_price || 0), 0) || 0;
    await supabase
      .from("purchases")
      .update({ vendor_invoice_total: totalSum })
      .eq("vendor_id", vendorId)
      .eq("purchased_invoice_number", invoiceNumber)
      .eq("is_deleted", false);
  };

  const fetchVendors = async () => {
    setLoadingVendors(true);
    const { data, error } = await supabase.from("vendors").select("id, company_name").eq("is_deleted", false).order("company_name");
    if (!error && data) setVendors(data);
    setLoadingVendors(false);
  };

  const fetchSkuBases = async () => {
    const res = await fetch("/api/skus");
    const data = await res.json();
    if (res.ok) setSkuBases(data);
  };

  useEffect(() => {
    if (open) {
      fetchVendors();
      fetchSkuBases();
    }
  }, [open]);

  useEffect(() => {
    if (purchase) {
      setFormData({ ...purchase, asset_number: purchase.asset_number ? String(purchase.asset_number) : "" });
      // Pre‑select SKU base and variant if sku_variant_id exists
      if (purchase.sku_variant_id) {
        // Find the variant and base in the fetched skuBases
        for (const base of skuBases) {
          const variant = base.sku_variants?.find((v: any) => v.id === purchase.sku_variant_id);
          if (variant) {
            setSelectedBaseId(base.id);
            setSelectedVariantId(variant.id);
            setVariants(base.sku_variants);
            break;
          }
        }
      }
      if (!purchase.asset_number && purchase.status === "draft") {
        const prefix = getAssetPrefix(purchase.purchased_by_type, purchase.purchased_by_other);
        getNextAssetNumber(prefix).then(num => setFormData(prev => ({ ...prev, asset_number: num })));
      }
    }
  }, [purchase, skuBases]);

  const handleBaseChange = (baseId: string) => {
    setSelectedBaseId(baseId);
    const base = skuBases.find(b => b.id === baseId);
    setVariants(base?.sku_variants || []);
    setSelectedVariantId("");
    setFormData(prev => ({ ...prev, brand: base?.brand || "" }));
  };

  const handleVariantChange = (variantId: string) => {
    setSelectedVariantId(variantId);
    const variant = variants.find(v => v.id === variantId);
    const base = skuBases.find(b => b.id === selectedBaseId);
    if (variant && base) {
      setFormData(prev => ({
        ...prev,
        brand: base.brand || "",
        model: variant.variant_name || "",
        cpu: variant.cpu || "",
        ram: variant.ram_gb || null,
        ssd: variant.ssd_gb || null,
        screen_size: variant.screen_size || null,
        charger: variant.charger ?? false,
        has_keyboard: variant.has_keyboard ?? false,
        has_mouse: variant.has_mouse ?? false,
        make_year: variant.make_year || null,
        generation: variant.generation || null,
        base_price: variant.unit_cost || null,
        selling_price: variant.selling_price || null,
      }));
    }
  };

  useEffect(() => {
    if (selectedBaseId && selectedVariantId) {
      const base = skuBases.find(b => b.id === selectedBaseId);
      const variant = variants.find(v => v.id === selectedVariantId);
      if (base && variant) {
        setFormData(prev => ({ ...prev, sku: `${base.sku_base}-${variant.variant_code}` }));
      }
    } else {
      setFormData(prev => ({ ...prev, sku: "" }));
    }
  }, [selectedBaseId, selectedVariantId, skuBases, variants]);

  // Price calculation (same as add)
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

  const handleChange = (field: keyof Purchase, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (field === "vendor_id") {
      const selected = vendors.find(v => v.id === value);
      if (selected) setFormData(prev => ({ ...prev, vendor_name: selected.company_name }));
    }
    if (field === "purchase_type" && value !== "GST") setFormData(prev => ({ ...prev, gst: null, gst_amount: null }));
    if (field === "brand" && value !== "Other") setFormData(prev => ({ ...prev, brand_other: "" }));
  };

  const handleVendorAdded = (vendorId: string, vendorName: string) => {
    setVendors(prev => [...prev, { id: vendorId, company_name: vendorName }]);
    setFormData(prev => ({ ...prev, vendor_id: vendorId, vendor_name: vendorName }));
    fetchVendors();
  };

  const savePurchase = async (targetStatus: 'draft' | 'submitted') => {
    setLoading(true);
    try {
      if (!formData.purchase_date) throw new Error("Purchase date is required.");
      if (!formData.vendor_id) throw new Error("Please select a vendor.");
      if (!formData.type) throw new Error("Type is required.");

      let finalAssetNumber = null;
      if (targetStatus === 'draft') {
        finalAssetNumber = null;
      } else if (targetStatus === 'submitted') {
        const newAssetNumber = formData.asset_number?.toString().trim() || "";
        const originalAssetNumber = purchase.asset_number?.toString().trim() || "";
        if (newAssetNumber && newAssetNumber !== originalAssetNumber) {
          const { data: existing } = await supabase.from("purchases").select("id").eq("asset_number", newAssetNumber).neq("id", purchase.id).maybeSingle();
          if (existing) throw new Error(`Asset number "${newAssetNumber}" already exists.`);
          finalAssetNumber = newAssetNumber;
        } else if (newAssetNumber) {
          finalAssetNumber = originalAssetNumber;
        } else {
          const prefix = getAssetPrefix(formData.purchased_by_type || purchase.purchased_by_type, formData.purchased_by_other || purchase.purchased_by_other);
          finalAssetNumber = await getNextAssetNumber(prefix);
        }
      }

      const { id, ...updateData } = formData;
      const payload = {
        ...updateData,
        asset_number: finalAssetNumber,
        status: targetStatus,
        submitted_at: targetStatus === 'submitted' ? new Date().toISOString() : purchase.submitted_at,
        sku_variant_id: selectedVariantId || null,
        sku: formData.sku || `${skuBases.find(b => b.id === selectedBaseId)?.sku_base || ""}-${variants.find(v => v.id === selectedVariantId)?.variant_code || ""}`,
      };
      const { error } = await supabase.from("purchases").update(payload).eq("id", purchase.id);
      if (error) throw error;
      if (formData.purchased_invoice_number) await updateVendorInvoiceTotal(formData.vendor_id || purchase.vendor_id || "", formData.purchased_invoice_number || purchase.purchased_invoice_number || "");
      onOpenChange(false);
      onUpdate();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const isGST = formData.purchase_type === "GST";
  const isDesktop = formData.type === "Desktop";
  const isLaptopOrMonitor = formData.type === "Laptop" || formData.type === "Monitor";
  const isDraft = purchase.status === "draft";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[90vw] md:max-w-4xl lg:max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Purchase: {purchase.asset_number || "Draft"}</DialogTitle>
          <DialogDescription className="sr-only">Edit purchase details</DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          {/* Entry & Purchase Date */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label>Entry Date</Label><Input type="date" value={formData.entry_date?.slice(0, 10) || ""} disabled className="bg-gray-100" /></div>
            <div><Label>Purchase Date *</Label><Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}><PopoverTrigger asChild><Button variant="outline" className="w-full justify-start"><CalendarIcon className="mr-2 h-4 w-4" />{formData.purchase_date ? format(new Date(formData.purchase_date), "dd/MM/yyyy") : "Select date"}</Button></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={formData.purchase_date ? new Date(formData.purchase_date) : undefined} onSelect={(date) => { if (date) { handleChange("purchase_date", format(date, "yyyy-MM-dd")); setDatePickerOpen(false); } }} /></PopoverContent></Popover></div>
          </div>

          {/* Vendor & Asset Number */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label>Vendor *</Label><Select value={formData.vendor_id || ""} onValueChange={(val) => handleChange("vendor_id", val)}><SelectTrigger><SelectValue placeholder={loadingVendors ? "Loading vendors..." : "Select vendor"} /></SelectTrigger><SelectContent>{vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.company_name}</SelectItem>)}</SelectContent></Select><AddVendorInline onVendorAdded={handleVendorAdded} /></div>
            <div><Label>Asset Number {isDraft && "(will be generated on submit)"}</Label><Input value={formData.asset_number || ""} onChange={(e) => handleChange("asset_number", e.target.value)} placeholder="e.g., DBAS582" /></div>
          </div>

          {/* SKU Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label>SKU Base</Label><div className="flex gap-2"><Select value={selectedBaseId} onValueChange={handleBaseChange}><SelectTrigger className="flex-1"><SelectValue placeholder="Select base SKU" /></SelectTrigger><SelectContent>{skuBases.map(base => <SelectItem key={base.id} value={base.id}>{base.sku_base} - {base.product_name}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" size="sm" onClick={() => setShowBaseModal(true)}>+ Base</Button></div></div>
            <div><Label>Variant</Label><div className="flex gap-2"><Select value={selectedVariantId} onValueChange={handleVariantChange} disabled={!selectedBaseId}><SelectTrigger className="flex-1"><SelectValue placeholder="Select variant" /></SelectTrigger><SelectContent>{variants.map(v => <SelectItem key={v.id} value={v.id}>{v.variant_code} - {v.variant_name || `${v.ram_gb}GB/${v.ssd_gb}GB`}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" size="sm" onClick={() => setShowVariantModal(true)} disabled={!selectedBaseId}>+ Variant</Button></div></div>
          </div>

          {/* Type, Brand, Model, Make Year */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div><Label>Type *</Label><Select value={formData.type || ""} onValueChange={(val) => handleChange("type", val)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Laptop">Laptop</SelectItem><SelectItem value="Desktop">Desktop</SelectItem><SelectItem value="Monitor">Monitor</SelectItem><SelectItem value="Tablet">Tablet</SelectItem><SelectItem value="Tiny">Tiny</SelectItem></SelectContent></Select></div>
            <div><Label>Brand</Label><Select value={formData.brand || ""} onValueChange={(val) => handleChange("brand", val)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{BRAND_OPTIONS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select></div>
            {formData.brand === "Other" && <div><Label>Other Brand</Label><Input value={formData.brand_other || ""} onChange={(e) => handleChange("brand_other", e.target.value)} /></div>}
            <div><Label>Model</Label><ModelSelect value={formData.model_id} onChange={(id, name) => setFormData(prev => ({ ...prev, model_id: id, model: name }))} /></div>
            <div><Label>Make Year</Label><Input type="number" step="1" value={formData.make_year ?? ""} onChange={(e) => handleChange("make_year", e.target.value === "" ? null : parseInt(e.target.value))} /></div>
          </div>

          {/* Hardware Specifications (unchanged structure) */}
          <div className="border rounded-lg p-4 space-y-4">
            <h3 className="font-semibold">Hardware Specifications</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div><Label>CPU</Label><Input value={formData.cpu || ""} onChange={(e) => handleChange("cpu", e.target.value)} /></div>
              <div><Label>Generation</Label><Input type="number" step="1" value={formData.generation ?? ""} onChange={(e) => handleChange("generation", e.target.value === "" ? null : parseInt(e.target.value))} /></div>
              <div><Label>RAM (GB)</Label><Input type="number" step="1" value={formData.ram ?? ""} onChange={(e) => handleChange("ram", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
              <div><Label>SSD / HDD (GB)</Label><Input type="number" step="1" value={formData.ssd ?? ""} onChange={(e) => handleChange("ssd", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
              {isLaptopOrMonitor && <div><Label>Screen Size (inches)</Label><Input type="number" step="0.1" value={formData.screen_size ?? ""} onChange={(e) => handleChange("screen_size", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>}
              {isDesktop && (<><div><Label>Monitor Size (inches)</Label><Input type="number" step="0.1" value={formData.monitor_size ?? ""} onChange={(e) => handleChange("monitor_size", e.target.value === "" ? null : parseFloat(e.target.value))} /></div><div className="flex items-center space-x-2"><input type="checkbox" id="has_keyboard" checked={formData.has_keyboard || false} onChange={(e) => handleChange("has_keyboard", e.target.checked)} /><Label htmlFor="has_keyboard">Keyboard Included?</Label></div><div className="flex items-center space-x-2"><input type="checkbox" id="has_mouse" checked={formData.has_mouse || false} onChange={(e) => handleChange("has_mouse", e.target.checked)} /><Label htmlFor="has_mouse">Mouse Included?</Label></div></>)}
              <div className="flex items-center space-x-2"><input type="checkbox" id="charger" checked={formData.charger || false} onChange={(e) => handleChange("charger", e.target.checked)} /><Label htmlFor="charger">Charger Included?</Label></div>
              <div className="md:col-span-2 lg:col-span-3"><Label>Asset Description</Label><Input value={formData.asset_description || ""} onChange={(e) => handleChange("asset_description", e.target.value)} /></div>
            </div>
          </div>

          {/* SKU (auto) */}
          <div><Label>SKU Code</Label><Input value={formData.sku || ""} disabled className="bg-gray-100" /></div>
          <div><Label>Serial Number</Label><Input value={formData.serial_number || ""} onChange={(e) => handleChange("serial_number", e.target.value)} /></div>

          {/* Pricing Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div><Label>Base Price</Label><Input type="number" step="0.01" value={formData.base_price ?? ""} onChange={(e) => handleChange("base_price", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
            <div><Label>Purchase Type</Label><Select value={formData.purchase_type || "GST"} onValueChange={(val) => handleChange("purchase_type", val)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="GST">GST</SelectItem><SelectItem value="Cash">Cash</SelectItem></SelectContent></Select></div>
            <div><Label>Purchased Invoice Number</Label><Input value={formData.purchased_invoice_number || ""} onChange={(e) => handleChange("purchased_invoice_number", e.target.value)} /></div>
            {isGST && (<><div><Label>GST (%)</Label><Input type="number" step="0.01" value={formData.gst ?? ""} onChange={(e) => handleChange("gst", e.target.value === "" ? null : parseFloat(e.target.value))} /></div><div><Label>Eway Bill No.</Label><Input value={formData.eway_bill_no || ""} onChange={(e) => handleChange("eway_bill_no", e.target.value)} /></div></>)}
            <div><Label>GST Amount (Auto)</Label><Input type="number" step="0.01" value={formData.gst_amount ?? ""} disabled className="bg-gray-100" /></div>
            <div><Label>Total Price (Auto)</Label><Input type="number" step="0.01" value={formData.total_price ?? ""} onChange={(e) => handleChange("total_price", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
            <div><Label>Selling Price</Label><Input type="number" step="0.01" value={formData.selling_price ?? ""} onChange={(e) => handleChange("selling_price", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
            <div><Label>Vendor Invoice Total</Label><Input type="number" step="0.01" value={formData.vendor_invoice_total ?? ""} disabled className="bg-gray-100" /></div>
          </div>

          <div><Label>Public Photo URL</Label><Input value={formData.public_photo_url || ""} onChange={(e) => handleChange("public_photo_url", e.target.value)} placeholder="https://..." /></div>

          {/* Expense Section */}
          <div className="border rounded-lg p-4 space-y-4"><div className="flex items-center space-x-2"><input type="checkbox" id="expense" checked={formData.expense || false} onChange={(e) => handleChange("expense", e.target.checked)} /><Label htmlFor="expense">Any extra expense incurred?</Label></div>{formData.expense && (<div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div><Label>Expense Amount</Label><Input type="number" step="0.01" value={formData.expense_amount ?? ""} onChange={(e) => handleChange("expense_amount", e.target.value === "" ? null : parseFloat(e.target.value))} /></div><div className="md:col-span-2"><Label>Expense Description</Label><Input value={formData.expense_description || ""} onChange={(e) => handleChange("expense_description", e.target.value)} /></div></div>)}</div>

          {/* Status, Purchased By, Remarks */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label>Status</Label><Select value={formData.status_purchase || ""} onValueChange={(val) => handleChange("status_purchase", val)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Ready for Sale">Ready for Sale</SelectItem><SelectItem value="QC Pending">QC Pending</SelectItem><SelectItem value="Faulty">Faulty</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent></Select></div>
            {formData.status_purchase === "Other" && <div><Label>Other Status</Label><Input value={formData.status_other || ""} onChange={(e) => handleChange("status_other", e.target.value)} /></div>}
            <div><Label>Purchased By</Label><Select value={formData.purchased_by_type || ""} onValueChange={(val) => handleChange("purchased_by_type", val)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Digitalbluez">Digitalbluez</SelectItem><SelectItem value="Techtenth">Techtenth</SelectItem><SelectItem value="Cash">Cash</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent></Select></div>
            {formData.purchased_by_type === "Other" && <div><Label>Other Purchased By</Label><Input value={formData.purchased_by_other || ""} onChange={(e) => handleChange("purchased_by_other", e.target.value)} /></div>}
          </div>
          <div><Label>Remarks</Label><textarea className="w-full border rounded-md p-2" rows={2} value={formData.remarks || ""} onChange={(e) => handleChange("remarks", e.target.value)}></textarea></div>

          {/* File Upload */}
          <div className="mt-6 pt-4 border-t"><h4 className="text-sm font-medium mb-3">Attached Files</h4><FileUpload purchaseId={purchase.id} assetNumber={purchase.asset_number || ""} /></div>

          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="secondary" disabled={loading} onClick={() => savePurchase('draft')}>{loading ? "Saving..." : "Save Draft"}</Button>
            <Button variant="default" disabled={loading} onClick={() => savePurchase('submitted')}>{loading ? "Submitting..." : "Submit"}</Button>
          </div>
        </div>
      </DialogContent>

      <SkuBaseFormModal open={showBaseModal} onOpenChange={setShowBaseModal} onCreated={fetchSkuBases} />
      <SkuVariantFormModal open={showVariantModal} onOpenChange={setShowVariantModal} skuBaseId={selectedBaseId} onCreated={fetchSkuBases} />
    </Dialog>
  );
}
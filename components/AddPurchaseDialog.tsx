
"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api-client";
import { useCustomOptions } from "@/lib/useCustomOptions";
import { SearchableSelect } from "@/components/SearchableSelect";
import { getCustomOptionsCategory } from "@/lib/sku-field-options";
import { TYPE_TO_CATEGORY } from "@/lib/sku-category-map";
import { useAsyncAction } from "@/lib/useAsyncAction";
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

// ---------- Inline Add Vendor Component (full) ----------
function AddVendorInline({ onVendorAdded }: { onVendorAdded: (vendorId: string, vendorName: string) => void }) {
  const [open, setOpen] = useState(false);
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

  const { run: handleSubmit, pending: vendorSubmitting } = useAsyncAction(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.company_name) {
      alert("Company name is required");
      return;
    }
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
        model_id: null,
      });
    }
  });

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
            <Button type="submit" loading={vendorSubmitting}>Save Vendor</Button>
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
  const [skuGenerated, setSkuGenerated] = useState(false);
  const [vendors, setVendors] = useState<{ id: string; company_name: string }[]>([]);
  const [loadingVendors, setLoadingVendors] = useState(false);
  const today = new Date().toISOString().split("T")[0];
  const supabase = createClient();

  const [quantity, setQuantity] = useState(1);
  const [serialNumbersList, setSerialNumbersList] = useState("");
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const { values: cpuOptions } = useCustomOptions('cpu');
  const { values: generationOptions } = useCustomOptions('generation');
  const { values: ramOptions } = useCustomOptions('ram');
  const { values: storageOptions } = useCustomOptions('storage');
  const { values: laptopScreenOptions } = useCustomOptions('screen_size_laptop');
  const { values: monitorScreenOptions } = useCustomOptions('screen_size_monitor');
  const { values: brandOptions } = useCustomOptions('brand');

  const [formData, setFormData] = useState({
    entry_date: today,
    purchase_date: "",
    vendor_id: "",
    vendor_name: "",
    type: "Laptop",
    brand: "",
    brand_other: "",
    model: "",
    make_year: null as number | null,
    sku: "",
    asset_description: "",
    serial_number: "",
    cpu: "",
    generation: "",
    ram: "",
    ssd: "",
    screen_size: "",
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

  const modelCategory = getCustomOptionsCategory(TYPE_TO_CATEGORY[formData.type] || 'OTHER', 'model');
  const { values: modelOptions } = useCustomOptions(modelCategory || 'model_laptop');

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
    if (initialData) {
      setFormData(prev => ({
        ...prev,
        ...initialData,
        serial_number: "",
        asset_number: "",
        purchased_by_type: initialData.purchased_by_type || "Digitalbluez",
        purchased_by_other: initialData.purchased_by_other || "",
      }));
      setQuantity(1);
      setSerialNumbersList("");
      setSkuGenerated(false);
    } else {
      setFormData({
        entry_date: today,
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
        generation: "",
        ram: "",
        ssd: "",
        screen_size: "",
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
        asset_number: "",
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
  };

  const handleVendorAdded = (vendorId: string, vendorName: string) => {
    setVendors((prev) => [...prev, { id: vendorId, company_name: vendorName }]);
    setFormData((prev) => ({ ...prev, vendor_id: vendorId, vendor_name: vendorName }));
    fetchVendors();
  };

  const { run: insertPurchase, pending: loading } = useAsyncAction(async (status: 'draft' | 'submitted') => {
    try {
      if (!formData.purchase_date) throw new Error("Purchase date is required.");
      if (!formData.vendor_id) throw new Error("Please select a vendor.");
      if (!formData.type) throw new Error("Type is required.");

      const serialNumbers = quantity > 1
        ? serialNumbersList.split(/\r?\n/).map(s => s.trim())
        : undefined;

      const res = await apiFetch("/api/purchases", {
        method: "POST",
        body: JSON.stringify({
          ...formData,
          quantity,
          serial_numbers: serialNumbers,
          status,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save purchase.");
      }

      onOpenChange(false);
      onAdd();
    } catch (err: any) {
      console.error("Insert error:", err);
      alert(err.message);
    }
  });

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
            <Label>Asset Number (optional override)</Label>
            <Input
              value={formData.asset_number}
              onChange={(e) => handleChange("asset_number", e.target.value)}
              placeholder="Leave blank to auto-assign on Submit"
              disabled={quantity > 1}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {quantity > 1
                ? "Numbers are auto-assigned for multi-unit entries."
                : "Auto-assigned on Submit unless you specify one. Draft entries don't consume a number until finalized."}
            </p>
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
            <div><Label>Brand</Label><SearchableSelect options={brandOptions} value={formData.brand} onChange={(v) => handleChange("brand", v)} placeholder="Select brand..." /></div>
            <div><Label>Model</Label>
              {modelCategory ? (
                <SearchableSelect options={modelOptions} value={formData.model} onChange={(v) => handleChange("model", v)} placeholder="Select model..." />
              ) : (
                <Input value={formData.model} onChange={(e) => handleChange("model", e.target.value)} />
              )}
            </div>
            <div><Label>Make Year</Label><Input type="number" step="1" value={formData.make_year ?? ""} onChange={(e) => handleChange("make_year", e.target.value === "" ? null : parseInt(e.target.value))} /></div>
          </div>

          {/* Hardware Specifications */}
          <div className="border rounded-lg p-4 space-y-4">
            <h3 className="font-semibold">Hardware Specifications</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div><Label>CPU</Label><SearchableSelect options={cpuOptions} value={formData.cpu} onChange={(v) => handleChange("cpu", v)} placeholder="Select CPU..." /></div>
              <div><Label>Generation</Label><SearchableSelect options={generationOptions} value={formData.generation} onChange={(v) => handleChange("generation", v)} placeholder="Select generation..." /></div>
              <div><Label>RAM (GB)</Label><SearchableSelect options={ramOptions} value={formData.ram} onChange={(v) => handleChange("ram", v)} placeholder="Select RAM..." /></div>
              <div><Label>SSD / HDD (GB)</Label><SearchableSelect options={storageOptions} value={formData.ssd} onChange={(v) => handleChange("ssd", v)} placeholder="Select storage..." /></div>
              {isLaptopOrMonitor && <div><Label>Screen Size (inches)</Label><SearchableSelect options={formData.type === "Monitor" ? monitorScreenOptions : laptopScreenOptions} value={formData.screen_size} onChange={(v) => handleChange("screen_size", v)} placeholder="Select screen size..." /></div>}
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
            <Button type="button" variant="secondary" loading={loading} onClick={() => insertPurchase('draft')}>
              Save Draft
            </Button>
            <Button type="button" variant="default" loading={loading} onClick={() => insertPurchase('submitted')}>
              Submit
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
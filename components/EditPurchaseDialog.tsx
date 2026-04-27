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

// ---------- Helper: get asset prefix based on purchased_by ----------
function getAssetPrefix(purchasedBy: string, purchasedByOther?: string): string {
switch (purchasedBy) {
case "Digitalbluez": return "DBAS";
case "Techtenth": return "TTAS";
case "Cash": return "CSAS";
case "Other": return purchasedByOther ? purchasedByOther.toUpperCase().substring(0, 4) : "OTHR";
default: return "DBAS";
}
}

// ---------- Helper: generate next asset number (non‑consuming) ----------
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

// ---------- Purchase Interface ----------
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
  model_id: string | null;   // ✅ add this line
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

const updateVendorInvoiceTotal = async (vendorId: string, invoiceNumber: string) => {
if (!invoiceNumber) return;
const { data, error } = await supabase
.from("purchases")
.select("total_price")
.eq("vendor_id", vendorId)
.eq("purchased_invoice_number", invoiceNumber)
.eq("is_deleted", false);
if (error) return;
const totalSum = data.reduce((sum, row) => sum + (row.total_price || 0), 0);
await supabase
.from("purchases")
.update({ vendor_invoice_total: totalSum })
.eq("vendor_id", vendorId)
.eq("purchased_invoice_number", invoiceNumber)
.eq("is_deleted", false);
};

const BRAND_OPTIONS = ["Apple", "Dell", "HP", "Lenovo", "Windows", "Asus", "Acer", "Other"];

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
setFormData({
...purchase,
asset_number: purchase.asset_number ? String(purchase.asset_number) : "",
});
if (!purchase.asset_number && purchase.status === "draft") {
const prefix = getAssetPrefix(purchase.purchased_by_type, purchase.purchased_by_other);
getNextAssetNumber(prefix).then(num => {
setFormData(prev => ({ ...prev, asset_number: num }));
});
}
}, [purchase]);
// When purchased_by_type changes for a draft, update the suggested asset number
useEffect(() => {
if (open && purchase.status === "draft") {
const prefix = getAssetPrefix(
formData.purchased_by_type || purchase.purchased_by_type,
formData.purchased_by_other || purchase.purchased_by_other
);
getNextAssetNumber(prefix).then(num => {
setFormData(prev => ({ ...prev, asset_number: num }));
});
}
}, [formData.purchased_by_type, formData.purchased_by_other, open, purchase.status]);

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

const handleChange = (field: keyof Purchase, value: any) => {
setFormData((prev) => ({ ...prev, [field]: value }));
if (field === "vendor_id") {
const selected = vendors.find((v) => v.id === value);
if (selected) setFormData((prev) => ({ ...prev, vendor_name: selected.company_name }));
}
if (field === "purchase_type" && value !== "GST") {
setFormData((prev) => ({ ...prev, gst: null, gst_amount: null }));
}
if (field === "brand" && value !== "Other") setFormData((prev) => ({ ...prev, brand_other: "" }));
};

const handleVendorAdded = (vendorId: string, vendorName: string) => {
setVendors((prev) => [...prev, { id: vendorId, company_name: vendorName }]);
setFormData((prev) => ({ ...prev, vendor_id: vendorId, vendor_name: vendorName }));
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
// Get the new value from the form (user may have edited it)
const newAssetNumber = formData.asset_number?.toString().trim() || "";
const originalAssetNumber = purchase.asset_number?.toString().trim() || "";

if (newAssetNumber && newAssetNumber !== originalAssetNumber) {
// User changed the asset number – validate uniqueness
const { data: existing } = await supabase
.from("purchases")
.select("id")
.eq("asset_number", newAssetNumber)
.neq("id", purchase.id)
.maybeSingle();
if (existing) throw new Error(`Asset number "${newAssetNumber}" already exists. Please choose another.`);
finalAssetNumber = newAssetNumber;
} else if (newAssetNumber) {
// Keep the original (unchanged)
finalAssetNumber = originalAssetNumber;
} else {
// If empty, generate a new one
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
};
const { error } = await supabase
.from("purchases")
.update(payload)
.eq("id", purchase.id);
if (error) throw error;
await updateVendorInvoiceTotal(
formData.vendor_id || purchase.vendor_id || "",
formData.purchased_invoice_number || purchase.purchased_invoice_number || ""
);
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
{/* Row 1: Entry Date, Purchase Date */}
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
<div>
<Label>Entry Date</Label>
<Input type="date" value={formData.entry_date?.slice(0, 10) || ""} disabled className="bg-gray-100" />
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

{/* Vendor and Asset Number */}
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
<div className="min-w-0">
<Label>Vendor *</Label>
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
<Label>Asset Number {isDraft && "(will be generated on submit)"}</Label>
<Input
value={formData.asset_number || ""}
onChange={(e) => handleChange("asset_number", e.target.value)}
placeholder="e.g., DBAS582"
/>
</div>
</div>

{/* Type, Brand, Model, Make Year */}
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
<div>
<Label>Type *</Label>
<Select value={formData.type || ""} onValueChange={(val) => handleChange("type", val)}>
<SelectTrigger><SelectValue /></SelectTrigger>
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
<Select value={formData.brand || ""} onValueChange={(val) => handleChange("brand", val)}>
<SelectTrigger><SelectValue /></SelectTrigger>
<SelectContent>
{BRAND_OPTIONS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
</SelectContent>
</Select>
</div>
{formData.brand === "Other" && (
<div>
<Label>Other Brand</Label>
<Input value={formData.brand_other || ""} onChange={(e) => handleChange("brand_other", e.target.value)} />
</div>
)}
<div>
<Label>Model</Label>
<ModelSelect
    value={formData.model_id}
   value={formData.model_id ?? null}
onChange={(id, name) => {
setFormData(prev => ({ ...prev, model_id: id, model: name }));
}}
/>
</div>
<div>
<Label>Make Year</Label>
<Input type="number" step="1" value={formData.make_year ?? ""} onChange={(e) => handleChange("make_year", e.target.value === "" ? null : parseInt(e.target.value))} />
</div>
</div>

{/* Hardware Specifications */}
<div className="border rounded-lg p-4 space-y-4">
<h3 className="font-semibold">Hardware Specifications</h3>
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
<div><Label>CPU</Label><Input value={formData.cpu || ""} onChange={(e) => handleChange("cpu", e.target.value)} /></div>
<div><Label>Generation</Label><Input type="number" step="1" value={formData.generation ?? ""} onChange={(e) => handleChange("generation", e.target.value === "" ? null : parseInt(e.target.value))} /></div>
<div><Label>RAM (GB)</Label><Input type="number" step="1" value={formData.ram ?? ""} onChange={(e) => handleChange("ram", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
<div><Label>SSD / HDD (GB)</Label><Input type="number" step="1" value={formData.ssd ?? ""} onChange={(e) => handleChange("ssd", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
{isLaptopOrMonitor && <div><Label>Screen Size (inches)</Label><Input type="number" step="0.1" value={formData.screen_size ?? ""} onChange={(e) => handleChange("screen_size", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>}
{isDesktop && (
<>
<div><Label>Monitor Size (inches)</Label><Input type="number" step="0.1" value={formData.monitor_size ?? ""} onChange={(e) => handleChange("monitor_size", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
<div className="flex items-center space-x-2"><input type="checkbox" id="has_keyboard" checked={formData.has_keyboard || false} onChange={(e) => handleChange("has_keyboard", e.target.checked)} /><Label htmlFor="has_keyboard">Keyboard Included?</Label></div>
<div className="flex items-center space-x-2"><input type="checkbox" id="has_mouse" checked={formData.has_mouse || false} onChange={(e) => handleChange("has_mouse", e.target.checked)} /><Label htmlFor="has_mouse">Mouse Included?</Label></div>
</>
)}
<div className="flex items-center space-x-2"><input type="checkbox" id="charger" checked={formData.charger || false} onChange={(e) => handleChange("charger", e.target.checked)} /><Label htmlFor="charger">Charger Included?</Label></div>
<div className="md:col-span-2 lg:col-span-3"><Label>Asset Description</Label><Input value={formData.asset_description || ""} onChange={(e) => handleChange("asset_description", e.target.value)} /></div>
</div>
</div>

{/* SKU (auto) */}
<div><Label>SKU</Label><Input value={formData.sku || ""} disabled className="bg-gray-100" /></div>
<div><Label>Serial Number</Label><Input value={formData.serial_number || ""} onChange={(e) => handleChange("serial_number", e.target.value)} /></div>

{/* Pricing Section */}
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
<div><Label>Base Price</Label><Input type="number" step="0.01" value={formData.base_price ?? ""} onChange={(e) => handleChange("base_price", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
<div><Label>Purchase Type</Label><Select value={formData.purchase_type || "GST"} onValueChange={(val) => handleChange("purchase_type", val)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="GST">GST</SelectItem><SelectItem value="Cash">Cash</SelectItem></SelectContent></Select></div>
<div><Label>Purchased Invoice Number</Label><Input value={formData.purchased_invoice_number || ""} onChange={(e) => handleChange("purchased_invoice_number", e.target.value)} /></div>
{isGST && (
<>
<div><Label>GST (%)</Label><Input type="number" step="0.01" value={formData.gst ?? ""} onChange={(e) => handleChange("gst", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>

<div><Label>Eway Bill No.</Label><Input value={formData.eway_bill_no || ""} onChange={(e) => handleChange("eway_bill_no", e.target.value)} /></div>
</>
)}
<div><Label>GST Amount (Auto)</Label><Input type="number" step="0.01" value={formData.gst_amount ?? ""} disabled className="bg-gray-100" /></div>
<div><Label>Total Price (Auto)</Label><Input type="number" step="0.01" value={formData.total_price ?? ""} onChange={(e) => handleChange("total_price", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
<div><Label>Selling Price</Label><Input type="number" step="0.01" value={formData.selling_price ?? ""} onChange={(e) => handleChange("selling_price", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
<div><Label>Vendor Invoice Total</Label><Input
type="number"
step="0.01"
value={formData.vendor_invoice_total ?? ""}
disabled
className="bg-gray-100"
/></div>
</div>

<div><Label>Public Photo URL</Label><Input value={formData.public_photo_url || ""} onChange={(e) => handleChange("public_photo_url", e.target.value)} placeholder="https://yourwebsite.com/images/product.jpg" /></div>

{/* Expense Section */}
<div className="border rounded-lg p-4 space-y-4">
<div className="flex items-center space-x-2"><input type="checkbox" id="expense" checked={formData.expense || false} onChange={(e) => handleChange("expense", e.target.checked)} /><Label htmlFor="expense">Any extra expense incurred?</Label></div>
{formData.expense && (
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
<div><Label>Expense Amount</Label><Input type="number" step="0.01" value={formData.expense_amount ?? ""} onChange={(e) => handleChange("expense_amount", e.target.value === "" ? null : parseFloat(e.target.value))} /></div>
<div className="md:col-span-2"><Label>Expense Description</Label><Input value={formData.expense_description || ""} onChange={(e) => handleChange("expense_description", e.target.value)} /></div>
</div>
)}
</div>

{/* Status, Purchased By, Remarks */}
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
<div><Label>Status</Label><Select value={formData.status_purchase || ""} onValueChange={(val) => handleChange("status_purchase", val)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Ready for Sale">Ready for Sale</SelectItem><SelectItem value="QC Pending">QC Pending</SelectItem><SelectItem value="Faulty">Faulty</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent></Select></div>
{formData.status_purchase === "Other" && <div><Label>Other Status</Label><Input value={formData.status_other || ""} onChange={(e) => handleChange("status_other", e.target.value)} /></div>}
<div><Label>Purchased By</Label><Select value={formData.purchased_by_type || ""} onValueChange={(val) => handleChange("purchased_by_type", val)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Digitalbluez">Digitalbluez</SelectItem><SelectItem value="Techtenth">Techtenth</SelectItem><SelectItem value="Cash">Cash</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent></Select></div>
{formData.purchased_by_type === "Other" && <div><Label>Other Purchased By</Label><Input value={formData.purchased_by_other || ""} onChange={(e) => handleChange("purchased_by_other", e.target.value)} /></div>}
</div>

<div><Label>Remarks</Label><textarea className="w-full border rounded-md p-2" rows={2} value={formData.remarks || ""} onChange={(e) => handleChange("remarks", e.target.value)} /></div>

{/* File Upload */}
<div className="mt-6 pt-4 border-t border-gray-200">
<h4 className="text-sm font-medium mb-3">Attached Files (Invoices, E-Way Bills, Receipts)</h4>
<FileUpload purchaseId={purchase.id} assetNumber={purchase.asset_number || ""} />
</div>

{/* Action Buttons */}
<div className="flex justify-end space-x-2">
<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
<Button type="button" variant="secondary" disabled={loading} onClick={() => savePurchase('draft')}>
{loading ? "Saving..." : "Save Draft"}
</Button>
<Button type="button" variant="default" disabled={loading} onClick={() => savePurchase('submitted')}>
{loading ? "Submitting..." : "Submit"}
</Button>
</div>
</div>
</DialogContent>
</Dialog>
);
}
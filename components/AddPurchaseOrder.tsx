'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, Plus, Trash2, Search, X } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,DialogDescription } from '@/components/ui/dialog';

// Categories and their extra fields
const CATEGORIES = ['Laptop', 'Desktop', 'Monitor', 'RAM', 'SSD', 'Keyboard', 'Mouse', 'Cable', 'Charger', 'Battery', 'Other'];

interface LineItem {
  id: string;
  category: string;
  sku_variant_id: string;
  sku_label: string;
  quantity: number;
  unit_cost: number;
  discount_percent: number;
  line_total: number;
  serial_numbers: string;
  asset_description: string;
  notes: string;
  // Dynamic fields for extra specs
  extra_specs: Record<string, any>;
}

// Component for searchable SKU dropdown with inline add
function SearchableSkuSelect({ value, onSelect, onAddNew, skus, category }: any) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const filteredSkus = skus.filter((sku: any) => 
    sku.label.toLowerCase().includes(search.toLowerCase()) && sku.category === category
  );
  const selectedSku = skus.find((s: any) => s.id === value);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <div
            className="w-full border rounded-md p-2 bg-white cursor-text flex items-center justify-between"
            onClick={() => setOpen(true)}
          >
            <span className={selectedSku ? 'text-gray-900' : 'text-gray-400'}>
              {selectedSku?.label || 'Select SKU'}
            </span>
            <Search className="h-4 w-4 text-gray-400" />
          </div>
          {open && (
            <div className="absolute z-50 mt-1 w-full bg-white border rounded-md shadow-lg max-h-60 overflow-auto">
              <div className="sticky top-0 bg-white p-1 border-b">
                <Input
                  ref={inputRef}
                  placeholder="Search SKU..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="border-0 focus-visible:ring-0"
                />
              </div>
              {filteredSkus.length === 0 ? (
                <div className="p-2 text-sm text-gray-500">No SKUs found. <button className="text-blue-600" onClick={() => { onAddNew(); setOpen(false); }}>Add new SKU</button></div>
              ) : (
                filteredSkus.map((sku: any) => (
                  <div
                    key={sku.id}
                    className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                    onClick={() => { onSelect(sku.id); setOpen(false); setSearch(''); }}
                  >
                    {sku.label}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" disabled={!category}  onClick={() => { onAddNew(); setOpen(false); }}><Plus className="h-3 w-3" /> New</Button>
      </div>
    </div>
  );
}

function AddSkuModal({ open, onClose, onCreated, preselectedCategory }: any) {
  const [skuBaseList, setSkuBaseList] = useState<any[]>([]);
  const [selectedBaseId, setSelectedBaseId] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(preselectedCategory || '');
  const [loading, setLoading] = useState(false);
  // Separate top-level variant fields – not part of specs
  const [variantCode, setVariantCode] = useState('');
  const [variantName, setVariantName] = useState('');
  const [specs, setSpecs] = useState<Record<string, any>>({});

  useEffect(() => {
    if (open) fetchSkuBases();
  }, [open]);

  const fetchSkuBases = async () => {
    const res = await fetch('/api/skus');
    if (res.ok) {
      const data = await res.json();
      setSkuBaseList(data);
    }
  };

  const filteredBases = preselectedCategory
    ? skuBaseList.filter((b: any) => b.category === preselectedCategory)
    : skuBaseList;

  // Category‑specific extra fields only (no variant_code/variant_name here)
  const getExtraFields = () => {
    switch (selectedCategory) {
      case 'Laptop':
        return [
          { name: 'cpu', label: 'CPU', type: 'text' },
          { name: 'ram_gb', label: 'RAM (GB)', type: 'number' },
          { name: 'ssd_gb', label: 'SSD (GB)', type: 'number' },
          { name: 'screen_size', label: 'Screen Size (in)', type: 'number', step: 0.1 },
          { name: 'charger', label: 'Charger Included', type: 'checkbox' },
          { name: 'has_keyboard', label: 'Keyboard Included', type: 'checkbox' },
          { name: 'has_mouse', label: 'Mouse Included', type: 'checkbox' },
          { name: 'make_year', label: 'Make Year', type: 'number' },
          { name: 'generation', label: 'Generation', type: 'text' }
        ];
      case 'RAM':
        return [
          { name: 'speed_mhz', label: 'Speed (MHz)', type: 'number' },
          { name: 'cas_latency', label: 'CAS Latency', type: 'text' },
          { name: 'form_factor', label: 'Form Factor', type: 'select', options: ['SODIMM', 'DIMM'] }
        ];
      case 'SSD':
        return [
          { name: 'interface', label: 'Interface', type: 'select', options: ['SATA', 'NVMe'] },
          { name: 'read_speed', label: 'Read Speed (MB/s)', type: 'number' },
          { name: 'write_speed', label: 'Write Speed (MB/s)', type: 'number' }
        ];
      case 'Battery':
        return [
          { name: 'capacity_wh', label: 'Capacity (Wh)', type: 'number' },
          { name: 'voltage_v', label: 'Voltage (V)', type: 'number' },
          { name: 'chemistry', label: 'Chemistry', type: 'select', options: ['Li-ion', 'Li-Po', 'NiMH'] }
        ];
      default:
        return [];
    }
  };

  const handleSubmit = async () => {
    if (!selectedBaseId) {
      toast.error('Select a SKU base');
      return;
    }
    if (!variantCode.trim()) {
      toast.error('Variant code is required');
      return;
    }
    setLoading(true);
    const payload = {
      type: 'variant',
      sku_base_id: selectedBaseId,
      variant_code: variantCode,
      variant_name: variantName,
      specs: specs,   // only the extra category specs
    };
    const res = await fetch('/api/skus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      toast.success('SKU variant added');
      onCreated();
      onClose();
      // Reset fields
      setVariantCode('');
      setVariantName('');
      setSpecs({});
      setSelectedBaseId('');
    } else {
      const err = await res.json();
      toast.error(err.error || 'Failed to add SKU');
    }
    setLoading(false);
  };

  const extraFields = getExtraFields();

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New SKU Variant</DialogTitle>
          {/* Add description to silence accessibility warning */}
          <DialogDescription className="sr-only">
            Create a new variant under the selected SKU base. Fill in the required fields below.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>SKU Base</Label>
            <Select value={selectedBaseId} onValueChange={(id) => {
              const base = filteredBases.find((b: any) => b.id === id);
              setSelectedBaseId(id);
              setSelectedCategory(base?.category || preselectedCategory);
            }}>
              <SelectTrigger><SelectValue placeholder="Select base" /></SelectTrigger>
              <SelectContent>
                {filteredBases.map((base: any) => (
                  <SelectItem key={base.id} value={base.id}>{base.sku_base}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Dedicated variant_code and variant_name inputs */}
          <div>
            <Label>Variant Code *</Label>
            <Input
              value={variantCode}
              onChange={(e) => setVariantCode(e.target.value)}
              placeholder="e.g., 16GB-512GB"
            />
          </div>
          <div>
            <Label>Variant Name</Label>
            <Input
              value={variantName}
              onChange={(e) => setVariantName(e.target.value)}
              placeholder="e.g., Standard, Performance"
            />
          </div>

          {/* Dynamic extra fields */}
          {extraFields.map((field) => (
            field.type === 'checkbox' ? (
              <div className="flex items-center gap-2" key={field.name}>
                <input
                  type="checkbox"
                  id={field.name}
                  checked={specs[field.name] || false}
                  onChange={(e) => setSpecs({ ...specs, [field.name]: e.target.checked })}
                />
                <Label htmlFor={field.name}>{field.label}</Label>
              </div>
            ) : field.type === 'select' ? (
              <div key={field.name}>
                <Label>{field.label}</Label>
                <Select
                  value={specs[field.name] || ''}
                  onValueChange={(val) => setSpecs({ ...specs, [field.name]: val })}
                >
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {field.options?.map((opt: string) => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div key={field.name}>
                <Label>{field.label}</Label>
                <Input
                  type={field.type}
                  step={field.step}
                  value={specs[field.name] ?? ''}
                  onChange={(e) =>
                    setSpecs({
                      ...specs,
                      [field.name]:
                        field.type === 'number'
                          ? (e.target.value === '' ? '' : Number(e.target.value))
                          : e.target.value,
                    })
                  }
                />
              </div>
            )
          ))}
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={loading}>Save Variant</Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AddPurchaseOrder({ onSuccess }: { onSuccess?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [vendors, setVendors] = useState<any[]>([]);
  const [allSkus, setAllSkus] = useState<any[]>([]);
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { id: crypto.randomUUID(), category: '', sku_variant_id: '', sku_label: '', quantity: 1, unit_cost: 0, discount_percent: 0, line_total: 0, serial_numbers: '', asset_description: '', notes: '', extra_specs: {} }
  ]);
  const [showSkuModal, setShowSkuModal] = useState(false);
  const [currentCategoryForSku, setCurrentCategoryForSku] = useState('');

  const [form, setForm] = useState({
    vendor_id: '',
    po_date: new Date(),
    purchased_by_type: 'Digitalbluez',
    purchased_by_other: '',
    purchase_type: 'GST',
    tax_percent: 18,
    supplier_invoice_number: '',
    eway_bill_no: '',
    has_expense: false,
    expense_amount: '',
    expense_description: '',
    remarks: '',
    public_photo_url: '',
  });

  useEffect(() => {
    fetchVendors();
    fetchSkus();
  }, []);

  const fetchVendors = async () => {
    const res = await fetch('/api/vendors');
    if (res.ok) setVendors(await res.json());
  };

  const fetchSkus = async () => {
    const res = await fetch('/api/skus');
    if (res.ok) {
      const data = await res.json();
      const flattened = data.flatMap((base: any) =>
        base.sku_variants.map((v: any) => ({
          id: v.id,
          category: base.category,
          label: `${base.sku_base} - ${v.variant_code} (${v.variant_name || `${v.ram_gb}GB/${v.ssd_gb}GB`})`,
          unit_cost: v.unit_cost || 0,
          extra: { ...v, brand: base.brand, product_name: base.product_name }
        }))
      );
      setAllSkus(flattened);
    }
  };

  const updateLineTotal = (index: number) => {
    const item = lineItems[index];
    const subtotal = item.quantity * item.unit_cost;
    const discount = subtotal * (item.discount_percent / 100);
    const total = subtotal - discount;
    const updated = [...lineItems];
    updated[index].line_total = total;
    setLineItems(updated);
  };

  const handleCategoryChange = (index: number, category: string) => {
    const updated = [...lineItems];
    updated[index].category = category;
    updated[index].sku_variant_id = '';
    updated[index].sku_label = '';
    updated[index].unit_cost = 0;
    updated[index].extra_specs = {};
    setLineItems(updated);
    updateLineTotal(index);
  };

  const handleSkuSelect = (index: number, skuId: string) => {
    const sku = allSkus.find(s => s.id === skuId);
    if (!sku) return;
    const updated = [...lineItems];
    updated[index].sku_variant_id = skuId;
    updated[index].sku_label = sku.label;
    updated[index].unit_cost = sku.unit_cost;
    updated[index].extra_specs = sku.extra;
    setLineItems(updated);
    updateLineTotal(index);
  };

  const handleQuantityChange = (index: number, value: number) => {
    const updated = [...lineItems];
    updated[index].quantity = value;
    setLineItems(updated);
    updateLineTotal(index);
  };

  const handleUnitCostChange = (index: number, value: number) => {
    const updated = [...lineItems];
    updated[index].unit_cost = value;
    setLineItems(updated);
    updateLineTotal(index);
  };

  const handleDiscountChange = (index: number, value: number) => {
    const updated = [...lineItems];
    updated[index].discount_percent = value;
    setLineItems(updated);
    updateLineTotal(index);
  };

  const addLineItem = () => {
    setLineItems([
      ...lineItems,
      { id: crypto.randomUUID(), category: '', sku_variant_id: '', sku_label: '', quantity: 1, unit_cost: 0, discount_percent: 0, line_total: 0, serial_numbers: '', asset_description: '', notes: '', extra_specs: {} }
    ]);
  };

  const removeLineItem = (index: number) => {
    if (lineItems.length === 1) return toast.error('At least one line item required');
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const handleSubmit = async (status: 'draft' | 'ordered') => {
    if (!form.vendor_id) return toast.error('Select vendor');
    if (!form.po_date) return toast.error('Purchase date required');
    if (lineItems.some(item => !item.sku_variant_id || item.quantity <= 0 || item.unit_cost <= 0)) {
      return toast.error('Each line item must have SKU, quantity >0 and unit cost >0');
    }
    setLoading(true);
    let subtotal = 0;
const itemsPayload = lineItems.map(item => {
  const lineTotal = item.quantity * item.unit_cost * (1 - (item.discount_percent || 0) / 100);
  subtotal += lineTotal;
  return {
    sku_variant_id: item.sku_variant_id,
    quantity: item.quantity,
    unit_cost: item.unit_cost,
    discount_percent: item.discount_percent || 0,
    serial_numbers: item.serial_numbers,
    asset_description: item.asset_description,
    notes: item.notes,
    extra_specs: item.extra_specs,   // 👈 add this
  };
});
    let taxAmount = 0, totalCost = subtotal;
    if (form.purchase_type === 'GST') {
      taxAmount = subtotal * (form.tax_percent / 100);
      totalCost = subtotal + taxAmount;
    }
    const payload = {
      header: {
        vendor_id: form.vendor_id,
        po_date: format(form.po_date, 'yyyy-MM-dd'),
        purchased_by_type: form.purchased_by_type,
        purchased_by_other: form.purchased_by_other,
        purchase_type: form.purchase_type,
        tax_percent: form.purchase_type === 'GST' ? form.tax_percent : 0,
        supplier_invoice_number: form.supplier_invoice_number,
        eway_bill_no: form.eway_bill_no,
        has_expense: form.has_expense,
        expense_amount: form.has_expense ? parseFloat(form.expense_amount) : null,
        expense_description: form.has_expense ? form.expense_description : null,
        remarks: form.remarks,
        public_photo_url: form.public_photo_url,
        status,
        subtotal,
        tax_amount: taxAmount,
        total_cost: totalCost,
      },
      items: itemsPayload,
    };
    const res = await fetch('/api/purchase-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      toast.success(`PO ${status === 'draft' ? 'saved as draft' : 'ordered'}`);
      if (onSuccess) onSuccess();
      // Reset form (optional)
    } else {
      const err = await res.json();
      toast.error(err.error || 'Failed to create PO');
    }
    setLoading(false);
  };

  // Totals for display
  const subtotal = lineItems.reduce((sum, item) => sum + (item.quantity * item.unit_cost), 0);
  const discount = lineItems.reduce((sum, item) => sum + (item.quantity * item.unit_cost * (item.discount_percent / 100)), 0);
  const afterDiscount = subtotal - discount;
  const taxAmount = form.purchase_type === 'GST' ? afterDiscount * (form.tax_percent / 100) : 0;
  const total = afterDiscount + taxAmount;

  return (
    <div className="space-y-6 p-4 max-w-5xl mx-auto">
      {/* Basic Info Section */}
      <div className="border rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-3">Basic Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>Entry Date</Label><Input type="date" value={format(new Date(), 'yyyy-MM-dd')} disabled className="bg-gray-100" /></div>
          <div><Label>Purchase Date *</Label><Popover><PopoverTrigger asChild><Button variant="outline" className="w-full justify-start"><CalendarIcon className="mr-2 h-4 w-4" />{form.po_date ? format(form.po_date, 'dd/MM/yyyy') : 'Select date'}</Button></PopoverTrigger><PopoverContent><Calendar mode="single" selected={form.po_date} onSelect={(date) => date && setForm({...form, po_date: date})} /></PopoverContent></Popover></div>
          <div><Label>Purchased By</Label><Select value={form.purchased_by_type} onValueChange={v => setForm({...form, purchased_by_type: v})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Digitalbluez">Digitalbluez</SelectItem><SelectItem value="Techtenth">Techtenth</SelectItem><SelectItem value="Cash">Cash</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent></Select>{form.purchased_by_type === 'Other' && <Input className="mt-2" placeholder="Specify" value={form.purchased_by_other} onChange={e => setForm({...form, purchased_by_other: e.target.value})} />}</div>
          <div><Label>Purchase Type</Label><Select value={form.purchase_type} onValueChange={v => setForm({...form, purchase_type: v})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="GST">GST</SelectItem><SelectItem value="Cash">Cash</SelectItem></SelectContent></Select></div>
          {form.purchase_type === 'GST' && <div><Label>GST (%)</Label><Input type="number" step="0.1" value={form.tax_percent} onChange={e => setForm({...form, tax_percent: parseFloat(e.target.value) || 0})} /></div>}
        </div>
      </div>

      {/* Supplier Section */}
      <div className="border rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-3">Supplier</h2>
        <Select value={form.vendor_id} onValueChange={v => setForm({...form, vendor_id: v})}>
          <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
          <SelectContent>{vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.vendor_code} - {v.company_name}</SelectItem>)}</SelectContent>
        </Select>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
          <div><Label>Supplier Invoice Number</Label><Input value={form.supplier_invoice_number} onChange={e => setForm({...form, supplier_invoice_number: e.target.value})} /></div>
          <div><Label>E-Way Bill No.</Label><Input value={form.eway_bill_no} onChange={e => setForm({...form, eway_bill_no: e.target.value})} /></div>
        </div>
      </div>

      {/* Line Items Section */}
      <div className="border rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-3">Line Items</h2>
        {lineItems.map((item, idx) => (
          <div key={item.id} className="border-b pb-4 mb-4 last:border-0">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div><Label>Category</Label><Select value={item.category} onValueChange={(v) => handleCategoryChange(idx, v)}><SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger><SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
              <div className="lg:col-span-2">
                <Label>SKU *</Label>
                <SearchableSkuSelect
                  value={item.sku_variant_id}
                  onSelect={(skuId: string) => handleSkuSelect(idx, skuId)}
                  onAddNew={() => { setCurrentCategoryForSku(item.category); setShowSkuModal(true); }}
                  skus={allSkus}
                  category={item.category}
                />
              </div>
              <div><Label>Quantity *</Label><Input type="number" min="1" value={item.quantity} onChange={e => handleQuantityChange(idx, parseInt(e.target.value) || 1)} /></div>
              <div><Label>Unit Cost *</Label><Input type="number" step="0.01" value={item.unit_cost} onChange={e => handleUnitCostChange(idx, parseFloat(e.target.value) || 0)} /></div>
              <div><Label>Discount %</Label><Input type="number" step="0.01" value={item.discount_percent} onChange={e => handleDiscountChange(idx, parseFloat(e.target.value) || 0)} /></div>
              <div><Label>Line Total</Label><Input type="text" value={`₹${item.line_total.toFixed(2)}`} disabled className="bg-gray-100" /></div>
              
              {/* Conditional fields based on category */}
              {item.category === 'RAM' && (
                <div className="lg:col-span-2 grid grid-cols-2 gap-2">
                  <div><Label>Speed (MHz)</Label><Input placeholder="e.g., 3200" value={item.extra_specs.speed || ''} onChange={e => { const updated = [...lineItems]; updated[idx].extra_specs.speed = e.target.value; setLineItems(updated); }} /></div>
                  <div><Label>CAS Latency</Label><Input placeholder="e.g., CL16" value={item.extra_specs.cas || ''} onChange={e => { const updated = [...lineItems]; updated[idx].extra_specs.cas = e.target.value; setLineItems(updated); }} /></div>
                  <div><Label>Form Factor</Label><Select value={item.extra_specs.form_factor || ''} onValueChange={v => { const updated = [...lineItems]; updated[idx].extra_specs.form_factor = v; setLineItems(updated); }}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent><SelectItem value="SODIMM">SODIMM (Laptop)</SelectItem><SelectItem value="DIMM">DIMM (Desktop)</SelectItem></SelectContent></Select></div>
                </div>
              )}
              {item.category === 'SSD' && (
                <div className="lg:col-span-2 grid grid-cols-2 gap-2">
                  <div><Label>Interface</Label><Input placeholder="NVMe / SATA" value={item.extra_specs.interface || ''} onChange={e => { const updated = [...lineItems]; updated[idx].extra_specs.interface = e.target.value; setLineItems(updated); }} /></div>
                  <div><Label>Read Speed (MB/s)</Label><Input type="number" placeholder="3500" value={item.extra_specs.read_speed || ''} onChange={e => { const updated = [...lineItems]; updated[idx].extra_specs.read_speed = e.target.value; setLineItems(updated); }} /></div>
                </div>
              )}
              {item.category === 'Laptop' && (
                <div className="lg:col-span-2 grid grid-cols-2 gap-2">
                  <div><Label>CPU</Label><Input value={item.extra_specs.cpu || ''} onChange={e => { const updated = [...lineItems]; updated[idx].extra_specs.cpu = e.target.value; setLineItems(updated); }} /></div>
                  <div><Label>Generation</Label><Input value={item.extra_specs.generation || ''} onChange={e => { const updated = [...lineItems]; updated[idx].extra_specs.generation = e.target.value; setLineItems(updated); }} /></div>
                  <div><Label>RAM (GB)</Label><Input type="number" value={item.extra_specs.ram_gb || ''} onChange={e => { const updated = [...lineItems]; updated[idx].extra_specs.ram_gb = e.target.value; setLineItems(updated); }} /></div>
                  <div><Label>SSD (GB)</Label><Input type="number" value={item.extra_specs.ssd_gb || ''} onChange={e => { const updated = [...lineItems]; updated[idx].extra_specs.ssd_gb = e.target.value; setLineItems(updated); }} /></div>
                  <div><Label>Screen Size (in)</Label><Input type="number" step="0.1" value={item.extra_specs.screen_size || ''} onChange={e => { const updated = [...lineItems]; updated[idx].extra_specs.screen_size = e.target.value; setLineItems(updated); }} /></div>
                  <div className="flex gap-2 col-span-2"><label><input type="checkbox" checked={item.extra_specs.charger || false} onChange={e => { const updated = [...lineItems]; updated[idx].extra_specs.charger = e.target.checked; setLineItems(updated); }} /> Charger included</label></div>
                </div>
              )}
              {/* Add more categories as needed */}

              <div className="lg:col-span-2"><Label>Serial Numbers (optional, comma separated)</Label><Input placeholder="SN1, SN2, ..." value={item.serial_numbers} onChange={e => { const updated = [...lineItems]; updated[idx].serial_numbers = e.target.value; setLineItems(updated); }} /></div>
              <div className="lg:col-span-2"><Label>Asset Description</Label><Input value={item.asset_description} onChange={e => { const updated = [...lineItems]; updated[idx].asset_description = e.target.value; setLineItems(updated); }} /></div>
              <div className="lg:col-span-3"><Label>Notes</Label><Input value={item.notes} onChange={e => { const updated = [...lineItems]; updated[idx].notes = e.target.value; setLineItems(updated); }} /></div>
              <div className="flex items-end"><Button variant="destructive" size="sm" onClick={() => removeLineItem(idx)}><Trash2 className="h-4 w-4" /></Button></div>
            </div>
          </div>
        ))}
        <Button variant="outline" onClick={addLineItem}><Plus className="mr-2 h-4 w-4" /> Add Another Item</Button>
      </div>

      {/* Expense Section */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center space-x-2"><input type="checkbox" id="expense" checked={form.has_expense} onChange={e => setForm({...form, has_expense: e.target.checked})} /><Label htmlFor="expense">Extra expense incurred?</Label></div>
        {form.has_expense && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
            <div><Label>Expense Amount</Label><Input type="number" step="0.01" value={form.expense_amount} onChange={e => setForm({...form, expense_amount: e.target.value})} /></div>
            <div><Label>Expense Description</Label><Input value={form.expense_description} onChange={e => setForm({...form, expense_description: e.target.value})} /></div>
          </div>
        )}
      </div>

      {/* Totals Section */}
      <div className="border rounded-lg p-4 bg-gray-50">
        <h2 className="text-lg font-semibold mb-3">Totals</h2>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span>Subtotal:</span><span>₹{subtotal.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>Discount:</span><span>₹{discount.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>After Discount:</span><span>₹{afterDiscount.toFixed(2)}</span></div>
          {form.purchase_type === 'GST' && <div className="flex justify-between"><span>GST ({form.tax_percent}%):</span><span>₹{taxAmount.toFixed(2)}</span></div>}
          <div className="flex justify-between font-semibold text-base pt-2 border-t"><span>PO Total:</span><span>₹{total.toFixed(2)}</span></div>
        </div>
      </div>

      {/* Remarks & Photo */}
      <div className="border rounded-lg p-4">
        <div><Label>Remarks</Label><textarea className="w-full border rounded p-2" rows={2} value={form.remarks} onChange={e => setForm({...form, remarks: e.target.value})} /></div>
        <div className="mt-3"><Label>Public Photo URL</Label><Input type="url" value={form.public_photo_url} onChange={e => setForm({...form, public_photo_url: e.target.value})} placeholder="https://..." /></div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" disabled={loading} onClick={() => handleSubmit('draft')}>Save Draft</Button>
        <Button variant="default" disabled={loading} onClick={() => handleSubmit('ordered')}>Place Order</Button>
      </div>

      {/* SKU Creation Modal */}
      <AddSkuModal open={showSkuModal} onClose={() => setShowSkuModal(false)} onCreated={fetchSkus} preselectedCategory={currentCategoryForSku} />
    </div>
  );
}
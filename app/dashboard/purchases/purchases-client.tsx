'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue
} from '@/components/ui/select'
import { Plus, Search, Eye, Loader2, Layers } from 'lucide-react'

type Purchase = {
  id: string
  purchase_date: string
  purchase_month: string
  purchase_year: number
  vendor_name: string
  asset_number: string
  sku: string
  type: string
  category: string
  brand: string
  asset_description: string
  serial_number: string
  base_price: number
  gst: number
  total_price: number
  stock_status: string
  purchased_by: string
  purchase_type: string
  selling_price: number
  ram: string
  ram_custom: string
  ssd: string
  ssd_custom: string
  hdd: string
  hdd_custom: string
  cpu: string
  cpu_custom: string
  generation: string
  accessory_type: string
  accessory_type_custom: string
  remarks: string
  created_at: string
}

type Vendor = { id: string; company_name: string }

const MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December']

const BRANDS = ['Dell','HP','Lenovo','Apple','Asus','Acer','Microsoft','Toshiba','Samsung','Other']
const BASE_TYPES = ['Laptop','Desktop','Accessories']
const CATEGORIES = ['New','Preowned']

const RAM_OPTIONS = ['NA','4GB','8GB','16GB','32GB','64GB','Others']
const SSD_OPTIONS = ['NA','128GB','256GB','512GB','1TB','2TB','Others']
const HDD_OPTIONS = ['NA','128GB','250GB','320GB','500GB','512GB','1TB','2TB','Others']
const CPU_OPTIONS = ['NA','i3','i5','i7','i9','M1','M2','M3','M4','M5','Others']
const BASE_ACCESSORY_TYPES = [
  'Keyboard','Mouse','Battery','Body','Cable','RAM','SSD','CPU',
  'Casing','Display','Speaker','Hinges','CCTV','Connector',
  'HDD','LAN','Switches','Wifi Dongle','Bag','UPS'
]

const emptyForm = {
  purchase_date: '', purchase_month: '',
  purchase_year: new Date().getFullYear(),
  vendor_name: '', asset_number: '', sku: '',
  type: '', category: '', brand: '',
  asset_description: '', serial_number: '',
  base_price: '', gst: '', total_price: '',
  stock_status: '', purchased_by: '', purchase_type: '',
  selling_price: '', ram: '', ram_custom: '',
  ssd: '', ssd_custom: '', hdd: '', hdd_custom: '',
  cpu: '', cpu_custom: '', generation: '',
  accessory_type: '', accessory_type_custom: '',
  remarks: '',
}

const emptyBulkRow = {
  serial_number: '', ram: '', ram_custom: '',
  ssd: '', ssd_custom: '', cpu: '', cpu_custom: '',
  generation: '', asset_description: '',
}

// Reusable smart select with "Add New" option
function SmartSelect({
  label, value, options, baseOptions = [],
  onSelect, customValue, onCustomChange, addLabel = 'type',
  onAddNew,
}: {
  label: string
  value: string
  options: string[]
  baseOptions?: string[]
  onSelect: (v: string) => void
  customValue?: string
  onCustomChange?: (v: string) => void
  addLabel?: string
  onAddNew?: (v: string) => Promise<boolean>
}) {
  const [addingNew, setAddingNew] = useState(false)
  const [newVal, setNewVal] = useState('')
  const allOptions = [...baseOptions, ...options]

  const handleAddNew = async () => {
    if (!newVal.trim()) return
    if (onAddNew) {
      const ok = await onAddNew(newVal.trim())
      if (ok) {
        onSelect(newVal.trim())
        setNewVal('')
        setAddingNew(false)
      }
    }
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={(v) => {
        if (v === '__add_new__') { setAddingNew(true); return }
        onSelect(v)
      }}>
        <SelectTrigger>
          <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {allOptions.map(o => (
            <SelectItem key={o} value={o}>{o}</SelectItem>
          ))}
          {onAddNew && (
            <SelectItem value="__add_new__">
              <span className="text-blue-600 font-medium">+ Add New {addLabel}</span>
            </SelectItem>
          )}
        </SelectContent>
      </Select>

      {addingNew && (
        <div className="flex gap-2 mt-1">
          <Input
            placeholder={`New ${addLabel}`}
            value={newVal}
            onChange={(e) => setNewVal(e.target.value)}
          />
          <Button size="sm" onClick={handleAddNew}>Add</Button>
          <Button size="sm" variant="outline" onClick={() => setAddingNew(false)}>Cancel</Button>
        </div>
      )}

      {(value === 'Others' || value === 'Other') && onCustomChange && (
        <Input
          placeholder={`Enter custom ${label.toLowerCase()}`}
          value={customValue || ''}
          onChange={(e) => onCustomChange(e.target.value)}
        />
      )}
    </div>
  )
}

export default function PurchasesClient({
  initialData, vendors, customTypes, customAccessoryTypes,
}: {
  initialData: Purchase[]
  vendors: Vendor[]
  customTypes: string[]
  customAccessoryTypes: string[]
}) {
  const [purchases, setPurchases] = useState<Purchase[]>(initialData)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [viewItem, setViewItem] = useState<Purchase | null>(null)
  const [form, setForm] = useState<any>(emptyForm)
  const [bulkRows, setBulkRows] = useState([{ ...emptyBulkRow }])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [extraTypes, setExtraTypes] = useState<string[]>(customTypes)
  const [extraAccTypes, setExtraAccTypes] = useState<string[]>(customAccessoryTypes)
  const supabase = createClient()

  // Auto-generate asset number
  const generateAssetNumber = async () => {
    const { data } = await supabase.rpc('get_next_asset_number')
    return data as string
  }

  const handleDateChange = (value: string) => {
    const date = new Date(value)
    setForm({ ...form, purchase_date: value,
      purchase_month: MONTHS[date.getMonth()],
      purchase_year: date.getFullYear() })
  }

  const handlePriceChange = (field: string, value: string) => {
    const updated = { ...form, [field]: value }
    const base = parseFloat(field === 'base_price' ? value : form.base_price) || 0
    const gst = parseFloat(field === 'gst' ? value : form.gst) || 0
    updated.total_price = (base + gst).toFixed(2)
    setForm(updated)
  }

  const handleOpenForm = async () => {
    const assetNo = await generateAssetNumber()
    setForm({ ...emptyForm, asset_number: assetNo })
    setShowForm(true)
  }

  const handleOpenBulk = async () => {
    const assetNo = await generateAssetNumber()
    setForm({ ...emptyForm, asset_number: assetNo })
    setBulkRows([{ ...emptyBulkRow }])
    setShowBulk(true)
  }

  const addBulkRow = () => setBulkRows([...bulkRows, { ...emptyBulkRow }])

  const updateBulkRow = (index: number, field: string, value: string) => {
    const updated = [...bulkRows]
    updated[index] = { ...updated[index], [field]: value }
    setBulkRows(updated)
  }

  const handleSubmit = async () => {
    setError('')
    if (!form.purchase_date || !form.vendor_name || !form.type) {
      setError('Purchase Date, Vendor and Type are required.')
      return
    }
    setLoading(true)

    const payload = {
      ...form,
      base_price: parseFloat(form.base_price) || 0,
      gst: form.purchase_type === 'Cash' ? 0 : parseFloat(form.gst) || 0,
      total_price: form.purchase_type === 'Cash'
        ? parseFloat(form.base_price) || 0
        : parseFloat(form.total_price) || 0,
      selling_price: parseFloat(form.selling_price) || 0,
      purchase_year: Number(form.purchase_year),
    }

    const { data, error: err } = await supabase
      .from('purchases').insert([payload]).select().single()

    if (err) { setError(err.message); setLoading(false); return }
    setPurchases([data, ...purchases])
    setForm(emptyForm)
    setShowForm(false)
    setLoading(false)
  }

  const handleBulkSubmit = async () => {
    setError('')
    if (!form.purchase_date || !form.vendor_name || !form.sku) {
      setError('Purchase Date, Vendor and SKU are required for bulk entry.')
      return
    }
    setLoading(true)

    const rows = await Promise.all(bulkRows.map(async (row) => {
      const assetNo = await generateAssetNumber()
      return {
        ...form,
        asset_number: assetNo,
        serial_number: row.serial_number,
        ram: row.ram, ram_custom: row.ram_custom,
        ssd: row.ssd, ssd_custom: row.ssd_custom,
        cpu: row.cpu, cpu_custom: row.cpu_custom,
        generation: row.generation,
        asset_description: row.asset_description || form.asset_description,
        base_price: parseFloat(form.base_price) || 0,
        gst: form.purchase_type === 'Cash' ? 0 : parseFloat(form.gst) || 0,
        total_price: form.purchase_type === 'Cash'
          ? parseFloat(form.base_price) || 0
          : parseFloat(form.total_price) || 0,
        selling_price: parseFloat(form.selling_price) || 0,
        purchase_year: Number(form.purchase_year),
      }
    }))

    const { data, error: err } = await supabase
      .from('purchases').insert(rows).select()

    if (err) { setError(err.message); setLoading(false); return }
    setPurchases([...(data || []), ...purchases])
    setShowBulk(false)
    setLoading(false)
  }

  const addCustomType = async (value: string) => {
    const { error } = await supabase
      .from('custom_options').insert([{ category: 'type', value }])
    if (!error) { setExtraTypes(p => [...p, value]); return true }
    return false
  }

  const addCustomAccType = async (value: string) => {
    const { error } = await supabase
      .from('custom_options').insert([{ category: 'accessory_type', value }])
    if (!error) { setExtraAccTypes(p => [...p, value]); return true }
    return false
  }

  const filtered = purchases.filter(p =>
    p.asset_number?.toLowerCase().includes(search.toLowerCase()) ||
    p.brand?.toLowerCase().includes(search.toLowerCase()) ||
    p.vendor_name?.toLowerCase().includes(search.toLowerCase()) ||
    p.serial_number?.toLowerCase().includes(search.toLowerCase()) ||
    p.type?.toLowerCase().includes(search.toLowerCase())
  )

  const isLaptopOrDesktop = ['Laptop', 'Desktop', ...extraTypes.filter(t =>
    !BASE_ACCESSORY_TYPES.includes(t))].includes(form.type)
  const isAccessory = form.type === 'Accessories'

  const FormSection = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">

      {/* Date */}
      <div className="space-y-2">
        <Label>Purchase Date *</Label>
        <Input type="date" value={form.purchase_date}
          onChange={(e) => handleDateChange(e.target.value)} />
      </div>

      {/* Month auto */}
      <div className="space-y-2">
        <Label>Month</Label>
        <Input value={form.purchase_month} readOnly className="bg-gray-50" />
      </div>

      {/* Asset Number */}
      <div className="space-y-2">
        <Label>Asset Number (auto-generated)</Label>
        <Input value={form.asset_number} readOnly className="bg-gray-50 font-mono font-medium" />
      </div>

      {/* SKU */}
      <div className="space-y-2">
        <Label>SKU</Label>
        <Input placeholder="e.g. DELL-LAT-5520"
          value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
      </div>

      {/* Vendor */}
      <div className="space-y-2">
        <Label>Vendor *</Label>
        <Select value={form.vendor_name} onValueChange={(v) => setForm({ ...form, vendor_name: v })}>
          <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
          <SelectContent>
            {vendors.map(v => (
              <SelectItem key={v.id} value={v.company_name}>{v.company_name}</SelectItem>
            ))}
            <SelectItem value="__goto_vendor__">
              <span className="text-blue-600 font-medium">+ Add New Vendor</span>
            </SelectItem>
          </SelectContent>
        </Select>
        {form.vendor_name === '__goto_vendor__' && (
          <p className="text-xs text-blue-600">
            Go to Vendors tab to add a new vendor, then come back here.
          </p>
        )}
      </div>

      {/* Category */}
      <div className="space-y-2">
        <Label>Category</Label>
        <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
          <SelectTrigger><SelectValue placeholder="New or Preowned" /></SelectTrigger>
          <SelectContent>
            {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Type */}
      <div className="space-y-2">
        <SmartSelect
          label="Type *"
          value={form.type}
          baseOptions={BASE_TYPES}
          options={extraTypes}
          onSelect={(v) => setForm({ ...form, type: v })}
          addLabel="type"
          onAddNew={addCustomType}
        />
      </div>

      {/* Brand */}
      <div className="space-y-2">
        <Label>Brand</Label>
        <Select value={form.brand} onValueChange={(v) => setForm({ ...form, brand: v })}>
          <SelectTrigger><SelectValue placeholder="Select brand" /></SelectTrigger>
          <SelectContent>
            {BRANDS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Laptop/Desktop specific fields */}
      {isLaptopOrDesktop && (
        <>
          <SmartSelect label="CPU" value={form.cpu}
            baseOptions={CPU_OPTIONS} options={[]}
            onSelect={(v) => setForm({ ...form, cpu: v })}
            customValue={form.cpu_custom}
            onCustomChange={(v) => setForm({ ...form, cpu_custom: v })} />

          <div className="space-y-2">
            <Label>Generation</Label>
            <Input placeholder="e.g. 11th Gen, 13th Gen"
              value={form.generation}
              onChange={(e) => setForm({ ...form, generation: e.target.value })} />
          </div>

          <SmartSelect label="RAM" value={form.ram}
            baseOptions={RAM_OPTIONS} options={[]}
            onSelect={(v) => setForm({ ...form, ram: v })}
            customValue={form.ram_custom}
            onCustomChange={(v) => setForm({ ...form, ram_custom: v })} />

          <SmartSelect label="SSD" value={form.ssd}
            baseOptions={SSD_OPTIONS} options={[]}
            onSelect={(v) => setForm({ ...form, ssd: v })}
            customValue={form.ssd_custom}
            onCustomChange={(v) => setForm({ ...form, ssd_custom: v })} />

          <SmartSelect label="HDD" value={form.hdd}
            baseOptions={HDD_OPTIONS} options={[]}
            onSelect={(v) => setForm({ ...form, hdd: v })}
            customValue={form.hdd_custom}
            onCustomChange={(v) => setForm({ ...form, hdd_custom: v })} />
        </>
      )}

      {/* Accessory specific fields */}
      {isAccessory && (
        <SmartSelect label="Accessory Type" value={form.accessory_type}
          baseOptions={BASE_ACCESSORY_TYPES} options={extraAccTypes}
          onSelect={(v) => setForm({ ...form, accessory_type: v })}
          customValue={form.accessory_type_custom}
          onCustomChange={(v) => setForm({ ...form, accessory_type_custom: v })}
          addLabel="accessory type"
          onAddNew={addCustomAccType} />
      )}

      {/* Asset Description */}
      <div className="space-y-2 md:col-span-2">
        <Label>Asset Description</Label>
        <Input placeholder="e.g. Dell Latitude 5520 i5 11th Gen 8GB 256GB SSD"
          value={form.asset_description}
          onChange={(e) => setForm({ ...form, asset_description: e.target.value })} />
      </div>

      {/* Serial Number */}
      <div className="space-y-2">
        <Label>Serial Number</Label>
        <Input placeholder="Enter serial number"
          value={form.serial_number}
          onChange={(e) => setForm({ ...form, serial_number: e.target.value })} />
      </div>

      {/* Purchase Type */}
      <div className="space-y-2">
        <Label>Purchase Type</Label>
        <Select value={form.purchase_type}
          onValueChange={(v) => setForm({ ...form, purchase_type: v })}>
          <SelectTrigger><SelectValue placeholder="Cash or GST" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Cash">Cash</SelectItem>
            <SelectItem value="GST">GST</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Base Price */}
      <div className="space-y-2">
        <Label>Base Price (₹)</Label>
        <Input type="number" placeholder="0.00"
          value={form.base_price}
          onChange={(e) => handlePriceChange('base_price', e.target.value)} />
      </div>

      {/* GST — only shown if purchase type is GST */}
      {form.purchase_type === 'GST' && (
        <div className="space-y-2">
          <Label>GST (₹)</Label>
          <Input type="number" placeholder="0.00"
            value={form.gst}
            onChange={(e) => handlePriceChange('gst', e.target.value)} />
        </div>
      )}

      {/* Total */}
      <div className="space-y-2">
        <Label>Total Price (₹)</Label>
        <Input value={form.purchase_type === 'Cash' ? form.base_price : form.total_price}
          readOnly className="bg-gray-50 font-medium" />
      </div>

      {/* Selling Price */}
      <div className="space-y-2">
        <Label>Selling Price (₹)</Label>
        <Input type="number" placeholder="0.00"
          value={form.selling_price}
          onChange={(e) => setForm({ ...form, selling_price: e.target.value })} />
      </div>

      {/* Stock Status */}
      <div className="space-y-2">
        <Label>Stock Status</Label>
        <Select value={form.stock_status}
          onValueChange={(v) => setForm({ ...form, stock_status: v })}>
          <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="In Stock">In Stock</SelectItem>
            <SelectItem value="Ready for Sale">Ready for Sale</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Purchased By */}
      <div className="space-y-2">
        <Label>Purchased By</Label>
        <Input placeholder="Your name"
          value={form.purchased_by}
          onChange={(e) => setForm({ ...form, purchased_by: e.target.value })} />
      </div>

      {/* Remarks */}
      <div className="space-y-2 md:col-span-2">
        <Label>Remarks</Label>
        <Input placeholder="Any additional notes"
          value={form.remarks}
          onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
      </div>

    </div>
  )

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Purchase IN</h1>
          <p className="text-sm text-gray-500 mt-1">{purchases.length} total purchases</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleOpenBulk}>
            <Layers className="h-4 w-4 mr-2" />Bulk Add
          </Button>
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleOpenForm}>
            <Plus className="h-4 w-4 mr-2" />Add Purchase
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input placeholder="Search by asset, brand, vendor, serial, type..."
          className="pl-9" value={search}
          onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Asset No.</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Brand</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Specs</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Vendor</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Cost</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Sell Price</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-12 text-gray-400">
                      No purchases found. Click "Add Purchase" to get started.
                    </td>
                  </tr>
                ) : filtered.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600">{p.purchase_date}</td>
                    <td className="px-4 py-3 font-medium text-blue-600 font-mono">{p.asset_number}</td>
                    <td className="px-4 py-3">
                      <Badge className="bg-gray-100 text-gray-700 hover:bg-gray-100">{p.type}</Badge>
                    </td>
                    <td className="px-4 py-3">{p.brand}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {p.cpu && `${p.cpu} `}
                      {p.ram && `${p.ram} `}
                      {p.ssd && `${p.ssd}`}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{p.vendor_name}</td>
                    <td className="px-4 py-3 font-medium">₹{p.total_price?.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 text-green-600 font-medium">₹{p.selling_price?.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3">
                      <Badge className={p.stock_status === 'Ready for Sale'
                        ? 'bg-green-100 text-green-700 hover:bg-green-100'
                        : 'bg-orange-100 text-orange-700 hover:bg-orange-100'}>
                        {p.stock_status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Button variant="ghost" size="sm" onClick={() => setViewItem(p)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Single Add Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Purchase</DialogTitle>
          </DialogHeader>
          <FormSection />
          {error && (
            <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg mt-2">{error}</div>
          )}
          <div className="flex gap-3 mt-4">
            <Button className="flex-1 bg-blue-600 hover:bg-blue-700"
              onClick={handleSubmit} disabled={loading}>
              {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : 'Save Purchase'}
            </Button>
            <Button variant="outline" onClick={() => { setShowForm(false); setError('') }}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Add Dialog */}
      <Dialog open={showBulk} onOpenChange={setShowBulk}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bulk Purchase Entry — Same SKU, Multiple Units</DialogTitle>
          </DialogHeader>

          {/* Common fields */}
          <div className="bg-blue-50 rounded-xl p-4 mb-4">
            <p className="text-xs font-medium text-blue-700 mb-3 uppercase tracking-wide">
              Common Details (applies to all units)
            </p>
            <FormSection />
          </div>

          {/* Per-unit rows */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-gray-700">
                Individual Units ({bulkRows.length})
              </p>
              <Button size="sm" variant="outline" onClick={addBulkRow}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Row
              </Button>
            </div>

            <div className="space-y-3">
              {bulkRows.map((row, i) => (
                <div key={i} className="border border-gray-200 rounded-xl p-4">
                  <p className="text-xs font-medium text-gray-500 mb-3">Unit {i + 1}</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Serial Number</Label>
                      <Input placeholder="Serial no."
                        value={row.serial_number}
                        onChange={(e) => updateBulkRow(i, 'serial_number', e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">CPU</Label>
                      <Select value={row.cpu}
                        onValueChange={(v) => updateBulkRow(i, 'cpu', v)}>
                        <SelectTrigger><SelectValue placeholder="CPU" /></SelectTrigger>
                        <SelectContent>
                          {CPU_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Generation</Label>
                      <Input placeholder="e.g. 11th Gen"
                        value={row.generation}
                        onChange={(e) => updateBulkRow(i, 'generation', e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">RAM</Label>
                      <Select value={row.ram}
                        onValueChange={(v) => updateBulkRow(i, 'ram', v)}>
                        <SelectTrigger><SelectValue placeholder="RAM" /></SelectTrigger>
                        <SelectContent>
                          {RAM_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">SSD</Label>
                      <Select value={row.ssd}
                        onValueChange={(v) => updateBulkRow(i, 'ssd', v)}>
                        <SelectTrigger><SelectValue placeholder="SSD" /></SelectTrigger>
                        <SelectContent>
                          {SSD_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Description (optional override)</Label>
                      <Input placeholder="Override description"
                        value={row.asset_description}
                        onChange={(e) => updateBulkRow(i, 'asset_description', e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg mt-2">{error}</div>
          )}
          <div className="flex gap-3 mt-4">
            <Button className="flex-1 bg-blue-600 hover:bg-blue-700"
              onClick={handleBulkSubmit} disabled={loading}>
              {loading
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving {bulkRows.length} units...</>
                : `Save ${bulkRows.length} Unit${bulkRows.length > 1 ? 's' : ''}`}
            </Button>
            <Button variant="outline" onClick={() => { setShowBulk(false); setError('') }}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Detail Dialog */}
      <Dialog open={!!viewItem} onOpenChange={() => setViewItem(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Purchase Detail — {viewItem?.asset_number}</DialogTitle>
          </DialogHeader>
          {viewItem && (
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 mt-2 text-sm">
              {[
                ['Asset Number', viewItem.asset_number],
                ['Purchase Date', viewItem.purchase_date],
                ['Month / Year', `${viewItem.purchase_month} ${viewItem.purchase_year}`],
                ['Vendor', viewItem.vendor_name],
                ['Category', viewItem.category],
                ['Type', viewItem.type],
                ['Brand', viewItem.brand],
                ['SKU', viewItem.sku],
                ['Serial Number', viewItem.serial_number],
                ['Description', viewItem.asset_description],
                ...(viewItem.type === 'Laptop' || viewItem.type === 'Desktop' ? [
                  ['CPU', viewItem.cpu === 'Others' ? viewItem.cpu_custom : viewItem.cpu],
                  ['Generation', viewItem.generation],
                  ['RAM', viewItem.ram === 'Others' ? viewItem.ram_custom : viewItem.ram],
                  ['SSD', viewItem.ssd === 'Others' ? viewItem.ssd_custom : viewItem.ssd],
                  ['HDD', viewItem.hdd === 'Others' ? viewItem.hdd_custom : viewItem.hdd],
                ] : []),
                ...(viewItem.type === 'Accessories' ? [
                  ['Accessory Type', viewItem.accessory_type === 'Others'
                    ? viewItem.accessory_type_custom : viewItem.accessory_type],
                ] : []),
                ['Purchase Type', viewItem.purchase_type],
                ['Base Price', `₹${viewItem.base_price?.toLocaleString('en-IN')}`],
                ...(viewItem.purchase_type === 'GST' ? [
                  ['GST', `₹${viewItem.gst?.toLocaleString('en-IN')}`],
                ] : []),
                ['Total Price', `₹${viewItem.total_price?.toLocaleString('en-IN')}`],
                ['Selling Price', `₹${viewItem.selling_price?.toLocaleString('en-IN')}`],
                ['Stock Status', viewItem.stock_status],
                ['Purchased By', viewItem.purchased_by],
                ['Remarks', viewItem.remarks],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <p className="text-gray-400 text-xs">{label}</p>
                  <p className="font-medium text-gray-900 mt-0.5">{value || '—'}</p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  )
}
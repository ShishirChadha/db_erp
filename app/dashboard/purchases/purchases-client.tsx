'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Search, Eye, Loader2, X } from 'lucide-react'

type Purchase = {
  id: string
  purchase_date: string
  purchase_month: string
  purchase_year: number
  vendor_name: string
  asset_number: string
  sku: string
  type: string
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
  created_at: string
}

const emptyForm = {
  purchase_date: '',
  purchase_month: '',
  purchase_year: new Date().getFullYear(),
  vendor_name: '',
  asset_number: '',
  sku: '',
  type: '',
  brand: '',
  asset_description: '',
  serial_number: '',
  base_price: '',
  gst: '',
  total_price: '',
  stock_status: '',
  purchased_by: '',
  purchase_type: '',
  selling_price: '',
}

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
]

const BRANDS = ['Dell','HP','Lenovo','Apple','Asus','Acer','Microsoft','Toshiba','Samsung','Other']
const TYPES = ['Laptop','Ultrabook','MacBook','Chromebook','Workstation','Other']

export default function PurchasesClient({ initialData }: { initialData: Purchase[] }) {
  const [purchases, setPurchases] = useState<Purchase[]>(initialData)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [viewItem, setViewItem] = useState<Purchase | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  // Auto calculate total when base price or gst changes
  const handlePriceChange = (field: string, value: string) => {
    const updated = { ...form, [field]: value }
    const base = parseFloat(field === 'base_price' ? value : form.base_price) || 0
    const gst = parseFloat(field === 'gst' ? value : form.gst) || 0
    updated.total_price = (base + gst).toFixed(2)
    setForm(updated)
  }

  // Auto fill month and year when date is selected
  const handleDateChange = (value: string) => {
    const date = new Date(value)
    setForm({
      ...form,
      purchase_date: value,
      purchase_month: MONTHS[date.getMonth()],
      purchase_year: date.getFullYear(),
    })
  }

  const handleSubmit = async () => {
    setError('')
    if (!form.purchase_date || !form.asset_number || !form.vendor_name) {
      setError('Purchase Date, Asset Number and Vendor Name are required.')
      return
    }
    setLoading(true)

    const { data, error: err } = await supabase
      .from('purchases')
      .insert([{
        ...form,
        base_price: parseFloat(form.base_price as string) || 0,
        gst: parseFloat(form.gst as string) || 0,
        total_price: parseFloat(form.total_price as string) || 0,
        selling_price: parseFloat(form.selling_price as string) || 0,
        purchase_year: Number(form.purchase_year),
      }])
      .select()
      .single()

    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    setPurchases([data, ...purchases])
    setForm(emptyForm)
    setShowForm(false)
    setLoading(false)
  }

  const filtered = purchases.filter(p =>
    p.asset_number?.toLowerCase().includes(search.toLowerCase()) ||
    p.brand?.toLowerCase().includes(search.toLowerCase()) ||
    p.vendor_name?.toLowerCase().includes(search.toLowerCase()) ||
    p.serial_number?.toLowerCase().includes(search.toLowerCase()) ||
    p.stock_status?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Purchase IN</h1>
          <p className="text-sm text-gray-500 mt-1">{purchases.length} total purchases</p>
        </div>
        <Button
          className="bg-blue-600 hover:bg-blue-700"
          onClick={() => setShowForm(true)}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Purchase
        </Button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Search by asset number, brand, vendor, serial..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Brand</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Description</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Vendor</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Total Price</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Selling Price</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-gray-400">
                      No purchases found. Click "Add Purchase" to get started.
                    </td>
                  </tr>
                ) : (
                  filtered.map((p) => (
                    <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-600">{p.purchase_date}</td>
                      <td className="px-4 py-3 font-medium text-blue-600">{p.asset_number}</td>
                      <td className="px-4 py-3">{p.brand}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate">{p.asset_description}</td>
                      <td className="px-4 py-3 text-gray-600">{p.vendor_name}</td>
                      <td className="px-4 py-3 font-medium">₹{p.total_price?.toLocaleString('en-IN')}</td>
                      <td className="px-4 py-3 font-medium text-green-600">₹{p.selling_price?.toLocaleString('en-IN')}</td>
                      <td className="px-4 py-3">
                        <Badge
                          className={
                            p.stock_status === 'Ready for Sale'
                              ? 'bg-green-100 text-green-700 hover:bg-green-100'
                              : 'bg-orange-100 text-orange-700 hover:bg-orange-100'
                          }
                        >
                          {p.stock_status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setViewItem(p)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Add Purchase Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Purchase</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">

            {/* Purchase Date */}
            <div className="space-y-2">
              <Label>Purchase Date *</Label>
              <Input
                type="date"
                value={form.purchase_date}
                onChange={(e) => handleDateChange(e.target.value)}
              />
            </div>

            {/* Month - auto filled */}
            <div className="space-y-2">
              <Label>Month</Label>
              <Input value={form.purchase_month} readOnly className="bg-gray-50" />
            </div>

            {/* Vendor Name */}
            <div className="space-y-2">
              <Label>Vendor Name *</Label>
              <Input
                placeholder="Enter vendor name"
                value={form.vendor_name}
                onChange={(e) => setForm({ ...form, vendor_name: e.target.value })}
              />
            </div>

            {/* Asset Number */}
            <div className="space-y-2">
              <Label>Asset Number *</Label>
              <Input
                placeholder="e.g. DB-2024-001"
                value={form.asset_number}
                onChange={(e) => setForm({ ...form, asset_number: e.target.value })}
              />
            </div>

            {/* SKU */}
            <div className="space-y-2">
              <Label>SKU</Label>
              <Input
                placeholder="e.g. DELL-LAT-5520"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />
            </div>

            {/* Type */}
            <div className="space-y-2">
              <Label>Type</Label>
              <Select onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Brand */}
            <div className="space-y-2">
              <Label>Brand</Label>
              <Select onValueChange={(v) => setForm({ ...form, brand: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select brand" />
                </SelectTrigger>
                <SelectContent>
                  {BRANDS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Serial Number */}
            <div className="space-y-2">
              <Label>Serial Number</Label>
              <Input
                placeholder="Enter serial number"
                value={form.serial_number}
                onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
              />
            </div>

            {/* Asset Description - full width */}
            <div className="space-y-2 md:col-span-2">
              <Label>Asset Description</Label>
              <Input
                placeholder="e.g. Dell Latitude 5520 i5 11th Gen 8GB 256GB SSD"
                value={form.asset_description}
                onChange={(e) => setForm({ ...form, asset_description: e.target.value })}
              />
            </div>

            {/* Base Price */}
            <div className="space-y-2">
              <Label>Base Price (₹)</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={form.base_price}
                onChange={(e) => handlePriceChange('base_price', e.target.value)}
              />
            </div>

            {/* GST */}
            <div className="space-y-2">
              <Label>GST (₹)</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={form.gst}
                onChange={(e) => handlePriceChange('gst', e.target.value)}
              />
            </div>

            {/* Total Price - auto calculated */}
            <div className="space-y-2">
              <Label>Total Price (₹) — auto calculated</Label>
              <Input
                value={form.total_price}
                readOnly
                className="bg-gray-50 font-medium"
              />
            </div>

            {/* Selling Price */}
            <div className="space-y-2">
              <Label>Selling Price (₹)</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={form.selling_price}
                onChange={(e) => setForm({ ...form, selling_price: e.target.value })}
              />
            </div>

            {/* Stock Status */}
            <div className="space-y-2">
              <Label>Stock Status</Label>
              <Select onValueChange={(v) => setForm({ ...form, stock_status: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="In Stock">In Stock</SelectItem>
                  <SelectItem value="Ready for Sale">Ready for Sale</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Purchase Type */}
            <div className="space-y-2">
              <Label>Purchase Type</Label>
              <Select onValueChange={(v) => setForm({ ...form, purchase_type: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Cash or GST" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="GST">GST</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Purchased By */}
            <div className="space-y-2 md:col-span-2">
              <Label>Purchased By</Label>
              <Input
                placeholder="Enter name"
                value={form.purchased_by}
                onChange={(e) => setForm({ ...form, purchased_by: e.target.value })}
              />
            </div>

          </div>

          {error && (
            <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg mt-2">
              {error}
            </div>
          )}

          <div className="flex gap-3 mt-4">
            <Button
              className="flex-1 bg-blue-600 hover:bg-blue-700"
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
              ) : (
                'Save Purchase'
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => { setShowForm(false); setError('') }}
            >
              Cancel
            </Button>
          </div>

        </DialogContent>
      </Dialog>

      {/* View Purchase Detail Dialog */}
      <Dialog open={!!viewItem} onOpenChange={() => setViewItem(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Purchase Detail — {viewItem?.asset_number}</DialogTitle>
          </DialogHeader>

          {viewItem && (
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 mt-2 text-sm">
              {[
                ['Purchase Date', viewItem.purchase_date],
                ['Month / Year', `${viewItem.purchase_month} ${viewItem.purchase_year}`],
                ['Vendor Name', viewItem.vendor_name],
                ['Asset Number', viewItem.asset_number],
                ['SKU', viewItem.sku],
                ['Type', viewItem.type],
                ['Brand', viewItem.brand],
                ['Serial Number', viewItem.serial_number],
                ['Asset Description', viewItem.asset_description],
                ['Base Price', `₹${viewItem.base_price?.toLocaleString('en-IN')}`],
                ['GST', `₹${viewItem.gst?.toLocaleString('en-IN')}`],
                ['Total Price', `₹${viewItem.total_price?.toLocaleString('en-IN')}`],
                ['Selling Price', `₹${viewItem.selling_price?.toLocaleString('en-IN')}`],
                ['Purchase Type', viewItem.purchase_type],
                ['Purchased By', viewItem.purchased_by],
                ['Stock Status', viewItem.stock_status],
              ].map(([label, value]) => (
                <div key={label}>
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
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
import { Plus, Search, Eye, Loader2, ShoppingBag } from 'lucide-react'

type Sale = {
  id: string
  sale_date: string
  sale_month: string
  sale_year: number
  invoice_number: string
  customer_name: string
  pmt: string
  asset_number: string
  sku: string
  type: string
  brand: string
  asset_description: string
  serial_number: string
  sale_base_price: number
  sale_gst: number
  sale_total: number
  sale_type: string
  created_at: string
}

type Purchase = {
  asset_number: string
  brand: string
  asset_description: string
  serial_number: string
  sku: string
  type: string
  base_price: number
  gst: number
  total_price: number
  selling_price: number
  vendor_name: string
  purchase_date: string
}

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
]

const PMT_TYPES = ['Cash','UPI','Bank Transfer','Cheque','Card','Other']

const emptyForm = {
  sale_date: '',
  sale_month: '',
  sale_year: new Date().getFullYear(),
  invoice_number: '',
  customer_name: '',
  pmt: '',
  asset_number: '',
  sku: '',
  type: '',
  brand: '',
  asset_description: '',
  serial_number: '',
  sale_base_price: '',
  sale_gst: '',
  sale_total: '',
  sale_type: '',
}

export default function SalesClient({
  initialData,
  customers,
  purchases,
}: {
  initialData: Sale[]
  customers: { customer_name: string }[]
  purchases: Purchase[]
}) {
  const [sales, setSales] = useState<Sale[]>(initialData)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [viewItem, setViewItem] = useState<Sale | null>(null)
  const [viewPurchase, setViewPurchase] = useState<Purchase | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  // When asset number is selected, auto-fill asset details
  const handleAssetSelect = (assetNumber: string) => {
    const purchase = purchases.find(p => p.asset_number === assetNumber)
    if (purchase) {
      setForm(prev => ({
        ...prev,
        asset_number: assetNumber,
        brand: purchase.brand || '',
        asset_description: purchase.asset_description || '',
        serial_number: purchase.serial_number || '',
        sku: purchase.sku || '',
        type: purchase.type || '',
        sale_base_price: purchase.selling_price?.toString() || '',
        sale_gst: '',
        sale_total: purchase.selling_price?.toString() || '',
      }))
    }
  }

  // Auto calculate sale total
  const handlePriceChange = (field: string, value: string) => {
    const updated = { ...form, [field]: value }
    const base = parseFloat(field === 'sale_base_price' ? value : form.sale_base_price as string) || 0
    const gst = parseFloat(field === 'sale_gst' ? value : form.sale_gst as string) || 0
    updated.sale_total = (base + gst).toFixed(2)
    setForm(updated)
  }

  // Auto fill month and year
  const handleDateChange = (value: string) => {
    const date = new Date(value)
    setForm({
      ...form,
      sale_date: value,
      sale_month: MONTHS[date.getMonth()],
      sale_year: date.getFullYear(),
    })
  }

  const handleSubmit = async () => {
    setError('')
    if (!form.sale_date || !form.asset_number || !form.customer_name) {
      setError('Sale Date, Asset Number and Customer Name are required.')
      return
    }
    setLoading(true)

    const { data, error: err } = await supabase
      .from('sales')
      .insert([{
        ...form,
        sale_base_price: parseFloat(form.sale_base_price as string) || 0,
        sale_gst: parseFloat(form.sale_gst as string) || 0,
        sale_total: parseFloat(form.sale_total as string) || 0,
        sale_year: Number(form.sale_year),
      }])
      .select()
      .single()

    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    setSales([data, ...sales])
    setForm(emptyForm)
    setShowForm(false)
    setLoading(false)
  }

  const filtered = sales.filter(s =>
    s.asset_number?.toLowerCase().includes(search.toLowerCase()) ||
    s.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
    s.invoice_number?.toLowerCase().includes(search.toLowerCase()) ||
    s.brand?.toLowerCase().includes(search.toLowerCase())
  )

  // Find purchase detail for a sale
  const findPurchase = (assetNumber: string) => {
    return purchases.find(p => p.asset_number === assetNumber) || null
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Sales</h1>
          <p className="text-sm text-gray-500 mt-1">{sales.length} total sales</p>
        </div>
        <Button
          className="bg-blue-600 hover:bg-blue-700"
          onClick={() => setShowForm(true)}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Sale
        </Button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Search by asset number, customer, invoice, brand..."
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
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Invoice</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Customer</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Asset No.</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Brand</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Sale Total</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">PMT</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-gray-400">
                      No sales found. Click "Add Sale" to get started.
                    </td>
                  </tr>
                ) : (
                  filtered.map((s) => (
                    <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-600">{s.sale_date}</td>
                      <td className="px-4 py-3 font-medium text-blue-600">{s.invoice_number || '—'}</td>
                      <td className="px-4 py-3">{s.customer_name}</td>
                      <td className="px-4 py-3 font-medium">{s.asset_number}</td>
                      <td className="px-4 py-3 text-gray-600">{s.brand}</td>
                      <td className="px-4 py-3 font-medium text-green-600">
                        ₹{s.sale_total?.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3">
                        <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50">
                          {s.pmt || '—'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          className={
                            s.sale_type === 'GST'
                              ? 'bg-purple-100 text-purple-700 hover:bg-purple-100'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-100'
                          }
                        >
                          {s.sale_type || '—'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setViewItem(s)}
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

      {/* Add Sale Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Sale</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">

            {/* Sale Date */}
            <div className="space-y-2">
              <Label>Sale Date *</Label>
              <Input
                type="date"
                value={form.sale_date}
                onChange={(e) => handleDateChange(e.target.value)}
              />
            </div>

            {/* Month auto filled */}
            <div className="space-y-2">
              <Label>Month</Label>
              <Input value={form.sale_month} readOnly className="bg-gray-50" />
            </div>

            {/* Invoice Number */}
            <div className="space-y-2">
              <Label>Invoice Number</Label>
              <Input
                placeholder="e.g. INV-2024-001"
                value={form.invoice_number}
                onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
              />
            </div>

            {/* Customer Name */}
            <div className="space-y-2">
              <Label>Customer Name *</Label>
              <Select onValueChange={(v) => setForm({ ...form, customer_name: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map(c => (
                    <SelectItem key={c.customer_name} value={c.customer_name}>
                      {c.customer_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Asset Number - auto fills other fields */}
            <div className="space-y-2">
              <Label>Asset Number *</Label>
              <Select onValueChange={handleAssetSelect}>
                <SelectTrigger>
                  <SelectValue placeholder="Select asset" />
                </SelectTrigger>
                <SelectContent>
                  {purchases.map(p => (
                    <SelectItem key={p.asset_number} value={p.asset_number}>
                      {p.asset_number} — {p.brand} {p.asset_description?.slice(0, 30)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* PMT */}
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Select onValueChange={(v) => setForm({ ...form, pmt: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select payment method" />
                </SelectTrigger>
                <SelectContent>
                  {PMT_TYPES.map(p => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Brand - auto filled */}
            <div className="space-y-2">
              <Label>Brand</Label>
              <Input value={form.brand} readOnly className="bg-gray-50" />
            </div>

            {/* Type - auto filled */}
            <div className="space-y-2">
              <Label>Type</Label>
              <Input value={form.type} readOnly className="bg-gray-50" />
            </div>

            {/* Asset Description - auto filled */}
            <div className="space-y-2 md:col-span-2">
              <Label>Asset Description</Label>
              <Input value={form.asset_description} readOnly className="bg-gray-50" />
            </div>

            {/* Serial Number - auto filled */}
            <div className="space-y-2">
              <Label>Serial Number</Label>
              <Input value={form.serial_number} readOnly className="bg-gray-50" />
            </div>

            {/* SKU - auto filled */}
            <div className="space-y-2">
              <Label>SKU</Label>
              <Input value={form.sku} readOnly className="bg-gray-50" />
            </div>

            {/* Sale Base Price */}
            <div className="space-y-2">
              <Label>Sale Base Price (₹)</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={form.sale_base_price}
                onChange={(e) => handlePriceChange('sale_base_price', e.target.value)}
              />
            </div>

            {/* Sale GST */}
            <div className="space-y-2">
              <Label>Sale GST (₹)</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={form.sale_gst}
                onChange={(e) => handlePriceChange('sale_gst', e.target.value)}
              />
            </div>

            {/* Sale Total - auto calculated */}
            <div className="space-y-2">
              <Label>Sale Total (₹) — auto calculated</Label>
              <Input
                value={form.sale_total}
                readOnly
                className="bg-gray-50 font-medium"
              />
            </div>

            {/* Sale Type */}
            <div className="space-y-2">
              <Label>Sale Type</Label>
              <Select onValueChange={(v) => setForm({ ...form, sale_type: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Cash or GST" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="GST">GST</SelectItem>
                </SelectContent>
              </Select>
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
                'Save Sale'
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

      {/* View Sale Detail Dialog */}
      <Dialog open={!!viewItem} onOpenChange={() => { setViewItem(null); setViewPurchase(null) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sale Detail — {viewItem?.invoice_number || viewItem?.asset_number}</DialogTitle>
          </DialogHeader>

          {viewItem && (
            <>
              <div className="grid grid-cols-2 gap-x-8 gap-y-3 mt-2 text-sm">
                {[
                  ['Sale Date', viewItem.sale_date],
                  ['Month / Year', `${viewItem.sale_month} ${viewItem.sale_year}`],
                  ['Invoice Number', viewItem.invoice_number],
                  ['Customer Name', viewItem.customer_name],
                  ['Asset Number', viewItem.asset_number],
                  ['Brand', viewItem.brand],
                  ['Description', viewItem.asset_description],
                  ['Serial Number', viewItem.serial_number],
                  ['Payment Method', viewItem.pmt],
                  ['Sale Base Price', `₹${viewItem.sale_base_price?.toLocaleString('en-IN')}`],
                  ['Sale GST', `₹${viewItem.sale_gst?.toLocaleString('en-IN')}`],
                  ['Sale Total', `₹${viewItem.sale_total?.toLocaleString('en-IN')}`],
                  ['Sale Type', viewItem.sale_type],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-gray-400 text-xs">{label}</p>
                    <p className="font-medium text-gray-900 mt-0.5">{value || '—'}</p>
                  </div>
                ))}
              </div>

              {/* View Purchase Detail Button */}
              <div className="mt-4 pt-4 border-t border-gray-200">
                {!viewPurchase ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setViewPurchase(findPurchase(viewItem.asset_number))}
                  >
                    <ShoppingBag className="h-4 w-4 mr-2" />
                    View Original Purchase Detail
                  </Button>
                ) : (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-3">
                      Original Purchase Detail
                    </p>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm bg-blue-50 rounded-xl p-4">
                      {[
                        ['Purchase Date', viewPurchase.purchase_date],
                        ['Vendor', viewPurchase.vendor_name],
                        ['Purchase Price', `₹${viewPurchase.total_price?.toLocaleString('en-IN')}`],
                        ['Selling Price Set', `₹${viewPurchase.selling_price?.toLocaleString('en-IN')}`],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <p className="text-gray-400 text-xs">{label}</p>
                          <p className="font-medium text-gray-900 mt-0.5">{value || '—'}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

        </DialogContent>
      </Dialog>

    </div>
  )
}
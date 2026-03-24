'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Search, Eye, Loader2 } from 'lucide-react'

type Vendor = {
  id: string
  company_name: string
  spoc_name: string
  owner_name: string
  phone: string
  address: string
  email: string
  has_gst: boolean
  gst_number: string
  gst_company_name: string
  created_at: string
}

const emptyForm = {
  company_name: '',
  spoc_name: '',
  owner_name: '',
  phone: '',
  address: '',
  email: '',
  has_gst: 'false',
  gst_number: '',
  gst_company_name: '',
}

export default function VendorsClient({ initialData }: { initialData: Vendor[] }) {
  const [vendors, setVendors] = useState<Vendor[]>(initialData)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [viewItem, setViewItem] = useState<Vendor | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fetchingGst, setFetchingGst] = useState(false)
  const supabase = createClient()

  // Fetch GST details when user enters a GST number
  const handleGstBlur = async () => {
    if (!form.gst_number || form.gst_number.length !== 15) return
    setFetchingGst(true)
    try {
      const res = await fetch(`/api/gst?gst=${form.gst_number}`)
      const data = await res.json()
      if (data.company_name) {
        setForm(prev => ({
          ...prev,
          gst_company_name: data.company_name,
          company_name: data.company_name, // auto-fill company name
        }))
      } else {
        setError('GST number not found. Please check.')
      }
    } catch (err) {
      setError('Failed to verify GST. Try again.')
    } finally {
      setFetchingGst(false)
    }
  }

  const handleSubmit = async () => {
    setError('')
    if (!form.company_name) {
      setError('Company Name is required.')
      return
    }
    setLoading(true)
    const { data, error: err } = await supabase
      .from('vendors')
      .insert([{
        company_name: form.company_name,
        spoc_name: form.spoc_name,
        owner_name: form.owner_name,
        phone: form.phone,
        address: form.address,
        email: form.email,
        has_gst: form.has_gst === 'true',
        gst_number: form.gst_number,
        gst_company_name: form.gst_company_name,
      }])
      .select()
      .single()

    if (err) { setError(err.message); setLoading(false); return }
    setVendors([data, ...vendors])
    setForm(emptyForm)
    setShowForm(false)
    setLoading(false)
  }

  const filtered = vendors.filter(v =>
    v.company_name?.toLowerCase().includes(search.toLowerCase()) ||
    v.spoc_name?.toLowerCase().includes(search.toLowerCase()) ||
    v.owner_name?.toLowerCase().includes(search.toLowerCase()) ||
    v.phone?.includes(search) ||
    v.gst_number?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Vendors</h1>
          <p className="text-sm text-gray-500 mt-1">{vendors.length} vendors</p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-2" />Add Vendor
        </Button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Search by company, SPOC, owner, phone, GST..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Company</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">SPOC</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">GST</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Phone</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-gray-400">
                      No vendors found. Add your first vendor.
                    </td>
                  </tr>
                ) : filtered.map((v) => (
                  <tr key={v.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-blue-600">{v.company_name}</td>
                    <td className="px-4 py-3">{v.spoc_name || '—'}</td>
                    <td className="px-4 py-3">
                      {v.has_gst ? (
                        <span className="text-xs text-gray-600" title={v.gst_number}>
                          Yes {v.gst_number?.slice(0, 5)}...
                        </span>
                      ) : 'No'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{v.phone || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{v.email || '—'}</td>
                    <td className="px-4 py-3">
                      <Button variant="ghost" size="sm" onClick={() => setViewItem(v)}>
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

      {/* Add Vendor Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Vendor</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
            <div className="space-y-2 md:col-span-2">
              <Label>Company Name *</Label>
              <Input
                placeholder="e.g. Tech Traders Pvt Ltd"
                value={form.company_name}
                onChange={(e) => setForm({ ...form, company_name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>SPOC Name</Label>
              <Input
                placeholder="Point of contact name"
                value={form.spoc_name}
                onChange={(e) => setForm({ ...form, spoc_name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Owner Name</Label>
              <Input
                placeholder="Owner / Proprietor name"
                value={form.owner_name}
                onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                placeholder="+91 98765 43210"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="vendor@company.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Address</Label>
              <Input
                placeholder="Full address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>

            {/* GST Section */}
            <div className="space-y-2">
              <Label>Has GST?</Label>
              <Select
                value={form.has_gst}
                onValueChange={(v) => setForm({ ...form, has_gst: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Yes or No" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Yes</SelectItem>
                  <SelectItem value="false">No</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.has_gst === 'true' && (
              <>
                <div className="space-y-2">
                  <Label>GST Number</Label>
                  <Input
                    placeholder="e.g. 07AAAAA0000A1Z5"
                    value={form.gst_number}
                    onChange={(e) => setForm({ ...form, gst_number: e.target.value.toUpperCase() })}
                    onBlur={handleGstBlur}
                  />
                  {fetchingGst && <p className="text-xs text-blue-500">Fetching company details...</p>}
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Auto-filled Company Name (from GST)</Label>
                  <Input
                    value={form.gst_company_name}
                    readOnly
                    className="bg-gray-50"
                  />
                </div>
              </>
            )}
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg mt-2">{error}</div>
          )}
          <div className="flex gap-3 mt-4">
            <Button
              className="flex-1 bg-blue-600 hover:bg-blue-700"
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : 'Save Vendor'}
            </Button>
            <Button variant="outline" onClick={() => { setShowForm(false); setError('') }}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Vendor Dialog */}
      <Dialog open={!!viewItem} onOpenChange={() => setViewItem(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{viewItem?.company_name}</DialogTitle>
          </DialogHeader>
          {viewItem && (
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 mt-2 text-sm">
              {[
                ['SPOC Name', viewItem.spoc_name],
                ['Owner Name', viewItem.owner_name],
                ['Phone', viewItem.phone],
                ['Email', viewItem.email],
                ['Address', viewItem.address],
                ['GST', viewItem.has_gst ? `${viewItem.gst_number} (${viewItem.gst_company_name})` : 'No'],
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
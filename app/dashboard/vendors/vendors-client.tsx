'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Search, Eye, Loader2, Pencil, Trash2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import DeleteRecordDialog from '@/components/DeleteRecordDialog' // we'll reuse this

type Vendor = {
  id: string
  company_name: string
  spoc_name: string
  owner_name: string
  phone: string
  address: string // old single-line, keep for backward compatibility
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  pincode: string | null
  email: string
  has_gst: boolean
  gst_number: string
  gst_company_name: string
  remarks: string | null
  is_deleted: boolean
  deleted_remarks: string | null
  deleted_at: string | null
  created_at: string
}

const emptyForm = {
  company_name: '',
  spoc_name: '',
  owner_name: '',
  phone: '',
  address_line1: '',
  address_line2: '',
  city: '',
  state: '',
  pincode: '',
  email: '',
  has_gst: 'false',
  gst_number: '',
  gst_company_name: '',
  remarks: '',
}

export default function VendorsClient({ initialData }: { initialData: Vendor[] }) {
  const [vendors, setVendors] = useState<Vendor[]>(initialData)
  const [search, setSearch] = useState('')
  const [showDeleted, setShowDeleted] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [viewItem, setViewItem] = useState<Vendor | null>(null)
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fetchingGst, setFetchingGst] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [vendorToDelete, setVendorToDelete] = useState<Vendor | null>(null)
  const supabase = createClient()

  // Filter vendors based on search and deleted toggle
  const filtered = vendors.filter(v => {
    if (!showDeleted && v.is_deleted) return false
    if (!search) return true
    const searchLower = search.toLowerCase()
    return (
      v.company_name?.toLowerCase().includes(searchLower) ||
      v.spoc_name?.toLowerCase().includes(searchLower) ||
      v.owner_name?.toLowerCase().includes(searchLower) ||
      v.phone?.includes(search) ||
      v.gst_number?.toLowerCase().includes(searchLower) ||
      v.email?.toLowerCase().includes(searchLower)
    )
  })

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
          company_name: data.company_name,
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

  // Reset form and close dialog
  const resetForm = () => {
    setForm(emptyForm)
    setEditingVendor(null)
    setError('')
    setShowForm(false)
  }

  // Open edit dialog with vendor data
  const handleEdit = (vendor: Vendor) => {
    setEditingVendor(vendor)
    setForm({
      company_name: vendor.company_name,
      spoc_name: vendor.spoc_name || '',
      owner_name: vendor.owner_name || '',
      phone: vendor.phone || '',
      address_line1: vendor.address_line1 || '',
      address_line2: vendor.address_line2 || '',
      city: vendor.city || '',
      state: vendor.state || '',
      pincode: vendor.pincode || '',
      email: vendor.email || '',
      has_gst: vendor.has_gst ? 'true' : 'false',
      gst_number: vendor.gst_number || '',
      gst_company_name: vendor.gst_company_name || '',
      remarks: vendor.remarks || '',
    })
    setShowForm(true)
  }

  // Submit add or edit
  const handleSubmit = async () => {
    setError('')
    if (!form.company_name) {
      setError('Company Name is required.')
      return
    }
    setLoading(true)

    const payload = {
      company_name: form.company_name,
      spoc_name: form.spoc_name,
      owner_name: form.owner_name,
      phone: form.phone,
      address_line1: form.address_line1,
      address_line2: form.address_line2,
      city: form.city,
      state: form.state,
      pincode: form.pincode,
      email: form.email,
      has_gst: form.has_gst === 'true',
      gst_number: form.gst_number,
      gst_company_name: form.gst_company_name,
      remarks: form.remarks,
    }

    let result
    if (editingVendor) {
      result = await supabase
        .from('vendors')
        .update(payload)
        .eq('id', editingVendor.id)
        .select()
        .single()
    } else {
      result = await supabase
        .from('vendors')
        .insert([payload])
        .select()
        .single()
    }

    const { data, error: err } = result
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    if (editingVendor) {
      setVendors(vendors.map(v => v.id === editingVendor.id ? data : v))
      toast.success('Vendor updated successfully')
    } else {
      setVendors([data, ...vendors])
      toast.success('Vendor added successfully')
    }
    resetForm()
    setLoading(false)
  }

  // Soft delete
  const handleSoftDelete = async (remarks: string) => {
    if (!vendorToDelete) return
    const { error } = await supabase
      .from('vendors')
      .update({
        is_deleted: true,
        deleted_remarks: remarks,
        deleted_at: new Date().toISOString(),
      })
      .eq('id', vendorToDelete.id)
    if (error) {
      toast.error('Failed to delete vendor')
    } else {
      setVendors(vendors.map(v =>
        v.id === vendorToDelete.id
          ? { ...v, is_deleted: true, deleted_remarks: remarks, deleted_at: new Date().toISOString() }
          : v
      ))
      toast.success('Vendor moved to trash')
    }
    setVendorToDelete(null)
    setDeleteDialogOpen(false)
  }

  // Restore vendor
  const handleRestore = async (vendor: Vendor) => {
    const { error } = await supabase
      .from('vendors')
      .update({ is_deleted: false, deleted_remarks: null, deleted_at: null })
      .eq('id', vendor.id)
    if (error) {
      toast.error('Failed to restore vendor')
    } else {
      setVendors(vendors.map(v =>
        v.id === vendor.id ? { ...v, is_deleted: false, deleted_remarks: null, deleted_at: null } : v
      ))
      toast.success('Vendor restored')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Vendors</h1>
          <p className="text-sm text-gray-500 mt-1">{vendors.filter(v => !v.is_deleted).length} active vendors</p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => { resetForm(); setShowForm(true) }}>
          <Plus className="h-4 w-4 mr-2" />Add Vendor
        </Button>
      </div>

      <div className="flex gap-4 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search by company, SPOC, owner, phone, GST, email..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center space-x-2">
          <input
            type="checkbox"
            id="showDeleted"
            checked={showDeleted}
            onChange={(e) => setShowDeleted(e.target.checked)}
            className="h-4 w-4"
          />
          <Label htmlFor="showDeleted">Show deleted records</Label>
        </div>
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
                  <th className="text-left px-4 py-3 font-medium text-gray-600">City</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Remarks</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-gray-400">
                      No vendors found. Add your first vendor.
                    </td>
                  </tr>
                ) : (
                  filtered.map((v) => (
                    <tr key={v.id} className={`border-b border-gray-100 hover:bg-gray-50 ${v.is_deleted ? 'opacity-50' : ''}`}>
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
                      <td className="px-4 py-3 text-gray-600">{v.city || '—'}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{v.remarks || '—'}</td>
                      <td className="px-4 py-3 text-right space-x-1">
                        {!v.is_deleted ? (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => setViewItem(v)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleEdit(v)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => {
                              setVendorToDelete(v);
                              setDeleteDialogOpen(true);
                            }}>
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => handleRestore(v)}>
                            <RotateCcw className="h-4 w-4 text-green-500" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Add/Edit Vendor Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => !open && resetForm()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingVendor ? 'Edit Vendor' : 'Add New Vendor'}</DialogTitle>
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

            {/* Split address fields */}
            <div className="space-y-2 md:col-span-2">
              <Label>Address Line 1</Label>
              <Input
                placeholder="Street, building, etc."
                value={form.address_line1}
                onChange={(e) => setForm({ ...form, address_line1: e.target.value })}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Address Line 2</Label>
              <Input
                placeholder="Apartment, suite, etc. (optional)"
                value={form.address_line2}
                onChange={(e) => setForm({ ...form, address_line2: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>City</Label>
              <Input
                placeholder="City"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>State</Label>
              <Input
                placeholder="State"
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Pincode</Label>
              <Input
                placeholder="Pincode"
                value={form.pincode}
                onChange={(e) => setForm({ ...form, pincode: e.target.value })}
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

            <div className="space-y-2 md:col-span-2">
              <Label>Remarks</Label>
              <Textarea
                placeholder="Any notes about this vendor"
                value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                rows={2}
              />
            </div>
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
              {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : editingVendor ? 'Update Vendor' : 'Save Vendor'}
            </Button>
            <Button variant="outline" onClick={resetForm}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Vendor Dialog (same as before, but show split address nicely) */}
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
                ['Address', [
                  viewItem.address_line1,
                  viewItem.address_line2,
                  viewItem.city,
                  viewItem.state,
                  viewItem.pincode
                ].filter(Boolean).join(', ') || viewItem.address || '—'],
                ['GST', viewItem.has_gst ? `${viewItem.gst_number} (${viewItem.gst_company_name})` : 'No'],
                ['Remarks', viewItem.remarks || '—'],
              ].map(([label, value]) => (
                <div key={label} className={label === 'Address' ? 'col-span-2' : ''}>
                  <p className="text-gray-400 text-xs">{label}</p>
                  <p className="font-medium text-gray-900 mt-0.5 break-words">{value || '—'}</p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Dialog (reuse DeleteRecordDialog) */}
      <DeleteRecordDialog
        title="Delete Vendor"
        identifier={vendorToDelete?.company_name}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleSoftDelete}
      />
    </div>
  )
}
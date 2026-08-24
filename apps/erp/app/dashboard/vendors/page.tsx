'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import RequireOwner from '@/components/RequireOwner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog'
import {
  Plus, Search, Eye, Loader2, Pencil, Trash2, RotateCcw
} from 'lucide-react'
import { toast } from 'sonner'
import DeleteRecordDialog from '@/components/DeleteRecordDialog'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { Pagination } from '@/components/Pagination'
import { ResizableHeader } from '@/components/ResizableHeader'
import { VendorFormFields, emptyVendorForm, type VendorFormState } from '@/components/VendorFormFields'

const PAGE_SIZE = 25

type Vendor = {
  id: string
  company_name: string
  spoc_name: string
  owner_name: string
  phone: string
  address: string
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
  supplies_accessories: boolean
  is_deleted: boolean
  deleted_remarks: string | null
  deleted_at: string | null
  created_at: string
}

const emptyForm = emptyVendorForm

type VendorSortField = 'company_name' | 'spoc_name' | 'phone' | 'city'
type SortOrder = 'asc' | 'desc'

function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [search, setSearch] = useState('')
  const [showDeleted, setShowDeleted] = useState(false)
  const [sortField, setSortField] = useState<VendorSortField | null>(null)
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [showForm, setShowForm] = useState(false)
  const [viewItem, setViewItem] = useState<Vendor | null>(null)
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null)
  const [form, setForm] = useState<VendorFormState>(emptyForm)
  const [error, setError] = useState('')
  const [fetchingGst, setFetchingGst] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [vendorToDelete, setVendorToDelete] = useState<Vendor | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const supabase = createClient()

  // Initial column widths
  const [colWidths, setColWidths] = useState([200, 120, 100, 120, 80, 120, 90, 100])

  // Search/sort/showDeleted/pagination all happen server-side now -- this used to
  // fetch the entire table once on mount and filter/sort the full array in the
  // browser, which doesn't scale and made pagination meaningless.
  const fetchVendors = async () => {
    let query = supabase.from('vendors').select('*', { count: 'exact' })
    query = showDeleted ? query.eq('is_deleted', true) : query.eq('is_deleted', false)
    if (search) {
      const s = `%${search}%`
      query = query.or(`company_name.ilike.${s},spoc_name.ilike.${s},owner_name.ilike.${s},phone.ilike.${s},gst_number.ilike.${s},email.ilike.${s}`)
    }
    query = query.order(sortField || 'company_name', { ascending: sortOrder === 'asc' })
    query = query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    const { data, count } = await query
    setVendors(data || [])
    setTotal(count || 0)
  }

  useEffect(() => { fetchVendors() }, [showDeleted, search, sortField, sortOrder, page])

  // Any filter change invalidates the current page's meaning -- reset to page 1.
  useEffect(() => { setPage(1) }, [showDeleted, search])

  const toggleSort = (field: VendorSortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  const sortIndicatorFor = (field: VendorSortField) =>
    sortField === field ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : ''

  const handleGstBlur = async () => {
    if (!form.gst_number || form.gst_number.length !== 15) return
    setFetchingGst(true)
    try {
      const res = await fetch(`/api/gst?gst=${form.gst_number}`)
      const data = await res.json()
      if (data.company_name) {
        setForm((prev: VendorFormState) => ({
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

  const resetForm = () => {
    setForm(emptyForm)
    setEditingVendor(null)
    setError('')
    setShowForm(false)
  }

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
      supplies_accessories: !!vendor.supplies_accessories,
    })
    setShowForm(true)
  }

  const { run: handleSubmit, pending: loading } = useAsyncAction(async () => {
    setError('')
    if (!form.company_name) {
      setError('Company Name is required.')
      return
    }

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
      supplies_accessories: form.supplies_accessories,
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
      return
    }

    if (editingVendor) {
      toast.success('Vendor updated successfully')
    } else {
      toast.success('Vendor added successfully')
    }
    await fetchVendors()
    resetForm()
  })

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
      toast.success('Vendor moved to trash')
      await fetchVendors()
    }
    setVendorToDelete(null)
    setDeleteDialogOpen(false)
  }

  const [restoringId, setRestoringId] = useState<string | null>(null)
  const handleRestore = async (vendor: Vendor) => {
    if (restoringId) return
    setRestoringId(vendor.id)
    try {
      const { error } = await supabase
        .from('vendors')
        .update({ is_deleted: false, deleted_remarks: null, deleted_at: null })
        .eq('id', vendor.id)
      if (error) {
        toast.error('Failed to restore vendor')
      } else {
        toast.success('Vendor restored')
        await fetchVendors()
      }
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Vendors</h1>
          <p className="text-sm text-gray-500 mt-1">{total} vendor{total === 1 ? '' : 's'}{search ? ' matching filters' : showDeleted ? ' (deleted)' : ''}</p>
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
          <Checkbox id="showDeleted" checked={showDeleted} onCheckedChange={(v) => setShowDeleted(!!v)} />
          <Label htmlFor="showDeleted">Show deleted records</Label>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-right px-4 py-3 font-medium text-gray-600 w-10">#</th>
                  {(['Company', 'SPOC', 'GST', 'Phone', 'City', 'Remarks', 'Accessories', 'Actions'] as const).map((label, i) => {
                    const sortableField: Partial<Record<typeof label, VendorSortField>> = {
                      Company: 'company_name',
                      SPOC: 'spoc_name',
                      Phone: 'phone',
                      City: 'city',
                    }
                    const field = sortableField[label]
                    return (
                      <ResizableHeader
                        key={label}
                        label={label}
                        width={colWidths[i]}
                        onResize={(newWidth) => {
                          const newWidths = [...colWidths]
                          newWidths[i] = Math.max(60, newWidth)
                          setColWidths(newWidths)
                        }}
                        className="text-left px-4 py-3 font-medium text-gray-600"
                        onSort={field ? () => toggleSort(field) : undefined}
                        sortIndicator={field ? sortIndicatorFor(field) : undefined}
                      />
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {vendors.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-gray-400">
                      No vendors found. Add your first vendor.
                    </td>
                  </tr>
                ) : (
                  vendors.map((v, idx) => (
                    <tr key={v.id} className={`border-b hover:bg-gray-50 ${v.is_deleted ? 'opacity-50' : ''}`}>
  <td className="px-4 py-3 text-right tabular-nums text-gray-400">{(page - 1) * PAGE_SIZE + idx + 1}</td>
  <td className="px-4 py-3 font-medium text-gray-900">{v.company_name}</td>
  <td className="px-4 py-3 text-gray-700">{v.spoc_name || '—'}</td>
  <td className="px-4 py-3 text-gray-700">
    {v.has_gst ? (
      <span className="block truncate max-w-full" title={v.gst_number}>
        {v.gst_number}
      </span>
    ) : 'No'}
  </td>
  <td className="px-4 py-3 text-gray-700">{v.phone || '—'}</td>
  <td className="px-4 py-3 text-gray-700">{v.city || '—'}</td>
  <td className="px-4 py-3 text-gray-700 max-w-xs truncate">{v.remarks || '—'}</td>
  <td className="px-4 py-3 text-gray-700" title="Whether employees can select this vendor when receiving accessory stock">
    {v.supplies_accessories ? '✓' : '—'}
  </td>
  <td className="px-4 py-3 text-right space-x-1 whitespace-nowrap">
    <button onClick={() => setViewItem(v)} title="View" className="text-gray-500 hover:text-gray-900 inline-flex align-middle p-1">
      <Eye className="h-4 w-4" />
    </button>
    {!v.is_deleted ? (
      <>
        <button onClick={() => handleEdit(v)} title="Edit" className="text-gray-500 hover:text-blue-600 inline-flex align-middle p-1">
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={() => { setVendorToDelete(v); setDeleteDialogOpen(true) }}
          title="Delete"
          className="text-gray-500 hover:text-red-600 inline-flex align-middle p-1"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </>
    ) : (
      <button
        onClick={() => handleRestore(v)}
        disabled={restoringId === v.id}
        title="Restore"
        className="text-gray-500 hover:text-green-600 inline-flex align-middle p-1 disabled:opacity-50"
      >
        {restoringId === v.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
      </button>
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
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />

      {/* Add/Edit Vendor Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => !open && resetForm()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingVendor ? 'Edit Vendor' : 'Add New Vendor'}</DialogTitle>
          </DialogHeader>
          <VendorFormFields
            form={form}
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
            fetchingGst={fetchingGst}
            onGstBlur={handleGstBlur}
            showSuppliesAccessories
          />

          {error && (
            <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg mt-2">{error}</div>
          )}
          <div className="flex gap-3 mt-4">
            <Button
              className="flex-1 bg-blue-600 hover:bg-blue-700"
              onClick={() => handleSubmit()}
              loading={loading}
            >
              {editingVendor ? 'Update Vendor' : 'Save Vendor'}
            </Button>
            <Button variant="outline" onClick={resetForm} disabled={loading}>
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
                ['Address', [
                  viewItem.address_line1,
                  viewItem.address_line2,
                  viewItem.city,
                  viewItem.state,
                  viewItem.pincode
                ].filter(Boolean).join(', ') || viewItem.address || '—'],
                ['GST', viewItem.has_gst ? `${viewItem.gst_number}${viewItem.gst_company_name ? ` (${viewItem.gst_company_name})` : ''}` : 'No'],
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

      {/* Delete Dialog */}
      <DeleteRecordDialog
        title="Delete Vendor"
        identifier={vendorToDelete?.company_name || ""}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleSoftDelete}
      />
    </div>
  )
}

export default function VendorsPageGuarded() {
  return (
    <RequireOwner>
      <VendorsPage />
    </RequireOwner>
  )
}
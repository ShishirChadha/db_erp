'use client'

import { useState, useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { useIsDesktopViewport } from '@/lib/useIsDesktopViewport'
import RequireOwner from '@/components/RequireOwner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import {
  Plus, Search, Loader2, Pencil, Trash2, RotateCcw, ArrowLeft
} from 'lucide-react'
import { toast } from 'sonner'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { Pagination } from '@/components/Pagination'
import { VendorFormFields, emptyVendorForm, type VendorFormState } from '@/components/VendorFormFields'
import { withRetry } from '@/lib/db-retry'
import { cn } from '@/lib/utils'

// Only renders behind a click (gated by a state flag) -- code-split out of the
// initial bundle rather than shipped unconditionally.
const DeleteRecordDialog = dynamic(() => import('@/components/DeleteRecordDialog'), { ssr: false })

const PAGE_SIZE = 25

type Vendor = {
  id: string
  company_name: string
  spoc_name: string
  owner_name: string
  phone: string
  alt_phone: string | null
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

// One field in the detail pane's label/value grid -- keeps every row's spacing
// and label styling consistent without repeating the wrapper markup (mirrors
// Sales Ledger's Field helper).
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5 border-b border-border grid grid-cols-3 gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2">{children}</span>
    </div>
  )
}

// Left-pane list block -- a contact list, not a transaction ledger, so the
// scannable identifying fields are company name, phone, and a compact
// accessories-vendor tag rather than any status/date.
function VendorListItem({ vendor, active, onOpen }: {
  vendor: Vendor
  active: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "w-full text-left px-3 py-2.5 border-b border-border flex items-start gap-2.5 transition-colors",
        active ? "bg-primary/10" : "hover:bg-muted",
        vendor.is_deleted && "opacity-50"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-sm text-foreground truncate">{vendor.company_name}</span>
        </div>
        <div className="flex items-baseline justify-between gap-2 mt-0.5">
          <p className="text-xs text-muted-foreground truncate">{vendor.phone || '—'}</p>
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          {vendor.supplies_accessories && (
            <span className="text-[10px] font-semibold tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              Accessories
            </span>
          )}
          {vendor.is_deleted && (
            <span className="text-[10px] font-semibold tracking-wide px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
              Deleted
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

// Right-pane detail view -- everything the old wide table's columns + View
// dialog showed for one vendor, now laid out as a single record, matching
// an email/Zoho-Invoices-style reading pane.
function VendorDetailPane({ vendor, onEdit, onDelete, onRestore, restoring, onBack }: {
  vendor: Vendor
  onEdit: () => void
  onDelete: () => void
  onRestore: () => void
  restoring: boolean
  onBack: () => void
}) {
  const address = [
    vendor.address_line1,
    vendor.address_line2,
    vendor.city,
    vendor.state,
    vendor.pincode,
  ].filter(Boolean).join(', ') || vendor.address || '—'

  return (
    <div className={cn("flex flex-col h-full", vendor.is_deleted && "opacity-60")}>
      <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
        <div className="min-w-0">
          <button type="button" onClick={onBack} className="md:hidden mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowLeft className="size-4" /> Back to list
          </button>
          <h2 className="text-lg font-semibold text-foreground truncate">{vendor.company_name}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{vendor.spoc_name || '—'}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          {vendor.supplies_accessories && (
            <span className="text-[10px] font-semibold tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              Accessories
            </span>
          )}
          {!vendor.is_deleted ? (
            <div className="flex items-center gap-2 mt-1">
              <button onClick={onEdit} title="Edit" className="text-muted-foreground hover:text-primary inline-flex align-middle p-1">
                <Pencil className="h-4 w-4" />
              </button>
              <button onClick={onDelete} title="Delete" className="text-muted-foreground hover:text-destructive inline-flex align-middle p-1">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={onRestore}
              disabled={restoring}
              title="Restore"
              className="text-muted-foreground hover:text-success inline-flex align-middle p-1 disabled:opacity-50 mt-1"
            >
              {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <Field label="Owner Name">{vendor.owner_name || '—'}</Field>
        <Field label="Phone">{vendor.phone || '—'}</Field>
        <Field label="Alt Phone">{vendor.alt_phone || '—'}</Field>
        <Field label="Email">{vendor.email || '—'}</Field>
        <Field label="Address">{address}</Field>
        <Field label="GST">
          {vendor.has_gst ? `${vendor.gst_number}${vendor.gst_company_name ? ` (${vendor.gst_company_name})` : ''}` : 'No'}
        </Field>
        <Field label="Remarks">{vendor.remarks || '—'}</Field>
        <Field label="Supplies Accessories" >
          <span title="Whether employees can select this vendor when receiving accessory stock">
            {vendor.supplies_accessories ? 'Yes' : 'No'}
          </span>
        </Field>
        {vendor.is_deleted && (
          <Field label="Deleted Remarks">{vendor.deleted_remarks || '—'}</Field>
        )}
      </div>
    </div>
  )
}

function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  // searchInput updates on every keystroke; searchTerm catches up 300ms after
  // typing stops and is what actually drives the fetch -- same debounce pattern
  // as StockView/Sales Ledger/Repair Jobs.
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(timer)
  }, [searchInput])
  const [showDeleted, setShowDeleted] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null)
  const [form, setForm] = useState<VendorFormState>(emptyForm)
  const [error, setError] = useState('')
  const [fetchingGst, setFetchingGst] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [vendorToDelete, setVendorToDelete] = useState<Vendor | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  // Which vendor is open in the right-hand detail pane.
  const [activeVendorId, setActiveVendorId] = useState<string | null>(null)
  const isDesktop = useIsDesktopViewport()

  const supabase = createClient()

  // Search/showDeleted/pagination all happen server-side -- sorted by entry
  // date, newest first, matching every other list page's default.
  const fetchVendors = async () => {
    let query = supabase.from('vendors').select('*', { count: 'exact' })
    query = showDeleted ? query.eq('is_deleted', true) : query.eq('is_deleted', false)
    if (search) {
      const s = `%${search}%`
      query = query.or(`company_name.ilike.${s},spoc_name.ilike.${s},owner_name.ilike.${s},phone.ilike.${s},gst_number.ilike.${s},email.ilike.${s}`)
    }
    query = query.order('created_at', { ascending: false })
    query = query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    try {
      const { data, error, count } = await withRetry(() => query)
      if (error) throw error
      const rows: Vendor[] = data || []
      setVendors(rows)
      setTotal(count || 0)
      // Auto-open the first row on load/refetch, but don't yank focus away
      // from whatever's already open if it's still in the refetched data.
      setActiveVendorId((prev) => (prev && rows.some((v) => v.id === prev)) ? prev : (isDesktop ? (rows[0]?.id ?? null) : null))
    } catch (err) {
      console.error(err)
      toast.error('Unable to load vendors -- check your connection and try again.')
    }
  }

  useEffect(() => { fetchVendors() }, [showDeleted, search, page])

  // Any filter change invalidates the current page's meaning -- reset to page 1.
  useEffect(() => { setPage(1) }, [showDeleted, search])

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
      alt_phone: vendor.alt_phone || '',
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
      alt_phone: form.alt_phone,
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

  const activeVendor = useMemo(() => vendors.find(v => v.id === activeVendorId) ?? null, [vendors, activeVendorId])

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Vendors</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{total} vendor{total === 1 ? '' : 's'}{search ? ' matching filters' : showDeleted ? ' (deleted)' : ''}</p>
        </div>
        <Button className="bg-primary hover:bg-primary/90" onClick={() => { resetForm(); setShowForm(true) }}>
          <Plus className="h-4 w-4 mr-2" />Add Vendor
        </Button>
      </div>

      <div className="flex gap-4 mb-2 items-center flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by company, SPOC, owner, phone, GST, email..."
            className="pl-9"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div className="flex items-center space-x-2">
          <Checkbox id="showDeleted" checked={showDeleted} onCheckedChange={(v) => setShowDeleted(!!v)} />
          <Label htmlFor="showDeleted">Show deleted records</Label>
        </div>
      </div>

      <div className="flex-1 min-h-[320px] border rounded overflow-hidden flex">
        {/* List pane -- hidden on mobile once a vendor is open, matching an
            email client's drill-in navigation; always visible at md+. */}
        <div className={cn("w-full md:w-[300px] lg:w-[360px] md:flex-shrink-0 border-r border-border flex flex-col", activeVendor && "hidden md:flex")}>
          <div className="flex-1 overflow-y-auto">
            {vendors.map((v) => (
              <VendorListItem
                key={v.id}
                vendor={v}
                active={v.id === activeVendorId}
                onOpen={() => setActiveVendorId(v.id)}
              />
            ))}
            {vendors.length === 0 && (
              <p className="p-4 text-center text-sm text-muted-foreground">No vendors found.</p>
            )}
          </div>
          <div className="border-t border-border p-2">
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </div>
        </div>

        {/* Detail pane -- full width on mobile (replaces the list), flex-1 at md+. */}
        <div className={cn("flex-1 min-w-0", !activeVendor && "hidden md:flex md:items-center md:justify-center")}>
          {activeVendor ? (
            <VendorDetailPane
              vendor={activeVendor}
              onEdit={() => handleEdit(activeVendor)}
              onDelete={() => { setVendorToDelete(activeVendor); setDeleteDialogOpen(true) }}
              onRestore={() => handleRestore(activeVendor)}
              restoring={restoringId === activeVendor.id}
              onBack={() => setActiveVendorId(null)}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Select a vendor to view details.</p>
          )}
        </div>
      </div>

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
            <div className="bg-destructive/10 text-destructive text-sm px-4 py-3 rounded-lg mt-2">{error}</div>
          )}
          <div className="flex gap-3 mt-4">
            <Button
              className="flex-1 bg-primary hover:bg-primary/90"
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

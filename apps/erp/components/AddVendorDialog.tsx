'use client'

import { useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { VendorFormFields, emptyVendorForm, type VendorFormState } from '@/components/VendorFormFields'

export interface Vendor {
  id: string
  company_name: string
}

// Lets whoever is receiving/editing stock add a vendor on the spot if it's not in the
// dropdown yet, with the same fields as the owner's Vendors-page form -- POST
// /api/vendors forces supplies_accessories=true server-side for a non-owner caller and
// resolves by name against any existing vendor rather than risking a near-duplicate (see
// docs/decisions.md, 2026-08-24). The owner can still edit/delete it normally afterward
// from the Vendors page, which stays the only place to manage vendors beyond this.
export function AddVendorDialog({ onAdded, onClose }: { onAdded: (vendor: Vendor) => void; onClose: () => void }) {
  const [form, setForm] = useState<VendorFormState>(emptyVendorForm)
  const [fetchingGst, setFetchingGst] = useState(false)
  const [err, setErr] = useState('')

  const handleGstBlur = async () => {
    if (!form.gst_number || form.gst_number.length !== 15) return
    setFetchingGst(true)
    try {
      const res = await fetch(`/api/gst?gst=${form.gst_number}`)
      const data = await res.json()
      if (data.company_name) {
        setForm((prev) => ({ ...prev, gst_company_name: data.company_name, company_name: data.company_name }))
      } else {
        setErr('GST number not found. Please check.')
      }
    } catch {
      setErr('Failed to verify GST. Try again.')
    } finally {
      setFetchingGst(false)
    }
  }

  const { run: submit, pending: busy } = useAsyncAction(async () => {
    setErr('')
    if (!form.company_name.trim()) { setErr('Company Name is required.'); return }
    const res = await apiFetch('/api/vendors', {
      method: 'POST',
      body: JSON.stringify({
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
      }),
    })
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error || 'Failed to add vendor.'); return }
    onAdded(await res.json())
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Vendor</DialogTitle>
        </DialogHeader>
        <VendorFormFields
          form={form}
          onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
          fetchingGst={fetchingGst}
          onGstBlur={handleGstBlur}
        />
        {err && <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg mt-2">{err}</div>}
        <div className="flex gap-3 mt-4">
          <Button className="flex-1 bg-blue-600 hover:bg-blue-700" onClick={() => submit()} loading={busy}>
            Save Vendor
          </Button>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

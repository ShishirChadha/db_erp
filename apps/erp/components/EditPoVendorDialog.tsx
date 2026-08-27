'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'

interface Vendor {
  id: string
  company_name: string
}

// Corrects the vendor on a PO after creation (any status past draft). Same
// already_invoiced confirm flow as EditPoItemDialog/EditSaleDialog.
export function EditPoVendorDialog({
  poId,
  currentVendorId,
  onClose,
  onSaved,
}: {
  poId: string
  currentVendorId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [vendorId, setVendorId] = useState(currentVendorId)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch('/api/vendors').then((res) => res.json()).then(setVendors).catch(() => {})
  }, [])

  const { run: save, pending: saving } = useAsyncAction(async () => {
    setError('')
    const body = { vendor_id: vendorId, reason: reason || undefined }
    let res = await apiFetch(`/api/purchase-orders/${poId}`, { method: 'PATCH', body: JSON.stringify(body) })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      if (e.error_code === 'already_invoiced') {
        if (!confirm(`${e.error}\n\nProceed anyway?`)) return
        res = await apiFetch(`/api/purchase-orders/${poId}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...body, confirm_despite_invoice: true }),
        })
      }
      if (!res.ok) {
        const e2 = await res.json().catch(() => ({}))
        throw new Error(e2.error || 'Failed to save.')
      }
    }
    onSaved()
    onClose()
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Vendor</DialogTitle>
          <DialogDescription>Also updates the vendor on every unit already tied to this PO.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && <div className="text-red-600 text-sm">{error}</div>}
          <div>
            <Label>Vendor</Label>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="border p-2 w-full rounded text-sm">
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.company_name}</option>)}
            </select>
          </div>
          <div>
            <Label>Reason (optional)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being corrected?" rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => save()} disabled={saving || vendorId === currentVendorId} loading={saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

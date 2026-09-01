'use client'

import { useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { computeFromUnitPrice, computeFromLineTotal } from '@/lib/po-gst-calc'

interface POItemLite {
  id: string
  sku_id: string
  sku_code: string
  quantity: number
  unit_price: number
  gst_percentage: number
  notes?: string | null
  hsn_code?: string | null
}

// Corrects a mistaken quantity/price/GST% on one PO line item after creation. For a
// draft PO (no reservations/receipts yet) this routes through the existing full-item-
// replace PUT /api/purchase-orders/[id] -- for anything past draft it uses the new
// PATCH /api/purchase-orders/[id]/items/[itemId], which floors quantity at what's
// already received/serial-tagged and warns (matching EditSaleDialog's exact
// already_invoiced/confirm_despite_invoice flow) if a Purchase Invoice already exists.
export function EditPoItemDialog({
  poId,
  poStatus,
  item,
  allItems,
  onClose,
  onSaved,
}: {
  poId: string
  poStatus: string
  item: POItemLite
  allItems: POItemLite[]
  onClose: () => void
  onSaved: () => void
}) {
  const [quantity, setQuantity] = useState(item.quantity)
  const [unitPrice, setUnitPrice] = useState(item.unit_price)
  const [gstPercent, setGstPercent] = useState(item.gst_percentage)
  const [hsnCode, setHsnCode] = useState(item.hsn_code || '')
  const [lineTotalInput, setLineTotalInput] = useState(
    computeFromUnitPrice(item.unit_price, item.quantity, item.gst_percentage).lineTotal
  )
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  const isDraft = poStatus === 'draft'

  const recalc = (nextUnitPrice: number, nextQuantity: number, nextGstPercent: number) => {
    setLineTotalInput(computeFromUnitPrice(nextUnitPrice, nextQuantity, nextGstPercent).lineTotal)
  }
  const handleQuantityChange = (v: number) => { setQuantity(v); recalc(unitPrice, v, gstPercent) }
  const handleUnitPriceChange = (v: number) => { setUnitPrice(v); recalc(v, quantity, gstPercent) }
  const handleGstPercentChange = (v: number) => { setGstPercent(v); recalc(unitPrice, quantity, v) }
  const handleLineTotalChange = (v: number) => {
    setLineTotalInput(v)
    setUnitPrice(computeFromLineTotal(v, quantity, gstPercent).unitPrice)
  }

  // HSN code lives on sku_master, not on the PO item itself -- there's no per-line
  // override, so a correction here just edits the SKU's own HSN code directly
  // (same PUT /api/sku-master/[id] the SKU Master page uses), independent of the
  // PO's own status/draft-vs-not branching below.
  const saveHsnIfChanged = async () => {
    if (hsnCode === (item.hsn_code || '')) return
    const res = await apiFetch(`/api/sku-master/${item.sku_id}`, { method: 'PUT', body: JSON.stringify({ hsn_code: hsnCode }) })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      throw new Error(e.error || 'Failed to save HSN code.')
    }
  }

  const { run: save, pending: saving } = useAsyncAction(async () => {
    setError('')

    if (isDraft) {
      const items = allItems.map((i) =>
        i.id === item.id
          ? { sku_id: i.sku_id, quantity, base_price: unitPrice, gst_percentage: gstPercent, notes: i.notes || '' }
          : { sku_id: i.sku_id, quantity: i.quantity, base_price: i.unit_price, gst_percentage: i.gst_percentage, notes: i.notes || '' }
      )
      const res = await apiFetch(`/api/purchase-orders/${poId}`, { method: 'PUT', body: JSON.stringify({ items }) })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to save.')
      }
      await saveHsnIfChanged()
      onSaved()
      onClose()
      return
    }

    const body = { quantity, base_price: unitPrice, gst_percentage: gstPercent, reason: reason || undefined }
    let res = await apiFetch(`/api/purchase-orders/${poId}/items/${item.id}`, { method: 'PATCH', body: JSON.stringify(body) })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      if (e.error_code === 'already_invoiced') {
        if (!confirm(`${e.error}\n\nProceed anyway?`)) return
        res = await apiFetch(`/api/purchase-orders/${poId}/items/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...body, confirm_despite_invoice: true }),
        })
      }
      if (!res.ok) {
        const e2 = await res.json().catch(() => ({}))
        throw new Error(e2.error || 'Failed to save.')
      }
    }
    await saveHsnIfChanged()
    onSaved()
    onClose()
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Line Item</DialogTitle>
          <DialogDescription>{item.sku_code}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && <div className="text-destructive text-sm">{error}</div>}

          <div>
            <Label>Quantity</Label>
            <Input type="number" min={1} value={quantity} onChange={(e) => handleQuantityChange(Number(e.target.value))} />
          </div>
          <div>
            <Label>Unit Price (before GST) (₹)</Label>
            <Input type="number" value={unitPrice} onChange={(e) => handleUnitPriceChange(Number(e.target.value))} />
          </div>
          <div>
            <Label>GST %</Label>
            <Input type="number" value={gstPercent} onChange={(e) => handleGstPercentChange(Number(e.target.value))} className="w-32" />
          </div>
          <div>
            <Label>Line Total (incl. GST) (₹)</Label>
            <Input type="number" value={lineTotalInput} onChange={(e) => handleLineTotalChange(Number(e.target.value))} />
          </div>
          <div>
            <Label>HSN Code</Label>
            <Input value={hsnCode} onChange={(e) => setHsnCode(e.target.value)} placeholder="e.g. 8471" />
            <p className="text-xs text-muted-foreground mt-1">Belongs to the SKU, not just this PO -- correcting it here updates the SKU everywhere.</p>
          </div>

          {!isDraft && (
            <div>
              <Label>Reason (optional)</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being corrected?" rows={2} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => save()} disabled={saving} loading={saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

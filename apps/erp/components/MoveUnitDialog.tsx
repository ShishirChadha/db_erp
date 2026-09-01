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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'

interface PoSearchResult {
  id: string
  po_number: string
  vendor_name: string
  po_status: string
}

// Moves one already-attached serialized unit (e.g. "the 25th's laptop got put on the
// 10th's PO by mistake") onto a different existing PO -- pure paperwork, the unit's
// own status/asset number/serial never change. See
// /api/purchase-orders/[id]/move-unit for the mechanics.
export function MoveUnitDialog({
  sourcePoId,
  assetNumber,
  serialNumber,
  entryDate,
  skuLabel,
  onClose,
  onSaved,
}: {
  sourcePoId: string
  assetNumber: string
  serialNumber: string | null
  entryDate: string | null
  skuLabel: string
  onClose: () => void
  onSaved: () => void
}) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<PoSearchResult[]>([])
  const [selectedPo, setSelectedPo] = useState<PoSearchResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!search) { setResults([]); return }
    let cancelled = false
    const params = new URLSearchParams({ search, status: 'draft,submitted,partially_received,received,invoiced' })
    apiFetch(`/api/purchase-orders?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => !cancelled && setResults((Array.isArray(data) ? data : []).filter((po: PoSearchResult) => po.id !== sourcePoId).slice(0, 15)))
    return () => { cancelled = true }
  }, [search, sourcePoId])

  const { run: move, pending: moving } = useAsyncAction(async () => {
    setError('')
    if (!selectedPo) { setError('Select a PO to move this unit to.'); return }
    const body = { asset_number: assetNumber, target_po_id: selectedPo.id }
    let res = await apiFetch(`/api/purchase-orders/${sourcePoId}/move-unit`, { method: 'POST', body: JSON.stringify(body) })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      if (e.error_code === 'already_invoiced') {
        if (!confirm(`${e.error}\n\nProceed anyway?`)) return
        res = await apiFetch(`/api/purchase-orders/${sourcePoId}/move-unit`, {
          method: 'POST',
          body: JSON.stringify({ ...body, confirm_despite_invoice: true }),
        })
      }
      if (!res.ok) {
        const e2 = await res.json().catch(() => ({}))
        setError(e2.error || 'Failed to move unit.')
        return
      }
    }
    onSaved()
    onClose()
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Move Unit to Another PO</DialogTitle>
          <DialogDescription>
            {assetNumber} ({serialNumber || 'no serial'}) — {skuLabel}
            <br />
            Entry date: {entryDate ? entryDate.slice(0, 10) : 'unknown'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {error && <div className="text-destructive text-sm">{error}</div>}

          {selectedPo ? (
            <div className="flex items-center justify-between border rounded p-2 text-sm bg-muted">
              <span>{selectedPo.po_number} — {selectedPo.vendor_name}</span>
              <button onClick={() => setSelectedPo(null)} className="text-xs text-muted-foreground underline">Change</button>
            </div>
          ) : (
            <div>
              <Label>Move to PO</Label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search PO number..." />
              {results.length > 0 && (
                <div className="border rounded max-h-40 overflow-y-auto mt-1">
                  {results.map((po) => (
                    <button
                      key={po.id}
                      onClick={() => { setSelectedPo(po); setResults([]) }}
                      className="block w-full text-left px-2 py-1 text-xs hover:bg-muted border-b last:border-b-0"
                    >
                      {po.po_number} — {po.vendor_name} ({po.po_status.replace(/_/g, ' ')})
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={moving}>Cancel</Button>
          <Button onClick={() => move()} disabled={!selectedPo || moving} loading={moving}>
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

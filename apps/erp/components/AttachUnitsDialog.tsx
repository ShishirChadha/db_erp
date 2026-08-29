'use client'

import { useEffect, useMemo, useState } from 'react'
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
import { Checkbox } from '@/components/ui/checkbox'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { computeFromUnitPrice, computeFromLineTotal } from '@/lib/po-gst-calc'

interface EligibleUnit {
  id: string
  asset_number: string | null
  serial_number: string | null
  sku_id: string
  sku_code: string
  description: string
}

// Attaches unit(s) already sitting in stock (employee-intake, never on a PO) onto an
// already-created PO -- e.g. "I forgot one laptop when I made this PO." Distinct from
// Live Stock's "Create PO from Selected", which only ever builds a brand-new PO.
export function AttachUnitsDialog({
  poId,
  onClose,
  onSaved,
}: {
  poId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<EligibleUnit[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Map<string, EligibleUnit>>(new Map())
  const [costInputs, setCostInputs] = useState<Record<string, { cost_price: string; gst_percentage: string; line_total: string }>>({})
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    params.set('source', 'employee_intake')
    apiFetch(`/api/stock?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: any[]) => {
        if (cancelled) return
        const eligible = (data || [])
          .filter((u) => u.po_id === null)
          .map((u) => ({
            id: u.id,
            asset_number: u.asset_number,
            serial_number: u.serial_number,
            sku_id: u.sku_id,
            sku_code: u.sku_code || '',
            description: u.description || '',
          }))
        setResults(eligible)
      })
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [search])

  const toggle = (unit: EligibleUnit) => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(unit.id)) next.delete(unit.id)
      else next.set(unit.id, unit)
      return next
    })
  }

  const skuGroups = useMemo(() => {
    const groups = new Map<string, { sku_code: string; description: string; units: EligibleUnit[] }>()
    for (const unit of selected.values()) {
      if (!groups.has(unit.sku_id)) groups.set(unit.sku_id, { sku_code: unit.sku_code, description: unit.description, units: [] })
      groups.get(unit.sku_id)!.units.push(unit)
    }
    return groups
  }, [selected])

  const getCostInput = (skuId: string) => costInputs[skuId] || { cost_price: '', gst_percentage: '18', line_total: '' }

  const updateCostPrice = (skuId: string, qty: number, value: string) => {
    const current = getCostInput(skuId)
    const gstPct = Number(current.gst_percentage) || 0
    const { lineTotal } = computeFromUnitPrice(Number(value) || 0, qty, gstPct)
    setCostInputs((prev) => ({ ...prev, [skuId]: { cost_price: value, gst_percentage: current.gst_percentage, line_total: lineTotal ? lineTotal.toFixed(2) : '' } }))
  }
  const updateGstPercentage = (skuId: string, qty: number, value: string) => {
    const current = getCostInput(skuId)
    const price = Number(current.cost_price) || 0
    const { lineTotal } = computeFromUnitPrice(price, qty, Number(value) || 0)
    setCostInputs((prev) => ({ ...prev, [skuId]: { cost_price: current.cost_price, gst_percentage: value, line_total: lineTotal ? lineTotal.toFixed(2) : '' } }))
  }
  const updateLineTotal = (skuId: string, qty: number, value: string) => {
    const current = getCostInput(skuId)
    const gstPct = Number(current.gst_percentage) || 0
    const { unitPrice } = computeFromLineTotal(Number(value) || 0, qty, gstPct)
    setCostInputs((prev) => ({ ...prev, [skuId]: { cost_price: unitPrice ? unitPrice.toFixed(2) : '', gst_percentage: current.gst_percentage, line_total: value } }))
  }

  const { run: attach, pending: attaching } = useAsyncAction(async () => {
    setError('')
    const cost_inputs = [...skuGroups.entries()].map(([skuId]) => {
      const c = getCostInput(skuId)
      return { sku_id: skuId, cost_price: Number(c.cost_price) || 0, gst_percentage: Number(c.gst_percentage) || 0 }
    })
    const body = { asset_ledger_ids: [...selected.keys()], cost_inputs }
    let res = await apiFetch(`/api/purchase-orders/${poId}/attach-units`, { method: 'POST', body: JSON.stringify(body) })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      if (e.error_code === 'already_invoiced') {
        if (!confirm(`${e.error}\n\nProceed anyway?`)) return
        res = await apiFetch(`/api/purchase-orders/${poId}/attach-units`, {
          method: 'POST',
          body: JSON.stringify({ ...body, confirm_despite_invoice: true }),
        })
      }
      if (!res.ok) {
        const e2 = await res.json().catch(() => ({}))
        setError(e2.error || 'Failed to attach units.')
        return
      }
    }
    onSaved()
    onClose()
  })

  const canSubmit = selected.size > 0 && [...skuGroups.keys()].every((skuId) => {
    const c = getCostInput(skuId)
    return Number(c.cost_price) > 0 && c.gst_percentage !== ''
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Units from Stock</DialogTitle>
          <DialogDescription>
            Search for a unit already in stock (not yet on any PO) and attach it to this PO.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && <div className="text-red-600 text-sm">{error}</div>}

          <div>
            <Label>Search by serial number, model, or description</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. serial number" />
          </div>

          <div className="border rounded max-h-48 overflow-y-auto">
            {loading && <div className="p-2 text-sm text-gray-500">Searching...</div>}
            {!loading && results.length === 0 && (
              <div className="p-2 text-sm text-gray-500">
                {search ? 'No eligible units found (already on a PO, or not yet in stock).' : 'Type to search.'}
              </div>
            )}
            {results.map((u) => (
              <label key={u.id} className="flex items-center gap-2 p-2 border-b last:border-b-0 hover:bg-gray-50 cursor-pointer text-sm">
                <Checkbox checked={selected.has(u.id)} onCheckedChange={() => toggle(u)} />
                <div>
                  <div className="font-medium">{u.serial_number || '(no serial)'} — {u.sku_code}</div>
                  <div className="text-xs text-gray-500">{u.description}</div>
                </div>
              </label>
            ))}
          </div>

          {skuGroups.size > 0 && (
            <div className="space-y-3">
              <div className="text-sm font-medium">Purchase cost for selected unit(s)</div>
              {[...skuGroups.entries()].map(([skuId, group]) => {
                const c = getCostInput(skuId)
                return (
                  <div key={skuId} className="border rounded p-2 space-y-2">
                    <div className="text-sm">{group.sku_code} ({group.units.length} unit{group.units.length > 1 ? 's' : ''})</div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label className="text-xs">Unit Price (before GST) (₹)</Label>
                        <Input type="number" value={c.cost_price} onChange={(e) => updateCostPrice(skuId, group.units.length, e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs">GST %</Label>
                        <Input type="number" value={c.gst_percentage} onChange={(e) => updateGstPercentage(skuId, group.units.length, e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs">Line Total (incl. GST) (₹)</Label>
                        <Input type="number" value={c.line_total} onChange={(e) => updateLineTotal(skuId, group.units.length, e.target.value)} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={attaching}>Cancel</Button>
          <Button onClick={() => attach()} disabled={!canSubmit || attaching} loading={attaching}>
            Attach {selected.size > 0 ? `(${selected.size})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

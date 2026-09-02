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
  entry_date: string | null
  status: string
}

interface AccessoryBacklogEntry {
  sku_id: string
  full_sku_code: string
  sku_description: string
  category: string
  quantity: number
}

// Attaches stock already sitting in the warehouse (never on a PO) onto an
// already-created PO -- e.g. "I forgot one laptop when I made this PO," or "the RAM
// on this invoice never got its own line." Distinct from Live Stock's "Create PO from
// Selected", which only ever builds a brand-new PO. Serialized units (laptops etc.,
// one asset_ledger row each) and fungible accessory backlog (quantity-only, no
// per-unit row -- see /api/purchase-orders/from-accessory-stock) are two different
// underlying mechanisms, but this dialog surfaces both in one search so "add
// everything on this invoice that isn't on the PO yet" is one action either way.
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

  const [accessoryBacklog, setAccessoryBacklog] = useState<AccessoryBacklogEntry[]>([])
  const [selectedAccessorySkuIds, setSelectedAccessorySkuIds] = useState<Set<string>>(new Set())

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
            entry_date: u.created_at || null,
            status: u.status || '',
          }))
        setResults(eligible)
      })
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [search])

  // Accessory backlog is a short list (SKUs with any unattached receipt) -- fetched
  // once and filtered client-side as the owner types, rather than a request per
  // keystroke like the serialized search above.
  useEffect(() => {
    apiFetch('/api/purchase-orders/from-accessory-stock')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: AccessoryBacklogEntry[]) => setAccessoryBacklog(Array.isArray(data) ? data : []))
      .catch(() => setAccessoryBacklog([]))
  }, [])

  const filteredAccessoryBacklog = useMemo(() => {
    if (!search) return accessoryBacklog
    const term = search.toLowerCase()
    return accessoryBacklog.filter((b) =>
      b.full_sku_code.toLowerCase().includes(term) || b.sku_description.toLowerCase().includes(term)
    )
  }, [accessoryBacklog, search])

  const toggle = (unit: EligibleUnit) => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(unit.id)) next.delete(unit.id)
      else next.set(unit.id, unit)
      return next
    })
  }

  const toggleAccessory = (skuId: string) => {
    setSelectedAccessorySkuIds((prev) => {
      const next = new Set(prev)
      if (next.has(skuId)) next.delete(skuId)
      else next.add(skuId)
      return next
    })
  }

  const unitSkuGroups = useMemo(() => {
    const groups = new Map<string, { sku_code: string; description: string; quantity: number }>()
    for (const unit of selected.values()) {
      if (!groups.has(unit.sku_id)) groups.set(unit.sku_id, { sku_code: unit.sku_code, description: unit.description, quantity: 0 })
      groups.get(unit.sku_id)!.quantity += 1
    }
    return groups
  }, [selected])

  const accessoryGroups = useMemo(() => {
    const groups = new Map<string, { sku_code: string; description: string; quantity: number }>()
    for (const skuId of selectedAccessorySkuIds) {
      const entry = accessoryBacklog.find((b) => b.sku_id === skuId)
      if (entry) groups.set(skuId, { sku_code: entry.full_sku_code, description: entry.sku_description, quantity: entry.quantity })
    }
    return groups
  }, [selectedAccessorySkuIds, accessoryBacklog])

  const allGroups = useMemo(() => new Map([...unitSkuGroups, ...accessoryGroups]), [unitSkuGroups, accessoryGroups])

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
    let confirmedInvoice = false

    const callEndpoint = async (path: string, body: Record<string, unknown>) => {
      let res = await apiFetch(path, { method: 'POST', body: JSON.stringify({ ...body, ...(confirmedInvoice ? { confirm_despite_invoice: true } : {}) }) })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        if (e.error_code === 'already_invoiced' && !confirmedInvoice) {
          if (!confirm(`${e.error}\n\nProceed anyway?`)) throw new Error('__cancelled__')
          confirmedInvoice = true
          res = await apiFetch(path, { method: 'POST', body: JSON.stringify({ ...body, confirm_despite_invoice: true }) })
        }
        if (!res.ok) {
          const e2 = await res.json().catch(() => ({}))
          throw new Error(e2.error || 'Failed to attach.')
        }
      }
    }

    try {
      if (selected.size > 0) {
        const cost_inputs = [...unitSkuGroups.keys()].map((skuId) => {
          const c = getCostInput(skuId)
          return { sku_id: skuId, cost_price: Number(c.cost_price) || 0, gst_percentage: Number(c.gst_percentage) || 0 }
        })
        await callEndpoint(`/api/purchase-orders/${poId}/attach-units`, { asset_ledger_ids: [...selected.keys()], cost_inputs })
      }
      for (const skuId of selectedAccessorySkuIds) {
        const c = getCostInput(skuId)
        await callEndpoint(`/api/purchase-orders/${poId}/attach-accessory-stock`, {
          sku_id: skuId, cost_price: Number(c.cost_price) || 0, gst_percentage: Number(c.gst_percentage) || 0,
        })
      }
    } catch (e: any) {
      if (e.message === '__cancelled__') return
      setError(e.message || 'Failed to attach.')
      return
    }

    onSaved()
    onClose()
  })

  const totalSelected = selected.size + selectedAccessorySkuIds.size
  const canSubmit = totalSelected > 0 && [...allGroups.keys()].every((skuId) => {
    const c = getCostInput(skuId)
    return Number(c.cost_price) > 0 && c.gst_percentage !== ''
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Units from Stock</DialogTitle>
          <DialogDescription>
            Search for a laptop/desktop unit or an accessory SKU already in stock (not yet on any PO) and attach it to this PO.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && <div className="text-destructive text-sm">{error}</div>}

          <div>
            <Label>Search by serial number, model, or description</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. serial number or RAM" />
          </div>

          <div className="border rounded max-h-48 overflow-y-auto">
            {loading && <div className="p-2 text-sm text-muted-foreground">Searching...</div>}
            {!loading && results.length === 0 && filteredAccessoryBacklog.length === 0 && (
              <div className="p-2 text-sm text-muted-foreground">
                {search ? 'No eligible units found (already on a PO, or not yet in stock).' : 'Type to search.'}
              </div>
            )}
            {results.map((u) => (
              <label key={u.id} className="flex items-center gap-2 p-2 border-b last:border-b-0 hover:bg-muted cursor-pointer text-sm">
                <Checkbox checked={selected.has(u.id)} onCheckedChange={() => toggle(u)} />
                <div>
                  <div className="font-medium">
                    {u.serial_number || '(no serial)'} — {u.sku_code}
                    <span className="text-xs text-muted-foreground font-normal">
                      {' '}· entry {u.entry_date ? u.entry_date.slice(0, 10) : 'unknown'}
                      {u.status ? ` · ${u.status.replace(/_/g, ' ')}` : ''}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">{u.description}</div>
                </div>
              </label>
            ))}
            {filteredAccessoryBacklog.map((b) => (
              <label key={b.sku_id} className="flex items-center gap-2 p-2 border-b last:border-b-0 hover:bg-muted cursor-pointer text-sm">
                <Checkbox checked={selectedAccessorySkuIds.has(b.sku_id)} onCheckedChange={() => toggleAccessory(b.sku_id)} />
                <div>
                  <div className="font-medium">{b.quantity} × {b.full_sku_code} <span className="text-xs text-warning">(accessory backlog)</span></div>
                  <div className="text-xs text-muted-foreground">{b.sku_description}</div>
                </div>
              </label>
            ))}
          </div>

          {allGroups.size > 0 && (
            <div className="space-y-3">
              <div className="text-sm font-medium">Purchase cost for selected stock</div>
              {[...allGroups.entries()].map(([skuId, group]) => {
                const c = getCostInput(skuId)
                return (
                  <div key={skuId} className="border rounded p-2 space-y-2">
                    <div className="text-sm">{group.sku_code} ({group.quantity} unit{group.quantity > 1 ? 's' : ''})</div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label className="text-xs">Unit Price (before GST) (₹)</Label>
                        <Input type="number" value={c.cost_price} onChange={(e) => updateCostPrice(skuId, group.quantity, e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs">GST %</Label>
                        <Input type="number" value={c.gst_percentage} onChange={(e) => updateGstPercentage(skuId, group.quantity, e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs">Line Total (incl. GST) (₹)</Label>
                        <Input type="number" value={c.line_total} onChange={(e) => updateLineTotal(skuId, group.quantity, e.target.value)} />
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
            Attach {totalSelected > 0 ? `(${totalSelected})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

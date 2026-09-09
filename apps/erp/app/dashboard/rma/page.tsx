'use client'

import { useEffect, useState, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import RequirePageAccess from '@/components/RequirePageAccess'

interface RmaEvent {
  id: string
  asset_id: string
  direction: 'to_vendor' | 'from_customer'
  reason: string
  vendor_id: string | null
  status: string
  opened_at: string
  closed_at: string | null
  notes: string | null
  asset_ledger: { asset_number: string; serial_number: string | null; status: string } | null
  vendors: { company_name: string } | null
}

interface Vendor {
  id: string
  company_name: string
}

interface StockAsset {
  id: string
  asset_number: string
  serial_number: string | null
  status: string
  sku_code: string
}

// Accessories are sku_master rows like everything else (see docs/decisions.md,
// 2026-07-23), tracked by quantity alone -- no per-unit asset_ledger row, so an
// accessory RMA event is keyed on sku_id + quantity instead of asset_id.
const ACCESSORY_CATEGORIES = ['RAM', 'SSD', 'CPU', 'GPU', 'KBD', 'MOUSE', 'ACC', 'ADP']

interface AccessoryRmaEvent {
  id: string
  sku_id: string
  quantity: number
  direction: 'to_vendor' | 'from_customer'
  reason: string
  vendor_id: string | null
  status: string
  opened_at: string
  closed_at: string | null
  notes: string | null
  sku_master: { full_sku_code: string; sku_description: string | null; category: string } | null
  vendors: { company_name: string } | null
}

interface AccessorySkuOption {
  id: string
  full_sku_code: string
  sku_description: string | null
  quantity_in_stock: number
}

const NEXT_STATUS_OPTIONS: Record<string, string[]> = {
  initiated: ['shipped', 'vendor_accepted', 'vendor_rejected'],
  shipped: ['vendor_accepted', 'vendor_rejected'],
  vendor_accepted: ['replacement_received', 'refund_received'],
}

// 'initiated' means different things depending on direction -- a to_vendor case still
// needs to go through the vendor funnel, a from_customer case already moved stock at
// open and just needs its outcome recorded -- so this is keyed on direction, unlike
// NEXT_STATUS_OPTIONS above (units only ever go to_vendor through this same funnel).
function accessoryNextStatuses(direction: 'to_vendor' | 'from_customer', status: string): string[] {
  if (direction === 'from_customer') {
    return status === 'initiated' ? ['restocked', 'scrapped'] : []
  }
  if (status === 'initiated') return ['shipped', 'vendor_accepted', 'vendor_rejected']
  if (status === 'shipped') return ['vendor_accepted', 'vendor_rejected']
  if (status === 'vendor_accepted') return ['replacement_received', 'refund_received']
  return []
}

function RmaPage() {
  const [itemKind, setItemKind] = useState<'unit' | 'accessory'>('unit')

  const [events, setEvents] = useState<RmaEvent[]>([])
  const [accessoryEvents, setAccessoryEvents] = useState<AccessoryRmaEvent[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [directionFilter, setDirectionFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)

  // create-form state (serialized unit)
  const [direction, setDirection] = useState<'to_vendor' | 'from_customer'>('to_vendor')
  const [assetSearch, setAssetSearch] = useState('')
  const [assetResults, setAssetResults] = useState<StockAsset[]>([])
  const [selectedAsset, setSelectedAsset] = useState<StockAsset | null>(null)
  const [reason, setReason] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // create-form state (accessory)
  const [accessoryDirection, setAccessoryDirection] = useState<'to_vendor' | 'from_customer'>('to_vendor')
  const [skuSearch, setSkuSearch] = useState('')
  const [skuResults, setSkuResults] = useState<AccessorySkuOption[]>([])
  const [selectedSku, setSelectedSku] = useState<AccessorySkuOption | null>(null)
  const [accessoryQty, setAccessoryQty] = useState<number | ''>('')
  const [accessoryReason, setAccessoryReason] = useState('')
  const [accessoryVendorId, setAccessoryVendorId] = useState('')
  const [accessoryNotes, setAccessoryNotes] = useState('')
  const [accessorySaving, setAccessorySaving] = useState(false)

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (directionFilter) params.append('direction', directionFilter)
    if (statusFilter) params.append('status', statusFilter)
    const res = await apiFetch(`/api/rma?${params.toString()}`)
    if (res.ok) setEvents(await res.json())
    setLoading(false)
  }, [directionFilter, statusFilter])

  const fetchAccessoryEvents = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (directionFilter) params.append('direction', directionFilter)
    if (statusFilter) params.append('status', statusFilter)
    const res = await apiFetch(`/api/accessory-rma?${params.toString()}`)
    if (res.ok) setAccessoryEvents(await res.json())
    setLoading(false)
  }, [directionFilter, statusFilter])

  useEffect(() => {
    if (itemKind === 'unit') fetchEvents()
    else fetchAccessoryEvents()
  }, [itemKind, fetchEvents, fetchAccessoryEvents])

  useEffect(() => {
    apiFetch('/api/vendors').then(async (res) => {
      if (res.ok) setVendors(await res.json())
    })
  }, [])

  useEffect(() => {
    if (!modalOpen) return
    const eligibleStatus = direction === 'to_vendor' ? 'faulty' : 'sold'
    const t = setTimeout(async () => {
      const params = new URLSearchParams({ status: eligibleStatus })
      if (assetSearch) params.append('search', assetSearch)
      const res = await apiFetch(`/api/stock?${params.toString()}`)
      if (res.ok) setAssetResults(await res.json())
    }, 300)
    return () => clearTimeout(t)
  }, [assetSearch, direction, modalOpen])

  useEffect(() => {
    if (!modalOpen || itemKind !== 'accessory') return
    const t = setTimeout(async () => {
      const params = new URLSearchParams({ category: ACCESSORY_CATEGORIES.join(',') })
      if (skuSearch) params.set('search', skuSearch)
      const res = await apiFetch(`/api/sku-master?${params.toString()}`)
      if (res.ok) setSkuResults(await res.json())
    }, 300)
    return () => clearTimeout(t)
  }, [skuSearch, modalOpen, itemKind])

  const resetAccessoryForm = () => {
    setAccessoryDirection('to_vendor')
    setSkuSearch('')
    setSkuResults([])
    setSelectedSku(null)
    setAccessoryQty('')
    setAccessoryReason('')
    setAccessoryVendorId('')
    setAccessoryNotes('')
  }

  const submitAccessoryRma = async () => {
    if (!selectedSku || !accessoryReason || !accessoryQty || accessoryQty <= 0) {
      alert('Select an accessory, enter a quantity, and enter a reason')
      return
    }
    setAccessorySaving(true)
    try {
      const res = await apiFetch('/api/accessory-rma', {
        method: 'POST',
        body: JSON.stringify({
          sku_id: selectedSku.id,
          quantity: accessoryQty,
          direction: accessoryDirection,
          reason: accessoryReason,
          vendor_id: accessoryDirection === 'to_vendor' ? accessoryVendorId || null : null,
          notes: accessoryNotes || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Failed to open accessory RMA')
        return
      }
      setModalOpen(false)
      fetchAccessoryEvents()
    } finally {
      setAccessorySaving(false)
    }
  }

  const resetForm = () => {
    setDirection('to_vendor')
    setAssetSearch('')
    setAssetResults([])
    setSelectedAsset(null)
    setReason('')
    setVendorId('')
    setNotes('')
  }

  const openModal = () => {
    if (itemKind === 'unit') resetForm()
    else resetAccessoryForm()
    setModalOpen(true)
  }

  const submitRma = async () => {
    if (!selectedAsset || !reason) {
      alert('Select an asset and enter a reason')
      return
    }
    setSaving(true)
    try {
      const res = await apiFetch('/api/rma', {
        method: 'POST',
        body: JSON.stringify({
          asset_id: selectedAsset.id,
          direction,
          reason,
          vendor_id: direction === 'to_vendor' ? vendorId || null : null,
          notes: notes || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Failed to open RMA')
        return
      }
      setModalOpen(false)
      fetchEvents()
    } finally {
      setSaving(false)
    }
  }

  const [advancingKey, setAdvancingKey] = useState<string | null>(null)
  const advanceStatus = async (event: RmaEvent, newStatus: string) => {
    if (advancingKey) return
    setAdvancingKey(`${event.id}:${newStatus}`)
    try {
      const res = await apiFetch(`/api/rma/${event.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Failed to update RMA')
        return
      }
      fetchEvents()
    } finally {
      setAdvancingKey(null)
    }
  }

  const advanceAccessoryStatus = async (event: AccessoryRmaEvent, newStatus: string) => {
    if (advancingKey) return
    setAdvancingKey(`${event.id}:${newStatus}`)
    try {
      const res = await apiFetch(`/api/accessory-rma/${event.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Failed to update accessory RMA')
        return
      }
      fetchAccessoryEvents()
    } finally {
      setAdvancingKey(null)
    }
  }

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">RMA / Returns</h1>
        <button onClick={openModal} className="bg-primary text-primary-foreground px-4 py-2 rounded">
          + New RMA
        </button>
      </div>

      <div className="flex gap-2 mb-4 border-b">
        <button
          onClick={() => setItemKind('unit')}
          className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${itemKind === 'unit' ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`}
        >
          Units
        </button>
        <button
          onClick={() => setItemKind('accessory')}
          className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${itemKind === 'accessory' ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`}
        >
          Accessories
        </button>
      </div>

      <div className="flex gap-4 mb-4">
        <select value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)} className="border p-2 rounded">
          <option value="">All Directions</option>
          <option value="to_vendor">To Vendor</option>
          <option value="from_customer">From Customer</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border p-2 rounded">
          <option value="">All Statuses</option>
          <option value="initiated">Initiated</option>
          <option value="shipped">Shipped</option>
          <option value="vendor_accepted">Vendor Accepted</option>
          <option value="vendor_rejected">Vendor Rejected</option>
          <option value="replacement_received">Replacement Received</option>
          <option value="refund_received">Refund Received</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {loading ? (
        <div>Loading…</div>
      ) : itemKind === 'unit' ? (
        <table className="min-w-full border text-sm">
          <thead>
            <tr>
              <th className="border p-2">Opened</th>
              <th className="border p-2">Asset</th>
              <th className="border p-2">Direction</th>
              <th className="border p-2">Reason</th>
              <th className="border p-2">Vendor</th>
              <th className="border p-2">Status</th>
              <th className="border p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="border p-2">{new Date(e.opened_at).toLocaleDateString()}</td>
                <td className="border p-2">
                  {e.asset_ledger?.asset_number} {e.asset_ledger?.serial_number ? `(${e.asset_ledger.serial_number})` : ''}
                </td>
                <td className="border p-2 capitalize">{e.direction.replace('_', ' ')}</td>
                <td className="border p-2">{e.reason}</td>
                <td className="border p-2">{e.vendors?.company_name || '—'}</td>
                <td className="border p-2 capitalize">{e.status.replace(/_/g, ' ')}</td>
                <td className="border p-2 space-x-2">
                  {(NEXT_STATUS_OPTIONS[e.status] || []).map((next) => (
                    <button
                      key={next}
                      onClick={() => advanceStatus(e, next)}
                      disabled={!!advancingKey}
                      className="text-primary underline text-xs capitalize inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      {advancingKey === `${e.id}:${next}` && <Loader2 className="size-3 animate-spin" />}
                      {next.replace(/_/g, ' ')}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="min-w-full border text-sm">
          <thead>
            <tr>
              <th className="border p-2">Opened</th>
              <th className="border p-2">Accessory</th>
              <th className="border p-2">Qty</th>
              <th className="border p-2">Direction</th>
              <th className="border p-2">Reason</th>
              <th className="border p-2">Vendor</th>
              <th className="border p-2">Status</th>
              <th className="border p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {accessoryEvents.map((e) => (
              <tr key={e.id}>
                <td className="border p-2">{new Date(e.opened_at).toLocaleDateString()}</td>
                <td className="border p-2">{e.sku_master?.full_sku_code} {e.sku_master?.sku_description ? `— ${e.sku_master.sku_description}` : ''}</td>
                <td className="border p-2 text-right tabular-nums">{e.quantity}</td>
                <td className="border p-2 capitalize">{e.direction.replace('_', ' ')}</td>
                <td className="border p-2">{e.reason}</td>
                <td className="border p-2">{e.vendors?.company_name || '—'}</td>
                <td className="border p-2 capitalize">{e.status.replace(/_/g, ' ')}</td>
                <td className="border p-2 space-x-2">
                  {accessoryNextStatuses(e.direction, e.status).map((next) => (
                    <button
                      key={next}
                      onClick={() => advanceAccessoryStatus(e, next)}
                      disabled={!!advancingKey}
                      className="text-primary underline text-xs capitalize inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      {advancingKey === `${e.id}:${next}` && <Loader2 className="size-3 animate-spin" />}
                      {next.replace(/_/g, ' ')}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modalOpen && itemKind === 'unit' && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg p-6 w-full max-w-lg">
            <h2 className="text-lg font-bold mb-4">New RMA</h2>

            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">Direction</label>
              <select
                value={direction}
                onChange={(e) => { setDirection(e.target.value as 'to_vendor' | 'from_customer'); setSelectedAsset(null); setAssetResults([]) }}
                className="border p-2 w-full rounded"
              >
                <option value="to_vendor">To Vendor (faulty stock)</option>
                <option value="from_customer">From Customer (post-sale return)</option>
              </select>
            </div>

            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">
                Asset ({direction === 'to_vendor' ? 'faulty' : 'sold'} units only)
              </label>
              {selectedAsset ? (
                <div className="flex items-center justify-between border p-2 rounded bg-muted">
                  <span>{selectedAsset.asset_number} — {selectedAsset.sku_code}</span>
                  <button onClick={() => setSelectedAsset(null)} className="text-destructive text-xs underline">Change</button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Search asset or serial number..."
                    value={assetSearch}
                    onChange={(e) => setAssetSearch(e.target.value)}
                    className="border p-2 w-full rounded"
                  />
                  {assetResults.length > 0 && (
                    <div className="border rounded mt-1 max-h-40 overflow-y-auto">
                      {assetResults.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => setSelectedAsset(a)}
                          className="block w-full text-left px-2 py-1 hover:bg-muted text-sm"
                        >
                          {a.asset_number} — {a.sku_code} {a.serial_number ? `(${a.serial_number})` : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {direction === 'to_vendor' && (
              <div className="mb-3">
                <label className="block text-sm font-medium mb-1">Vendor</label>
                <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="border p-2 w-full rounded">
                  <option value="">Select vendor...</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.company_name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">Reason</label>
              <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} className="border p-2 w-full rounded" />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="border p-2 w-full rounded" />
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 border rounded">Cancel</button>
              <button
                onClick={submitRma}
                disabled={saving}
                className="bg-primary text-primary-foreground px-4 py-2 rounded disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Open RMA'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalOpen && itemKind === 'accessory' && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg p-6 w-full max-w-lg">
            <h2 className="text-lg font-bold mb-4">New Accessory RMA</h2>

            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">Direction</label>
              <select
                value={accessoryDirection}
                onChange={(e) => setAccessoryDirection(e.target.value as 'to_vendor' | 'from_customer')}
                className="border p-2 w-full rounded"
              >
                <option value="to_vendor">To Vendor (faulty stock)</option>
                <option value="from_customer">From Customer (post-sale return)</option>
              </select>
            </div>

            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">Accessory</label>
              {selectedSku ? (
                <div className="flex items-center justify-between border p-2 rounded bg-muted">
                  <span>{selectedSku.full_sku_code} {selectedSku.sku_description ? `— ${selectedSku.sku_description}` : ''} ({selectedSku.quantity_in_stock} in stock)</span>
                  <button onClick={() => setSelectedSku(null)} className="text-destructive text-xs underline">Change</button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Search accessory..."
                    value={skuSearch}
                    onChange={(e) => setSkuSearch(e.target.value)}
                    className="border p-2 w-full rounded"
                  />
                  {skuResults.length > 0 && (
                    <div className="border rounded mt-1 max-h-40 overflow-y-auto">
                      {skuResults.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setSelectedSku(s)}
                          className="block w-full text-left px-2 py-1 hover:bg-muted text-sm"
                        >
                          {s.full_sku_code} {s.sku_description ? `— ${s.sku_description}` : ''} ({s.quantity_in_stock} in stock)
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">Quantity</label>
              <input
                type="number"
                min={1}
                value={accessoryQty}
                onChange={(e) => setAccessoryQty(e.target.value === '' ? '' : Number(e.target.value))}
                className="border p-2 w-full rounded"
              />
            </div>

            {accessoryDirection === 'to_vendor' && (
              <div className="mb-3">
                <label className="block text-sm font-medium mb-1">Vendor</label>
                <select value={accessoryVendorId} onChange={(e) => setAccessoryVendorId(e.target.value)} className="border p-2 w-full rounded">
                  <option value="">Select vendor...</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.company_name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">Reason</label>
              <input type="text" value={accessoryReason} onChange={(e) => setAccessoryReason(e.target.value)} className="border p-2 w-full rounded" />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea value={accessoryNotes} onChange={(e) => setAccessoryNotes(e.target.value)} className="border p-2 w-full rounded" />
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 border rounded">Cancel</button>
              <button
                onClick={submitAccessoryRma}
                disabled={accessorySaving}
                className="bg-primary text-primary-foreground px-4 py-2 rounded disabled:opacity-50"
              >
                {accessorySaving ? 'Saving…' : 'Open RMA'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function RmaPageGuarded() {
  return (
    <RequirePageAccess pageKey="rma">
      <RmaPage />
    </RequirePageAccess>
  )
}

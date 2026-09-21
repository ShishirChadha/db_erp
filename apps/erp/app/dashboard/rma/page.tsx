'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Loader2, ArrowLeft } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import RequirePageAccess from '@/components/RequirePageAccess'
import { StatusBadge } from '@/components/StatusBadge'
import { toneFor } from '@/lib/status-styles'
import type { Tone } from '@/lib/status-styles'
import { cn } from '@/lib/utils'

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

// Every RMA status across both unit and accessory flows, mapped to a semantic
// tone for the shared StatusBadge -- unrecognized/legacy statuses fall back to
// "neutral" via toneFor's own default rather than throwing.
const RMA_STATUS_TONES: Record<string, Tone> = {
  initiated: 'warning',
  shipped: 'info',
  vendor_accepted: 'info',
  vendor_rejected: 'danger',
  replacement_received: 'success',
  refund_received: 'success',
  restocked: 'success',
  scrapped: 'danger',
  closed: 'neutral',
}

// One unified, chronologically-sorted feed mixing unit and accessory RMAs (see
// task doc) -- each entry keeps its original row plus a `kind` discriminant so
// the detail pane can branch on which set of fields/actions applies, without a
// second parallel table/page. Falls back to a segmented Units/Accessories view
// would have needed a second API call pattern anyway; merging client-side here
// costs nothing extra since both /api/rma and /api/accessory-rma are already
// cheap, filtered lists.
type MergedRma =
  | { kind: 'unit'; id: string; opened_at: string; direction: 'to_vendor' | 'from_customer'; status: string; vendorName: string | null; unit: RmaEvent }
  | { kind: 'accessory'; id: string; opened_at: string; direction: 'to_vendor' | 'from_customer'; status: string; vendorName: string | null; accessory: AccessoryRmaEvent }

function itemLabel(m: MergedRma): string {
  if (m.kind === 'unit') {
    const u = m.unit
    return u.asset_ledger?.asset_number
      ? `${u.asset_ledger.asset_number}${u.asset_ledger.serial_number ? ` · SN: ${u.asset_ledger.serial_number}` : ''}`
      : (u.asset_ledger?.serial_number ? `SN: ${u.asset_ledger.serial_number}` : 'Unit')
  }
  const a = m.accessory
  const code = a.sku_master?.full_sku_code || 'Accessory'
  return `${code} ×${a.quantity}`
}

// One field in the detail pane's label/value grid -- mirrors Sales Ledger's
// Field helper so both master-detail pages read the same way.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5 border-b border-border grid grid-cols-3 gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2">{children}</span>
    </div>
  )
}

// Left-pane list block -- item identifier, vendor, date opened, and status
// badge, matching the Sales Ledger list block's scan-by fields.
function RmaListItem({ m, active, onOpen }: { m: MergedRma; active: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "w-full text-left px-3 py-2.5 border-b border-border flex flex-col gap-1 transition-colors",
        active ? "bg-primary/10" : "hover:bg-muted"
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-sm text-foreground truncate">{itemLabel(m)}</span>
        <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(m.opened_at).toLocaleDateString()}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground truncate">{m.vendorName || '—'}</span>
        <StatusBadge tone={toneFor(RMA_STATUS_TONES, m.status)}>{m.status.replace(/_/g, ' ')}</StatusBadge>
      </div>
    </button>
  )
}

// Right-pane detail view -- Direction, Reason, Notes, and whichever status-
// advance actions the selected RMA's kind/direction exposes, preserved exactly
// from the two former tables' Actions columns.
function RmaDetailPane({
  m,
  advancingKey,
  onAdvanceUnit,
  onAdvanceAccessory,
  onBack,
}: {
  m: MergedRma
  advancingKey: string | null
  onAdvanceUnit: (e: RmaEvent, next: string) => void
  onAdvanceAccessory: (e: AccessoryRmaEvent, next: string) => void
  onBack: () => void
}) {
  const nextOptions = m.kind === 'unit'
    ? (NEXT_STATUS_OPTIONS[m.status] || [])
    : accessoryNextStatuses(m.direction, m.status)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
        <div className="min-w-0">
          <button type="button" onClick={onBack} className="md:hidden mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowLeft className="size-4" /> Back to list
          </button>
          <h2 className="text-lg font-semibold text-foreground truncate">{itemLabel(m)}</h2>
          <p className="text-sm text-muted-foreground mt-0.5 capitalize">{m.kind === 'unit' ? 'Unit RMA' : 'Accessory RMA'}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <StatusBadge tone={toneFor(RMA_STATUS_TONES, m.status)}>{m.status.replace(/_/g, ' ')}</StatusBadge>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <Field label="Opened">{new Date(m.opened_at).toLocaleDateString()}</Field>
        <Field label="Direction"><span className="capitalize">{m.direction.replace('_', ' ')}</span></Field>
        {m.kind === 'accessory' && <Field label="Quantity"><span className="tabular-nums">{m.accessory.quantity}</span></Field>}
        <Field label="Reason">{m.kind === 'unit' ? m.unit.reason : m.accessory.reason}</Field>
        <Field label="Vendor">{m.vendorName || '—'}</Field>
        <Field label="Notes">{(m.kind === 'unit' ? m.unit.notes : m.accessory.notes) || '—'}</Field>
        {(m.kind === 'unit' ? m.unit.closed_at : m.accessory.closed_at) && (
          <Field label="Closed">{new Date((m.kind === 'unit' ? m.unit.closed_at : m.accessory.closed_at) as string).toLocaleDateString()}</Field>
        )}
        {nextOptions.length > 0 && (
          <Field label="Advance Status">
            <div className="flex flex-wrap gap-2">
              {nextOptions.map((next) => {
                const key = `${m.id}:${next}`
                return (
                  <button
                    key={next}
                    onClick={() => (m.kind === 'unit' ? onAdvanceUnit(m.unit, next) : onAdvanceAccessory(m.accessory, next))}
                    disabled={!!advancingKey}
                    className="text-primary underline text-xs capitalize inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    {advancingKey === key && <Loader2 className="size-3 animate-spin" />}
                    {next.replace(/_/g, ' ')}
                  </button>
                )
              })}
            </div>
          </Field>
        )}
      </div>
    </div>
  )
}

function RmaPage() {
  // itemKind now only drives the "New RMA" modal's form (unit vs accessory) --
  // the list pane itself is a single unified, chronologically-sorted feed.
  const [itemKind, setItemKind] = useState<'unit' | 'accessory'>('unit')

  const [events, setEvents] = useState<RmaEvent[]>([])
  const [accessoryEvents, setAccessoryEvents] = useState<AccessoryRmaEvent[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [directionFilter, setDirectionFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)

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

  // Both feeds are fetched together now (rather than one-at-a-time per tab) so
  // they can be merged into a single sorted list -- same two existing API
  // routes, same filters, just no longer gated behind which tab is active.
  const fetchEvents = useCallback(async () => {
    const params = new URLSearchParams()
    if (directionFilter) params.append('direction', directionFilter)
    if (statusFilter) params.append('status', statusFilter)
    const res = await apiFetch(`/api/rma?${params.toString()}`)
    if (res.ok) setEvents(await res.json())
    else setEvents([])
  }, [directionFilter, statusFilter])

  const fetchAccessoryEvents = useCallback(async () => {
    const params = new URLSearchParams()
    if (directionFilter) params.append('direction', directionFilter)
    if (statusFilter) params.append('status', statusFilter)
    const res = await apiFetch(`/api/accessory-rma?${params.toString()}`)
    if (res.ok) setAccessoryEvents(await res.json())
    else setAccessoryEvents([])
  }, [directionFilter, statusFilter])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    await Promise.all([fetchEvents(), fetchAccessoryEvents()])
    setLoading(false)
  }, [fetchEvents, fetchAccessoryEvents])

  useEffect(() => { fetchAll() }, [fetchAll])

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

  // Merge + sort both feeds into one chronological list, newest-opened first --
  // matches every other list page's date-column default (see CLAUDE.md).
  const merged: MergedRma[] = useMemo(() => {
    const unitRows: MergedRma[] = events.map((e) => ({
      kind: 'unit', id: e.id, opened_at: e.opened_at, direction: e.direction, status: e.status,
      vendorName: e.vendors?.company_name || null, unit: e,
    }))
    const accessoryRows: MergedRma[] = accessoryEvents.map((e) => ({
      kind: 'accessory', id: e.id, opened_at: e.opened_at, direction: e.direction, status: e.status,
      vendorName: e.vendors?.company_name || null, accessory: e,
    }))
    return [...unitRows, ...accessoryRows].sort((a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime())
  }, [events, accessoryEvents])

  // Auto-select the first row on load/refetch, but don't yank focus away from
  // whatever's already open if it's still in the refetched merged list.
  useEffect(() => {
    if (loading) return
    setActiveId((prev) => (prev && merged.some((m) => m.id === prev)) ? prev : (merged[0]?.id ?? null))
  }, [merged, loading])

  const active = useMemo(() => merged.find((m) => m.id === activeId) ?? null, [merged, activeId])

  return (
    <div className="p-4 flex flex-col" style={{ height: "calc(100vh - 2rem)" }}>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">RMA / Returns</h1>
        <button onClick={openModal} className="bg-primary text-primary-foreground px-4 py-2 rounded">
          + New RMA
        </button>
      </div>

      <div className="flex gap-4 mb-4 flex-wrap">
        <select value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)} className="border p-2 rounded bg-card text-sm">
          <option value="">All Directions</option>
          <option value="to_vendor">To Vendor</option>
          <option value="from_customer">From Customer</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border p-2 rounded bg-card text-sm">
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
      ) : (
        <div className="flex-1 min-h-0 border rounded overflow-hidden flex">
          {/* List pane -- hidden on mobile once an RMA is open, matching Sales
              Ledger's drill-in navigation; always visible at md+. */}
          <div className={cn("w-full md:w-[360px] md:flex-shrink-0 border-r border-border flex flex-col", active && "hidden md:flex")}>
            <div className="flex-1 overflow-y-auto">
              {merged.map((m) => (
                <RmaListItem key={m.id} m={m} active={m.id === activeId} onOpen={() => setActiveId(m.id)} />
              ))}
              {merged.length === 0 && (
                <p className="p-4 text-center text-sm text-muted-foreground">No RMAs found.</p>
              )}
            </div>
          </div>

          {/* Detail pane -- full width on mobile (replaces the list), flex-1 at md+. */}
          <div className={cn("flex-1 min-w-0", !active && "hidden md:flex md:items-center md:justify-center")}>
            {active ? (
              <RmaDetailPane
                m={active}
                advancingKey={advancingKey}
                onAdvanceUnit={advanceStatus}
                onAdvanceAccessory={advanceAccessoryStatus}
                onBack={() => setActiveId(null)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Select an RMA to view details.</p>
            )}
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold mb-4">New RMA</h2>

            <div className="flex gap-2 mb-4 border-b">
              <button
                type="button"
                onClick={() => setItemKind('unit')}
                className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${itemKind === 'unit' ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`}
              >
                Unit
              </button>
              <button
                type="button"
                onClick={() => setItemKind('accessory')}
                className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${itemKind === 'accessory' ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`}
              >
                Accessory
              </button>
            </div>

            {itemKind === 'unit' ? (
              <>
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
              </>
            ) : (
              <>
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
              </>
            )}
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

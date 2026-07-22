'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'
import RequireOwner from '@/components/RequireOwner'

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

const NEXT_STATUS_OPTIONS: Record<string, string[]> = {
  initiated: ['shipped', 'vendor_accepted', 'vendor_rejected'],
  shipped: ['vendor_accepted', 'vendor_rejected'],
  vendor_accepted: ['replacement_received', 'refund_received'],
}

function RmaPage() {
  const [events, setEvents] = useState<RmaEvent[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [directionFilter, setDirectionFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)

  // create-form state
  const [direction, setDirection] = useState<'to_vendor' | 'from_customer'>('to_vendor')
  const [assetSearch, setAssetSearch] = useState('')
  const [assetResults, setAssetResults] = useState<StockAsset[]>([])
  const [selectedAsset, setSelectedAsset] = useState<StockAsset | null>(null)
  const [reason, setReason] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (directionFilter) params.append('direction', directionFilter)
    if (statusFilter) params.append('status', statusFilter)
    const res = await apiFetch(`/api/rma?${params.toString()}`)
    if (res.ok) setEvents(await res.json())
    setLoading(false)
  }, [directionFilter, statusFilter])

  useEffect(() => {
    fetchEvents()
  }, [fetchEvents])

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
    resetForm()
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

  const advanceStatus = async (event: RmaEvent, newStatus: string) => {
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
  }

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">RMA / Returns</h1>
        <button onClick={openModal} className="bg-blue-600 text-white px-4 py-2 rounded">
          + New RMA
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
      ) : (
        <table className="min-w-full border text-sm">
          <thead>
            <tr>
              <th className="border p-2">Asset</th>
              <th className="border p-2">Direction</th>
              <th className="border p-2">Reason</th>
              <th className="border p-2">Vendor</th>
              <th className="border p-2">Status</th>
              <th className="border p-2">Opened</th>
              <th className="border p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="border p-2">
                  {e.asset_ledger?.asset_number} {e.asset_ledger?.serial_number ? `(${e.asset_ledger.serial_number})` : ''}
                </td>
                <td className="border p-2 capitalize">{e.direction.replace('_', ' ')}</td>
                <td className="border p-2">{e.reason}</td>
                <td className="border p-2">{e.vendors?.company_name || '—'}</td>
                <td className="border p-2 capitalize">{e.status.replace(/_/g, ' ')}</td>
                <td className="border p-2">{new Date(e.opened_at).toLocaleDateString()}</td>
                <td className="border p-2 space-x-2">
                  {(NEXT_STATUS_OPTIONS[e.status] || []).map((next) => (
                    <button
                      key={next}
                      onClick={() => advanceStatus(e, next)}
                      className="text-blue-600 underline text-xs capitalize"
                    >
                      {next.replace(/_/g, ' ')}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg">
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
                <div className="flex items-center justify-between border p-2 rounded bg-gray-50">
                  <span>{selectedAsset.asset_number} — {selectedAsset.sku_code}</span>
                  <button onClick={() => setSelectedAsset(null)} className="text-red-600 text-xs underline">Change</button>
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
                          className="block w-full text-left px-2 py-1 hover:bg-gray-100 text-sm"
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
                className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Open RMA'}
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
    <RequireOwner>
      <RmaPage />
    </RequireOwner>
  )
}

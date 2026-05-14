'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'

interface AssetRow {
  id: string
  asset_number: string
  serial_number: string | null
  status: string
  reserved_at: string | null
  received_at: string | null
  sold_at: string | null
  sku_code: string
  description: string
  quantity: number
  unit_price: number
  gst_percentage: number
  line_total: number
  po_number: string
  po_date: string
  vendor_name: string
  purchased_by_type: string
}

export default function StockPage() {
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)         // which row is in edit mode
  const [editAssetNumber, setEditAssetNumber] = useState('')
  const [editSerial, setEditSerial] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  const fetchAssets = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.append('status', statusFilter)
      if (searchTerm) params.append('search', searchTerm)

      const res = await apiFetch(`/api/stock?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch assets')
      const data = await res.json()
      setAssets(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [statusFilter, searchTerm])

  useEffect(() => {
    fetchAssets()
  }, [fetchAssets])

  const startEditing = (asset: AssetRow) => {
    setEditingId(asset.id)
    setEditAssetNumber(asset.asset_number)
    setEditSerial(asset.serial_number || '')
  }

  const cancelEditing = () => {
    setEditingId(null)
  }

  const saveEditing = async (id: string) => {
    // After the save succeeds, recalculate counters
 await apiFetch('/api/settings/asset-counters', { method: 'POST' })
    const res = await apiFetch('/api/stock', {
      method: 'PUT',
      body: JSON.stringify({
        id,
        asset_number: editAssetNumber,
        serial_number: editSerial || null,
      }),
    })
    if (res.ok) {
      setEditingId(null)
      fetchAssets() // refresh list
    } else {
      const err = await res.json().catch(() => ({}))
      alert(err.error || 'Failed to update asset')
    }
  }

  if (error) return <div className="p-4 text-red-600">Error: {error}</div>

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Stock / Asset Inventory</h1>

      {/* Filters */}
      <div className="flex gap-4 mb-4">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border p-2 rounded">
          <option value="">All Statuses</option>
          <option value="reserved">Reserved</option>
          <option value="received">Received</option>
          <option value="in_stock">In Stock</option>
          <option value="sold">Sold</option>
          <option value="faulty">Faulty</option>
          <option value="returned">Returned</option>
        </select>
        <input
          type="text"
          placeholder="Search asset or serial..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="border p-2 rounded"
        />
        <button onClick={fetchAssets} className="bg-gray-200 px-4 py-2 rounded">Search</button>
      </div>

      {loading ? (
        <div>Loading assets…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border text-sm">
            <thead>
              <tr>
                <th className="border p-2">Asset Number</th>
                <th className="border p-2">Serial</th>
                <th className="border p-2">SKU</th>
                <th className="border p-2">Description</th>
                <th className="border p-2">PO Number</th>
                <th className="border p-2">PO Date</th>
                <th className="border p-2">Vendor</th>
                <th className="border p-2">Purchased By</th>
                <th className="border p-2">Unit Price</th>
                <th className="border p-2">Status</th>
                <th className="border p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.id}>
                  <td className="border p-2">
                    {editingId === asset.id ? (
                      <input
                        type="text"
                        value={editAssetNumber}
                        onChange={(e) => setEditAssetNumber(e.target.value)}
                        className="border p-1 w-24"
                      />
                    ) : (
                      asset.asset_number
                    )}
                  </td>
                  <td className="border p-2">
                    {editingId === asset.id ? (
                      <input
                        type="text"
                        value={editSerial}
                        onChange={(e) => setEditSerial(e.target.value)}
                        className="border p-1 w-32"
                      />
                    ) : (
                      asset.serial_number || '—'
                    )}
                  </td>
                  <td className="border p-2">{asset.sku_code}</td>
                  <td className="border p-2">{asset.description}</td>
                  <td className="border p-2">{asset.po_number}</td>
                  <td className="border p-2">{asset.po_date}</td>
                  <td className="border p-2">{asset.vendor_name}</td>
                  <td className="border p-2">{asset.purchased_by_type}</td>
                  <td className="border p-2">₹{asset.unit_price?.toFixed(2)}</td>
                  <td className="border p-2 capitalize">{asset.status.replace('_', ' ')}</td>
                  <td className="border p-2">
                    {asset.status !== 'sold' && asset.status !== 'returned' && (
                      editingId === asset.id ? (
                        <div className="flex gap-1">
                          <button
                            onClick={() => saveEditing(asset.id)}
                            className="text-green-600 underline"
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelEditing}
                            className="text-red-600 underline"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEditing(asset)}
                          className="text-blue-600 underline"
                        >
                          Edit
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
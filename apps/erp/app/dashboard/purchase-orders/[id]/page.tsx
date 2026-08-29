'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import RequireOwner from '@/components/RequireOwner'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { EditPoItemDialog } from '@/components/EditPoItemDialog'
import { EditPoVendorDialog } from '@/components/EditPoVendorDialog'
import { AttachUnitsDialog } from '@/components/AttachUnitsDialog'

interface POItem {
  id: string
  line_item_number: number
  sku_id: string
  base_sku_code: string
  variant_number: number
  sku_code: string
  sku_description: string
  sku_brand: string
  sku_model: string
  sku_specs: Record<string, any>
  hsn_code: string
  quantity: number
  unit_price: number
  gst_percentage: number
  line_total: number
  asset_numbers_reserved: string[]
  serial_numbers: string[]
  sku_category: string | null
  is_serialized: boolean
  received_quantity: number
  notes?: string | null
}

interface PurchaseOrder {
  id: string
  po_number: string
  po_date: string
  vendor_id: string
  vendor_name: string
  po_status: string
  purchase_type: string
  purchased_by_type: string
  expected_delivery_date: string | null
  delivery_location: string | null
  remarks: string | null
  total_amount: number
  gst_total: number
  grand_total: number
  items: POItem[]
}

function PODetailPage() {
  const params = useParams()
  const router = useRouter()
  const poId = params.id as string

  const [po, setPo] = useState<PurchaseOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [showReceiveModal, setShowReceiveModal] = useState(false)
  const [receipts, setReceipts] = useState<Record<string, string>>({}) // serialized: asset_number -> serial
  const [fungibleReceipts, setFungibleReceipts] = useState<Record<string, number | ''>>({}) // fungible: po_item_id -> qty received now
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editingVendor, setEditingVendor] = useState(false)
  const [attachingUnits, setAttachingUnits] = useState(false)

  const fetchPO = async () => {
    setLoading(true)
    const res = await apiFetch(`/api/purchase-orders/${poId}`)
    if (res.ok) {
      const data = await res.json()
      // Ensure items is an array
      data.items = data.items || []
      setPo(data)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchPO()
  }, [poId])

  const { run: handleReceiveSubmit, pending: receiving } = useAsyncAction(async () => {
    if (!po) return
    const itemsPayload: any[] = []
    for (const item of po.items) {
      if (item.is_serialized) {
        const assetsToReceive = (item.asset_numbers_reserved || []).filter(asset => receipts[asset])
        if (assetsToReceive.length === 0) continue
        const assets = assetsToReceive.map(asset => ({ asset_number: asset, serial_number: receipts[asset] }))
        itemsPayload.push({ po_item_id: item.id, assets })
      } else {
        // Fungible line: a single quantity received now (no serials).
        const qty = fungibleReceipts[item.id]
        if (!qty || qty <= 0) continue
        itemsPayload.push({ po_item_id: item.id, quantity: qty })
      }
    }
    if (itemsPayload.length === 0) {
      alert('Nothing entered to receive.')
      return
    }
    const res = await apiFetch(`/api/purchase-orders/${poId}/receive`, {
      method: 'POST',
      body: JSON.stringify({ items: itemsPayload }),
    })
    if (res.ok) {
      const result = await res.json().catch(() => ({}))
      const promoted = result.promoted_count || 0
      alert(
        promoted > 0
          ? `Goods received successfully! (${promoted} matched existing employee-intake stock -- no duplicate stock added.)`
          : 'Goods received successfully!'
      )
      setShowReceiveModal(false)
      setReceipts({})
      setFungibleReceipts({})
      fetchPO()
      return
    }
    const err = await res.json().catch(() => ({}))
    // One or more serials already exist elsewhere in the system -- hard block, no
    // confirm-and-proceed override. Surface exactly which ones collided.
    if (err.error_code === 'duplicate_serial') {
      const lines = (err.duplicates || []).map((d: any) =>
        `${d.serial_number} -- already ${d.existing.asset_number || 'untagged'} (status: ${d.existing.status}, source: ${d.existing.source})`
      ).join('\n')
      alert(`${err.error}\n\n${lines}`)
      return
    }
    alert(err.error || 'Failed to receive goods.')
  })

  const { run: handleSubmitPO, pending: submittingPO } = useAsyncAction(async () => {
    const res = await apiFetch(`/api/purchase-orders/${poId}/submit`, { method: 'POST' })
    if (res.ok) {
      alert('PO submitted successfully.')
      fetchPO()
    } else {
      const err = await res.json().catch(() => ({}))
      alert(err.error || 'Submission failed')
    }
  })

  const { run: handleCancelPO, pending: cancellingPO } = useAsyncAction(async () => {
    if (!confirm('Are you sure you want to cancel this Purchase Order?')) return
    const res = await apiFetch(`/api/purchase-orders/${poId}`, {
      method: 'PUT',
      body: JSON.stringify({ po_status: 'cancelled' })
    })
    if (res.ok) {
      alert('Purchase Order cancelled.')
      fetchPO()
    } else {
      const err = await res.json().catch(() => ({}))
      alert(err.error || 'Failed to cancel PO')
    }
  })

  const { run: handleDeletePO, pending: deletingPO } = useAsyncAction(async () => {
    if (!confirm('PERMANENTLY DELETE this Purchase Order? All items and assets will be removed. This cannot be undone.')) return
    const res = await apiFetch(`/api/purchase-orders/${poId}/hard-delete`, { method: 'DELETE' })
    if (res.ok) {
      alert('Purchase Order permanently deleted.')
      router.push('/dashboard/purchase-orders')
    } else {
      const err = await res.json().catch(() => ({}))
      alert(err.error || 'Failed to delete PO')
    }
  })

  if (loading) return <div className="p-4">Loading PO...</div>
  if (!po) return <div className="p-4 text-red-600">Purchase Order not found.</div>

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <button onClick={() => router.push('/dashboard/purchase-orders')} className="text-sm text-gray-600 hover:text-gray-900 mb-2">
        ← Back to Purchase Orders
      </button>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">{po.po_number}</h1>
        <span className={`px-2 py-1 rounded text-white capitalize ${po.po_status === 'draft' ? 'bg-gray-500' : 'bg-green-600'}`}>
          {(po.po_status || '').replace('_', ' ')}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6 bg-white p-4 shadow rounded">
        <div>
          <p>
            <strong>Vendor:</strong> {po.vendor_name}
            {po.po_status !== 'cancelled' && (
              <button onClick={() => setEditingVendor(true)} className="ml-2 text-xs text-blue-600 underline">Edit</button>
            )}
          </p>
          <p><strong>PO Date:</strong> {po.po_date}</p>
          <p><strong>Expected Delivery:</strong> {po.expected_delivery_date || 'N/A'}</p>
        </div>
        <div>
          <p><strong>Type:</strong> {po.purchase_type} / {po.purchased_by_type}</p>
          <p><strong>Status:</strong> {(po.po_status || '').replace('_', ' ')}</p>
          <p><strong>Remarks:</strong> {po.remarks || '-'}</p>
        </div>
      </div>

      <div className="flex justify-between items-center mb-2">
        <h2 className="text-lg font-semibold">Line Items</h2>
        {po.po_status !== 'cancelled' && (
          <button onClick={() => setAttachingUnits(true)} className="text-sm text-blue-600 underline">
            + Add Units from Stock
          </button>
        )}
      </div>
      <table className="min-w-full border mb-4 text-sm">
        <thead>
          <tr>
            <th className="border p-2">Item #</th>
            <th className="border p-2">SKU</th>
            <th className="border p-2">Specs</th>
            <th className="border p-2">HSN</th>
            <th className="border p-2">Qty</th>
            <th className="border p-2">Unit Price</th>
            <th className="border p-2">GST</th>
            <th className="border p-2">Line Total</th>
            <th className="border p-2">Assets Reserved</th>
            <th className="border p-2">Received</th>
            {po.po_status !== 'cancelled' && <th className="border p-2">Edit</th>}
          </tr>
        </thead>
        <tbody>
          {(po.items || []).map(item => {
            // Build specs summary
            const specsSummary = [
              item.sku_brand,
              item.sku_model,
              ...Object.entries(item.sku_specs || {})
                .filter(([_, val]) => val !== null && val !== '' && val !== undefined)
                .map(([key, val]) => `${key}: ${val}`)
            ].filter(Boolean).join(', ') || '—'

            return (
              <tr key={item.id}>
                <td className="border p-2">{item.line_item_number}</td>
                <td className="border p-2">
                  <div className="font-medium">{item.sku_code || `${item.base_sku_code}-${String(item.variant_number).padStart(3, '0')}`}</div>
                  <div className="text-xs text-gray-500">{item.sku_description}</div>
                </td>
                <td className="border p-2 text-xs text-gray-600">{specsSummary}</td>
                <td className="border p-2 text-xs">{item.hsn_code || '—'}</td>
                <td className="border p-2">{item.quantity}</td>
                <td className="border p-2">₹{(item.unit_price ?? 0).toFixed(2)}</td>
                <td className="border p-2">{item.gst_percentage}%</td>
                <td className="border p-2">₹{(item.line_total ?? 0).toFixed(2)}</td>
                <td className="border p-2 text-sm">{item.is_serialized ? ((item.asset_numbers_reserved || []).join(', ') || '-') : <span className="text-gray-400">quantity item</span>}</td>
                <td className="border p-2 text-sm">
                  {item.is_serialized
                    ? ((item.serial_numbers || []).join(', ') || '-')
                    : `${item.received_quantity} of ${item.quantity}`}
                </td>
                {po.po_status !== 'cancelled' && (
                  <td className="border p-2 text-center">
                    <button onClick={() => setEditingItemId(item.id)} className="text-xs text-blue-600 underline">Edit</button>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="text-right font-bold text-lg">
        Grand Total: ₹{(po.grand_total ?? 0).toFixed(2)}
      </div>

      {/* Buttons (unchanged, but make sure they also handle undefined status) */}
      {['submitted', 'partially_received'].includes(po.po_status || '') && (
        <div className="mt-4">
          <button onClick={() => setShowReceiveModal(true)} className="bg-blue-600 text-white px-4 py-2 rounded">
            Receive Goods
          </button>
        </div>
      )}

      {po.po_status === 'draft' && (
        <div className="mt-4">
          <button onClick={() => handleSubmitPO()} disabled={submittingPO} className="bg-green-600 text-white px-4 py-2 rounded disabled:opacity-50 inline-flex items-center gap-1.5">
            {submittingPO && <Loader2 className="size-4 animate-spin" />}
            Submit PO
          </button>
        </div>
      )}

      {['draft', 'submitted'].includes(po.po_status || '') && (
        <div className="mt-4">
          <button onClick={() => handleCancelPO()} disabled={cancellingPO} className="bg-red-600 text-white px-4 py-2 rounded disabled:opacity-50 inline-flex items-center gap-1.5">
            {cancellingPO && <Loader2 className="size-4 animate-spin" />}
            Cancel PO
          </button>
        </div>
      )}

      {['draft', 'cancelled'].includes(po.po_status || '') && (
        <div className="mt-4">
          <button onClick={() => handleDeletePO()} disabled={deletingPO} className="bg-red-700 text-white px-4 py-2 rounded disabled:opacity-50 inline-flex items-center gap-1.5">
            {deletingPO && <Loader2 className="size-4 animate-spin" />}
            Delete PO
          </button>
        </div>
      )}

      {['submitted', 'partially_received', 'received', 'invoiced'].includes(po.po_status || '') && (
        <div className="mt-4">
          <button onClick={() => router.push(`/dashboard/purchase-invoices/new?po_id=${poId}`)} className="bg-purple-600 text-white px-4 py-2 rounded">
            Create Invoice
          </button>
        </div>
      )}

      {/* Receive Modal (unchanged) */}
      {showReceiveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded shadow-lg max-w-lg w-full">
            <h2 className="text-xl font-bold mb-4">Receive Goods</h2>
            <p className="mb-4 text-sm text-gray-600">
              Enter serial numbers for serialized units, or a received quantity for accessory lines.
            </p>
            {po.items.map(item => {
              const remaining = item.quantity - item.received_quantity
              return (
                <div key={item.id} className="mb-4">
                  <p className="font-medium">
                    {item.sku_code || `${item.base_sku_code}-${String(item.variant_number).padStart(3, '0')}`} (Qty: {item.quantity})
                    {!item.is_serialized && item.received_quantity > 0 && (
                      <span className="text-xs text-gray-500"> — {item.received_quantity} already received</span>
                    )}
                  </p>
                  {item.is_serialized ? (
                    (item.asset_numbers_reserved || []).map(asset => (
                      <div key={asset} className="flex items-center gap-2 mt-1">
                        <label className="w-24 text-sm">{asset}</label>
                        <input
                          type="text"
                          value={receipts[asset] || ''}
                          onChange={(e) => setReceipts(prev => ({ ...prev, [asset]: e.target.value }))}
                          className="border p-1 flex-1 rounded"
                          placeholder="Serial #"
                        />
                      </div>
                    ))
                  ) : remaining > 0 ? (
                    <div className="flex items-center gap-2 mt-1">
                      <label className="text-sm">Quantity received now:</label>
                      <input
                        type="number"
                        min={1}
                        max={remaining}
                        value={fungibleReceipts[item.id] ?? ''}
                        onChange={(e) => setFungibleReceipts(prev => ({ ...prev, [item.id]: e.target.value === '' ? '' : Number(e.target.value) }))}
                        className="border p-1 w-24 rounded"
                        placeholder={`max ${remaining}`}
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-green-700 mt-1">Fully received.</p>
                  )}
                </div>
              )
            })}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowReceiveModal(false)} className="px-4 py-2 border rounded">
                Cancel
              </button>
              <button onClick={() => handleReceiveSubmit()} disabled={receiving} className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50 inline-flex items-center gap-1.5">
                {receiving && <Loader2 className="size-4 animate-spin" />}
                Confirm Receipt
              </button>
            </div>
          </div>
        </div>
      )}

      {editingItemId && po.items.find(i => i.id === editingItemId) && (
        <EditPoItemDialog
          poId={poId}
          poStatus={po.po_status}
          item={(() => {
            const i = po.items.find(x => x.id === editingItemId)!
            return { id: i.id, sku_id: i.sku_id, sku_code: i.sku_code, quantity: i.quantity, unit_price: i.unit_price, gst_percentage: i.gst_percentage, notes: i.notes, hsn_code: i.hsn_code }
          })()}
          allItems={po.items.map(i => ({ id: i.id, sku_id: i.sku_id, sku_code: i.sku_code, quantity: i.quantity, unit_price: i.unit_price, gst_percentage: i.gst_percentage, notes: i.notes }))}
          onClose={() => setEditingItemId(null)}
          onSaved={fetchPO}
        />
      )}

      {editingVendor && (
        <EditPoVendorDialog
          poId={poId}
          currentVendorId={po.vendor_id}
          onClose={() => setEditingVendor(false)}
          onSaved={fetchPO}
        />
      )}

      {attachingUnits && (
        <AttachUnitsDialog
          poId={poId}
          onClose={() => setAttachingUnits(false)}
          onSaved={fetchPO}
        />
      )}
    </div>
  )
}

export default function PODetailPageGuarded() {
  return (
    <RequireOwner>
      <PODetailPage />
    </RequireOwner>
  )
}
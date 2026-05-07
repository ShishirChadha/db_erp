'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'

interface POItem {
  id: string
  line_item_number: number
  sku_id: string
  base_sku_code: string
  variant_number: number
  quantity: number
  base_price: number
  unit_price: number
  gst_percentage: number
  gst_amount: number
  line_total: number
  asset_numbers_reserved: string[]
  serial_numbers: string[]
}

interface PurchaseOrder {
  id: string
  po_number: string
  po_date: string
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

export default function PODetailPage() {
  const router = useRouter()
  const params = useParams()
  const poId = params.id as string

  const [po, setPo] = useState<PurchaseOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [showReceiveModal, setShowReceiveModal] = useState(false)
  const [receipts, setReceipts] = useState<Record<string, string>>({}) // asset -> serial

  const fetchPO = async () => {
    setLoading(true)
    const res = await apiFetch(`/api/purchase-orders/${poId}`)
    if (res.ok) {
      const data = await res.json()
      setPo(data)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchPO()
  }, [poId])

  const handleReceiveSubmit = async () => {
    if (!po) return
    const itemsPayload: any[] = []
    for (const item of po.items) {
      const assetsToReceive = (item.asset_numbers_reserved || []).filter(asset => receipts[asset])
      if (assetsToReceive.length === 0) continue
      const assets = assetsToReceive.map(asset => ({
        asset_number: asset,
        serial_number: receipts[asset],
      }))
      itemsPayload.push({ po_item_id: item.id, assets })
    }
    if (itemsPayload.length === 0) {
      alert('No serial numbers entered.')
      return
    }
    const res = await apiFetch(`/api/purchase-orders/${poId}/receive`, {
      method: 'POST',
      body: JSON.stringify({ items: itemsPayload }),
    })
    if (res.ok) {
      alert('Goods received successfully!')
      setShowReceiveModal(false)
      fetchPO()
    } else {
      const err = await res.json().catch(() => ({}))
      alert(err.error || 'Failed to receive goods.')
    }
  }

  if (loading) return <div className="p-4">Loading PO...</div>
  if (!po) return <div className="p-4 text-red-600">Purchase Order not found.</div>

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">{po.po_number}</h1>
        <span className={`px-2 py-1 rounded text-white capitalize ${po.po_status === 'draft' ? 'bg-gray-500' : 'bg-green-600'}`}>{po.po_status.replace('_', ' ')}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6 bg-white p-4 shadow rounded">
        <div>
          <p><strong>Vendor:</strong> {po.vendor_name}</p>
          <p><strong>PO Date:</strong> {po.po_date}</p>
          <p><strong>Expected Delivery:</strong> {po.expected_delivery_date || 'N/A'}</p>
        </div>
        <div>
          <p><strong>Type:</strong> {po.purchase_type} / {po.purchased_by_type}</p>
          <p><strong>Status:</strong> {po.po_status.replace('_', ' ')}</p>
          <p><strong>Remarks:</strong> {po.remarks || '-'}</p>
        </div>
      </div>

      <h2 className="text-lg font-semibold mb-2">Line Items</h2>
      <table className="min-w-full border mb-4">
        <thead>
          <tr>
            <th className="border p-2">Item #</th>
            <th className="border p-2">SKU</th>
            <th className="border p-2">Qty</th>
            <th className="border p-2">Unit Price</th>
            <th className="border p-2">GST</th>
            <th className="border p-2">Line Total</th>
            <th className="border p-2">Assets Reserved</th>
            <th className="border p-2">Serials Received</th>
          </tr>
        </thead>
        <tbody>
          {po.items.map(item => (
            <tr key={item.id}>
              <td className="border p-2">{item.line_item_number}</td>
              <td className="border p-2">{item.base_sku_code}-{String(item.variant_number).padStart(3, '0')}</td>
              <td className="border p-2">{item.quantity}</td>
              <td className="border p-2">₹{item.unit_price.toFixed(2)}</td>
              <td className="border p-2">{item.gst_percentage}%</td>
              <td className="border p-2">₹{item.line_total.toFixed(2)}</td>
              <td className="border p-2">{(item.asset_numbers_reserved || []).join(', ') || '-'}</td>
              <td className="border p-2">{(item.serial_numbers || []).join(', ') || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="text-right font-bold text-lg">
        Grand Total: ₹{po.grand_total.toFixed(2)}
      </div>

      {/* Receive button (only if status allows) */}
      {['submitted', 'partially_received'].includes(po.po_status) && (
        <div className="mt-4">
          <button
            onClick={() => setShowReceiveModal(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded"
          >
            Receive Goods
          </button>
        </div>
      )}

      {/* Receive Modal */}
      {showReceiveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded shadow-lg max-w-lg w-full">
            <h2 className="text-xl font-bold mb-4">Receive Goods</h2>
            <p className="mb-4 text-sm text-gray-600">Enter serial numbers for the assets you are receiving.</p>
            {po.items.map(item => (
              <div key={item.id} className="mb-4">
                <p className="font-medium">{item.base_sku_code}-{String(item.variant_number).padStart(3, '0')} (Qty: {item.quantity})</p>
                {(item.asset_numbers_reserved || []).map(asset => (
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
                ))}
              </div>
            ))}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowReceiveModal(false)} className="px-4 py-2 border rounded">Cancel</button>
              <button onClick={handleReceiveSubmit} className="px-4 py-2 bg-blue-600 text-white rounded">Confirm Receipt</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
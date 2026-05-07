'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'

interface PurchaseOrder {
  id: string
  po_number: string
  po_date: string
  vendor_name: string
  po_status: string
  total_amount: number | null
}

export default function PurchaseOrdersPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')

  const fetchOrders = async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter) params.append('status', statusFilter)
    if (search) params.append('search', search)

    const res = await apiFetch(`/api/purchase-orders?${params.toString()}`)
    if (res.ok) {
      const data = await res.json()
      setOrders(data)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchOrders()
  }, [statusFilter, search])

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Purchase Orders</h1>
        <button
          onClick={() => router.push('/dashboard/purchase-orders/new')}
          className="bg-blue-600 text-white px-4 py-2 rounded"
        >
          + New Purchase Order
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border p-2 rounded"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
          <option value="partially_received">Partially Received</option>
          <option value="received">Received</option>
          <option value="invoiced">Invoiced</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input
          type="text"
          placeholder="Search PO number..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border p-2 rounded"
        />
        <button
          onClick={fetchOrders}
          className="bg-gray-200 px-3 py-2 rounded"
        >
          Search
        </button>
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : (
        <table className="min-w-full border">
          <thead>
            <tr>
              <th className="border p-2">PO Number</th>
              <th className="border p-2">Date</th>
              <th className="border p-2">Vendor</th>
              <th className="border p-2">Status</th>
              <th className="border p-2">Total</th>
              <th className="border p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(po => (
              <tr key={po.id} className="cursor-pointer hover:bg-gray-50" onClick={() => router.push(`/dashboard/purchase-orders/${po.id}`)}>
                <td className="border p-2">{po.po_number}</td>
                <td className="border p-2">{po.po_date}</td>
                <td className="border p-2">{po.vendor_name}</td>
                <td className="border p-2 capitalize">{po.po_status.replace('_', ' ')}</td>
                <td className="border p-2">{po.total_amount ? `₹${po.total_amount.toFixed(2)}` : '-'}</td>
                <td className="border p-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/purchase-orders/${po.id}`) }}
                    className="text-blue-600 underline"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
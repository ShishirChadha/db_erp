'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'

interface Invoice {
  id: string
  invoice_number: string
  invoice_date: string
  po_id: string | null
  purchase_orders: { po_number: string; vendor_name: string } | null
  grand_total: number | null
  payment_status: string
}

export default function PurchaseInvoicesPage() {
  const router = useRouter()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchInvoices = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/purchase-invoices')
      if (!res.ok) {
        const errText = await res.text()
        throw new Error(errText || `Request failed with status ${res.status}`)
      }
      const data = await res.json()
      setInvoices(Array.isArray(data) ? data : [])
    } catch (err: any) {
      console.error('Failed to fetch invoices:', err)
      setError(err.message)
      setInvoices([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchInvoices()
  }, [fetchInvoices])

  if (loading) {
    return <div className="p-4">Loading invoices…</div>
  }

  if (error) {
    return (
      <div className="p-4 text-red-600">
        <p>Error: {error}</p>
        <button
          onClick={fetchInvoices}
          className="underline mt-2"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Purchase Invoices</h1>
        <button
          onClick={() => router.push('/dashboard/purchase-invoices/new')}
          className="bg-blue-600 text-white px-4 py-2 rounded"
        >
          + New Invoice
        </button>
      </div>

      {invoices.length === 0 ? (
        <div className="text-gray-500">No purchase invoices found.</div>
      ) : (
        <table className="min-w-full border">
          <thead>
            <tr>
              <th className="border p-2">Invoice #</th>
              <th className="border p-2">Date</th>
              <th className="border p-2">PO Number</th>
              <th className="border p-2">Vendor</th>
              <th className="border p-2">Amount</th>
              <th className="border p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr
                key={inv.id}
                className="cursor-pointer hover:bg-gray-50"
                onClick={() => router.push(`/dashboard/purchase-invoices/${inv.id}`)}
              >
                <td className="border p-2">{inv.invoice_number}</td>
                <td className="border p-2">{inv.invoice_date}</td>
                <td className="border p-2">{inv.purchase_orders?.po_number || '—'}</td>
                <td className="border p-2">{inv.purchase_orders?.vendor_name || '—'}</td>
                <td className="border p-2">
                  {inv.grand_total != null ? `₹${inv.grand_total.toFixed(2)}` : '—'}
                </td>
                <td className="border p-2 capitalize">{inv.payment_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
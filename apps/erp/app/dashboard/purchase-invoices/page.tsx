'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'
import RequireOwner from '@/components/RequireOwner'

interface Invoice {
  id: string
  invoice_number: string
  invoice_date: string
  po_id: string | null
  purchase_orders: { po_number: string; vendor_name: string } | null
  grand_total: number | null
  payment_status: string
  last_payment_date: string | null
}

type SortField = 'invoice_number' | 'invoice_date' | 'vendor_name' | 'grand_total' | 'payment_status'
type SortOrder = 'asc' | 'desc'

function PurchaseInvoicesPage() {
  const router = useRouter()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortField, setSortField] = useState<SortField>('invoice_date')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')

  const fetchInvoices = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (paymentStatusFilter) params.append('payment_status', paymentStatusFilter)
      if (search) params.append('search', search)
      if (dateFrom) params.append('date_from', dateFrom)
      if (dateTo) params.append('date_to', dateTo)

      const res = await apiFetch(`/api/purchase-invoices?${params.toString()}`)
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
  }, [paymentStatusFilter, search, dateFrom, dateTo])

  useEffect(() => {
    fetchInvoices()
  }, [fetchInvoices])

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  const sortedInvoices = useMemo(() => {
    const value = (inv: Invoice) =>
      sortField === 'vendor_name' ? inv.purchase_orders?.vendor_name : (inv as any)[sortField]
    const sorted = [...invoices].sort((a, b) => {
      const av = value(a)
      const bv = value(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return av - bv
      return String(av).localeCompare(String(bv))
    })
    return sortOrder === 'asc' ? sorted : sorted.reverse()
  }, [invoices, sortField, sortOrder])

  const sortIndicator = (field: SortField) => (sortField === field ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : '')

  if (loading) {
    return <div className="p-4">Loading invoices…</div>
  }

  if (error) {
    return (
      <div className="p-4 text-destructive">
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
          className="bg-primary text-primary-foreground px-4 py-2 rounded"
        >
          + New Invoice
        </button>
      </div>

      <div className="flex flex-wrap gap-4 mb-4 items-end">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Payment Status</label>
          <select
            value={paymentStatusFilter}
            onChange={(e) => setPaymentStatusFilter(e.target.value)}
            className="border p-2 rounded"
          >
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">From</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border p-2 rounded" />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">To</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border p-2 rounded" />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Search Invoice #</label>
          <input
            type="text"
            placeholder="Search invoice number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border p-2 rounded"
          />
        </div>
        {(paymentStatusFilter || search || dateFrom || dateTo) && (
          <button
            onClick={() => { setPaymentStatusFilter(''); setSearch(''); setDateFrom(''); setDateTo('') }}
            className="text-sm text-muted-foreground underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {invoices.length === 0 ? (
        <div className="text-muted-foreground">No purchase invoices found.</div>
      ) : (
        <table className="min-w-full border">
          <thead>
            <tr>
              <th className="border p-2 cursor-pointer select-none" onClick={() => toggleSort('invoice_date')}>
                Date{sortIndicator('invoice_date')}
              </th>
              <th className="border p-2 cursor-pointer select-none" onClick={() => toggleSort('invoice_number')}>
                Invoice #{sortIndicator('invoice_number')}
              </th>
              <th className="border p-2">PO Number</th>
              <th className="border p-2 cursor-pointer select-none" onClick={() => toggleSort('vendor_name')}>
                Vendor{sortIndicator('vendor_name')}
              </th>
              <th className="border p-2 cursor-pointer select-none" onClick={() => toggleSort('grand_total')}>
                Amount{sortIndicator('grand_total')}
              </th>
              <th className="border p-2 cursor-pointer select-none" onClick={() => toggleSort('payment_status')}>
                Status{sortIndicator('payment_status')}
              </th>
              <th className="border p-2">Payment Date</th>
            </tr>
          </thead>
          <tbody>
            {sortedInvoices.map((inv) => (
              <tr
                key={inv.id}
                className="cursor-pointer hover:bg-muted"
                onClick={() => router.push(`/dashboard/purchase-invoices/${inv.id}`)}
              >
                <td className="border p-2">{inv.invoice_date}</td>
                <td className="border p-2">{inv.invoice_number}</td>
                <td className="border p-2">{inv.purchase_orders?.po_number || '—'}</td>
                <td className="border p-2">{inv.purchase_orders?.vendor_name || '—'}</td>
                <td className="border p-2">
                  {inv.grand_total != null ? `₹${inv.grand_total.toFixed(2)}` : '—'}
                </td>
                <td className="border p-2 capitalize">{inv.payment_status}</td>
                <td className="border p-2 text-muted-foreground">
                  {inv.last_payment_date ? new Date(inv.last_payment_date).toLocaleDateString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function PurchaseInvoicesPageGuarded() {
  return (
    <RequireOwner>
      <PurchaseInvoicesPage />
    </RequireOwner>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import RequireOwner from '@/components/RequireOwner'
import { ErrorBanner } from '@/components/ErrorBanner'
import { Pagination } from '@/components/Pagination'
import { EmptyTableRow } from '@/components/EmptyTableRow'
import { StatusBadge } from '@/components/StatusBadge'
import { PO_STATUS_TONES, toneFor } from '@/lib/status-styles'

const PAGE_SIZE = 25

interface PurchaseOrder {
  id: string
  po_number: string
  po_date: string
  vendor_id: string | null
  vendor_name: string
  po_status: string
  total_amount: number | null
  grand_total: number | null
}

interface Vendor {
  id: string
  company_name: string
}

type SortField = 'po_number' | 'po_date' | 'vendor_name' | 'po_status' | 'total_amount' | 'grand_total'
type SortOrder = 'asc' | 'desc'

function PurchaseOrdersPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [vendorFilter, setVendorFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('po_date')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')

  const fetchOrders = async () => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams()
    if (statusFilter) params.append('status', statusFilter)
    if (vendorFilter) params.append('vendor_id', vendorFilter)
    if (dateFrom) params.append('date_from', dateFrom)
    if (dateTo) params.append('date_to', dateTo)
    if (search) params.append('search', search)
    params.set('page', String(page))
    params.set('limit', String(PAGE_SIZE))

    const res = await apiFetch(`/api/purchase-orders?${params.toString()}`)
    if (res.ok) {
      const json = await res.json()
      setOrders(json.data || [])
      setTotal(json.total || 0)
    } else {
      setError('Failed to load purchase orders.')
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchOrders()
  }, [statusFilter, vendorFilter, dateFrom, dateTo, search, page])

  // Any filter change invalidates the current page's meaning -- reset to page 1.
  useEffect(() => { setPage(1) }, [statusFilter, vendorFilter, dateFrom, dateTo, search])

  useEffect(() => {
    apiFetch('/api/vendors').then(async (res) => {
      if (res.ok) setVendors(await res.json())
    })
  }, [])

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  const sortedOrders = useMemo(() => {
    const sorted = [...orders].sort((a, b) => {
      const av = a[sortField]
      const bv = b[sortField]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return av - bv
      return String(av).localeCompare(String(bv))
    })
    return sortOrder === 'asc' ? sorted : sorted.reverse()
  }, [orders, sortField, sortOrder])

  const sortIndicator = (field: SortField) => (sortField === field ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : '')

  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleDelete = async (po: PurchaseOrder) => {
    if (deletingId) return
    if (!confirm(`Permanently delete ${po.po_number}? This cannot be undone.`)) return

    setDeletingId(po.id)
    try {
      const res = await apiFetch(`/api/purchase-orders/${po.id}/hard-delete`, { method: 'DELETE' })
      if (res.ok) {
        alert(`${po.po_number} deleted.`)
        fetchOrders()
      } else {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Failed to delete PO.')
      }
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) return <div className="p-4">Loading...</div>

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Purchase Orders</h1>
        <button
          onClick={() => router.push('/dashboard/purchase-orders/new')}
          className="bg-primary text-primary-foreground px-4 py-2 rounded"
        >
          + New Purchase Order
        </button>
      </div>

      <div className="flex flex-wrap gap-4 mb-4 items-end">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Status</label>
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
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Vendor</label>
          <select
            value={vendorFilter}
            onChange={(e) => setVendorFilter(e.target.value)}
            className="border p-2 rounded"
          >
            <option value="">All Vendors</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.company_name}</option>
            ))}
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
          <label className="block text-xs text-muted-foreground mb-1">Search</label>
          <input
            type="text"
            placeholder="Search PO number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border p-2 rounded"
          />
        </div>
        {(statusFilter || vendorFilter || dateFrom || dateTo || search) && (
          <button
            onClick={() => { setStatusFilter(''); setVendorFilter(''); setDateFrom(''); setDateTo(''); setSearch('') }}
            className="text-sm text-muted-foreground underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {error && <div className="mb-4"><ErrorBanner message={error} onRetry={fetchOrders} /></div>}

      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-full text-sm">
          <thead>
            <tr>
              <th className="p-2 w-10 text-right">#</th>
              <th className="p-2 cursor-pointer select-none" onClick={() => toggleSort('po_date')}>
                Date{sortIndicator('po_date')}
              </th>
              <th className="p-2 cursor-pointer select-none" onClick={() => toggleSort('po_number')}>
                PO Number{sortIndicator('po_number')}
              </th>
              <th className="p-2 cursor-pointer select-none" onClick={() => toggleSort('vendor_name')}>
                Vendor{sortIndicator('vendor_name')}
              </th>
              <th className="p-2 cursor-pointer select-none" onClick={() => toggleSort('po_status')}>
                Status{sortIndicator('po_status')}
              </th>
              <th className="p-2 text-right cursor-pointer select-none" onClick={() => toggleSort('total_amount')}>
                Total (before GST){sortIndicator('total_amount')}
              </th>
              <th className="p-2 text-right cursor-pointer select-none" onClick={() => toggleSort('grand_total')}>
                Grand Total (incl. GST){sortIndicator('grand_total')}
              </th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {sortedOrders.length === 0 && <EmptyTableRow colSpan={8} message="No purchase orders found." />}
            {sortedOrders.map((po, idx) => (
              <tr key={po.id} className="hover:bg-muted">
                <td className="p-2 text-right tabular-nums text-muted-foreground">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                <td className="p-2">{po.po_date}</td>
                <td className="p-2">{po.po_number}</td>
                <td className="p-2">{po.vendor_name}</td>
                <td className="p-2"><StatusBadge tone={toneFor(PO_STATUS_TONES, po.po_status)}>{po.po_status.replace(/_/g, ' ')}</StatusBadge></td>
                <td className="p-2 text-right tabular-nums">{po.total_amount ? `₹${po.total_amount.toFixed(2)}` : '-'}</td>
                <td className="p-2 text-right tabular-nums">{po.grand_total ? `₹${po.grand_total.toFixed(2)}` : '-'}</td>
                <td className="p-2 space-x-2">
                  <button
                    onClick={() => router.push(`/dashboard/purchase-orders/${po.id}`)}
                    className="text-primary underline"
                  >
                    View
                  </button>
                  <button
                    onClick={() => handleDelete(po)}
                    disabled={deletingId === po.id}
                    className="text-destructive underline disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    {deletingId === po.id && <Loader2 className="size-3 animate-spin" />}
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
    </div>
  )
}

export default function PurchaseOrdersPageGuarded() {
  return (
    <RequireOwner>
      <PurchaseOrdersPage />
    </RequireOwner>
  )
}

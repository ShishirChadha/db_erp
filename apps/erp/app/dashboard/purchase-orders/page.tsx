'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import RequireOwner from '@/components/RequireOwner'
import { ErrorBanner } from '@/components/ErrorBanner'
import { Pagination } from '@/components/Pagination'
import { StatusBadge } from '@/components/StatusBadge'
import { PO_STATUS_TONES, toneFor } from '@/lib/status-styles'
import { cn } from '@/lib/utils'
import { PODetailPage } from './[id]/page'

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
  amount_paid: number | null
  payment_status: string | null
  last_payment_date: string | null
}

interface Vendor {
  id: string
  company_name: string
}

// Left-pane list block -- vendor, PO number, date, and status, matching the
// email-client / Zoho-Invoices-style list row used on Sales Ledger.
function PurchaseOrderListItem({ po, active, onOpen }: {
  po: PurchaseOrder
  active: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'w-full text-left px-3 py-2.5 border-b border-border flex items-start gap-2.5 transition-colors',
        active ? 'bg-primary/10' : 'hover:bg-muted'
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-sm text-foreground truncate">{po.vendor_name}</span>
          <span className="text-sm font-medium tabular-nums whitespace-nowrap text-foreground">
            {po.grand_total ? `₹${po.grand_total.toFixed(2)}` : '-'}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2 mt-0.5">
          <p className="text-xs text-muted-foreground truncate">{po.po_number}</p>
          <span className="text-xs text-muted-foreground whitespace-nowrap">{po.po_date}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <StatusBadge tone={toneFor(PO_STATUS_TONES, po.po_status)}>{po.po_status.replace(/_/g, ' ')}</StatusBadge>
        </div>
      </div>
    </button>
  )
}

// Right-pane detail view -- the full PO detail page (line items, receiving,
// vendor payments, submit/cancel/delete, linked purchase invoice creation)
// embedded inline via its own `embedded` mode instead of behind a link-out, so
// everything's readable/actionable without leaving this page. `key={po.id}`
// forces a clean remount per selection -- simpler and safer than trying to
// cancel/guard an in-flight fetch when the user clicks a different row before
// the previous one finishes loading.
function PurchaseOrderDetailPane({ poId, onBack, onDeleted }: {
  poId: string
  onBack: () => void
  onDeleted: () => void
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 pb-0">
        <button type="button" onClick={onBack} className="md:hidden mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="size-4" /> Back to list
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 pt-2">
        <PODetailPage key={poId} poId={poId} embedded onDeleted={onDeleted} />
      </div>
    </div>
  )
}

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
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  // Which PO is open in the right-hand detail pane.
  const [activeId, setActiveId] = useState<string | null>(null)

  const fetchOrders = useCallback(async () => {
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
    // Newest first, matching every other ledger page's date-column default.
    params.set('sort', 'po_date')
    params.set('dir', 'desc')

    const res = await apiFetch(`/api/purchase-orders?${params.toString()}`)
    if (res.ok) {
      const json = await res.json()
      const data: PurchaseOrder[] = json.data || []
      setOrders(data)
      setTotal(json.total || 0)
      // Auto-open the first row on load/refetch, but don't yank focus away from
      // whatever's already open if it's still in the refetched data.
      setActiveId((prev) => (prev && data.some((o) => o.id === prev)) ? prev : (data[0]?.id ?? null))
    } else {
      setError('Failed to load purchase orders.')
      setOrders([])
      setTotal(0)
      setActiveId(null)
    }
    setLoading(false)
  }, [statusFilter, vendorFilter, dateFrom, dateTo, search, page])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  // Any filter change invalidates the current page's meaning -- reset to page 1.
  useEffect(() => { setPage(1) }, [statusFilter, vendorFilter, dateFrom, dateTo, search])

  useEffect(() => {
    apiFetch('/api/vendors').then(async (res) => {
      if (res.ok) setVendors(await res.json())
    })
  }, [])

  const activePo = useMemo(() => orders.find((o) => o.id === activeId) ?? null, [orders, activeId])

  if (loading) return <div className="p-4">Loading...</div>

  return (
    <div className="p-4 flex flex-col" style={{ height: 'calc(100vh - 2rem)' }}>
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

      <div className="flex-1 min-h-0 border rounded overflow-hidden flex">
        {/* List pane -- hidden on mobile once a PO is open, matching an email
            client's drill-in navigation; always visible at md+. */}
        <div className={cn('w-full md:w-[360px] md:flex-shrink-0 border-r border-border flex flex-col', activePo && 'hidden md:flex')}>
          <div className="flex-1 overflow-y-auto">
            {orders.map((po) => (
              <PurchaseOrderListItem
                key={po.id}
                po={po}
                active={po.id === activeId}
                onOpen={() => setActiveId(po.id)}
              />
            ))}
            {orders.length === 0 && (
              <p className="p-4 text-center text-sm text-muted-foreground">No purchase orders found.</p>
            )}
          </div>
          <div className="border-t border-border p-2">
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </div>
        </div>

        {/* Detail pane -- full width on mobile (replaces the list), flex-1 at md+. */}
        <div className={cn('flex-1 min-w-0', !activePo && 'hidden md:flex md:items-center md:justify-center')}>
          {activePo ? (
            <PurchaseOrderDetailPane
              poId={activePo.id}
              onBack={() => setActiveId(null)}
              onDeleted={() => { setActiveId(null); fetchOrders() }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Select a purchase order to view details.</p>
          )}
        </div>
      </div>
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

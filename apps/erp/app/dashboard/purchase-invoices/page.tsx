'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useIsDesktopViewport } from '@/lib/useIsDesktopViewport'
import RequireOwner from '@/components/RequireOwner'
import { StatusBadge } from '@/components/StatusBadge'
import { PAYMENT_STATUS_TONES, toneFor } from '@/lib/status-styles'
import { cn } from '@/lib/utils'

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

// One field in the detail pane's label/value grid -- mirrors Sales Ledger's Field
// helper so both master-detail pages read the same way.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5 border-b border-border grid grid-cols-3 gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2">{children}</span>
    </div>
  )
}

// Right-pane detail view -- a focused summary rather than a re-implementation of
// the full line-item invoice view, which already exists at its own detail route.
function InvoiceDetailPane({ invoice, onBack }: { invoice: Invoice; onBack: () => void }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
        <div className="min-w-0">
          <button type="button" onClick={onBack} className="md:hidden mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowLeft className="size-4" /> Back to list
          </button>
          <h2 className="text-lg font-semibold text-foreground truncate">
            {invoice.purchase_orders?.vendor_name || '—'}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">{invoice.invoice_number}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span className="text-xl font-semibold tabular-nums text-foreground">
            {invoice.grand_total != null ? `₹${invoice.grand_total.toFixed(2)}` : '—'}
          </span>
          <StatusBadge tone={toneFor(PAYMENT_STATUS_TONES, invoice.payment_status)}>{invoice.payment_status}</StatusBadge>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <Field label="Invoice Date">{invoice.invoice_date}</Field>
        <Field label="PO Number">{invoice.purchase_orders?.po_number || '—'}</Field>
        <Field label="Grand Total">
          <span className="tabular-nums">{invoice.grand_total != null ? `₹${invoice.grand_total.toFixed(2)}` : '—'}</span>
        </Field>
        <Field label="Payment Status"><span className="capitalize">{invoice.payment_status}</span></Field>
        <Field label="Payment Date">
          {invoice.last_payment_date ? new Date(invoice.last_payment_date).toLocaleDateString() : '—'}
        </Field>
        <div className="pt-4">
          <Link href={`/dashboard/purchase-invoices/${invoice.id}`} className="text-primary underline text-sm">
            Open full invoice →
          </Link>
        </div>
      </div>
    </div>
  )
}

// Left-pane list block -- vendor (primary), invoice number, date, amount, and a
// payment-status badge, matching Sales Ledger's SaleListItem shape.
function InvoiceListItem({ invoice, active, onOpen }: { invoice: Invoice; active: boolean; onOpen: () => void }) {
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
          <span className="font-medium text-sm text-foreground truncate">{invoice.purchase_orders?.vendor_name || '—'}</span>
          <span className="text-sm font-medium tabular-nums whitespace-nowrap text-foreground">
            {invoice.grand_total != null ? `₹${invoice.grand_total.toFixed(2)}` : '—'}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2 mt-0.5">
          <p className="text-xs text-muted-foreground truncate">{invoice.invoice_number}</p>
          <span className="text-xs text-muted-foreground whitespace-nowrap">{invoice.invoice_date}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <StatusBadge tone={toneFor(PAYMENT_STATUS_TONES, invoice.payment_status)}>{invoice.payment_status}</StatusBadge>
        </div>
      </div>
    </button>
  )
}

function PurchaseInvoicesPage() {
  const router = useRouter()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  // Which invoice is open in the right-hand detail pane.
  const [activeInvoiceId, setActiveInvoiceId] = useState<string | null>(null)
  const isDesktop = useIsDesktopViewport()

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
      const list: Invoice[] = Array.isArray(data) ? data : []
      setInvoices(list)
      // Auto-open the first row on load/refetch, but don't yank focus away from
      // whatever's already open if it's still present after the refetch.
      setActiveInvoiceId((prev) => (prev && list.some((i) => i.id === prev)) ? prev : (isDesktop ? (list[0]?.id ?? null) : null))
    } catch (err: any) {
      console.error('Failed to fetch invoices:', err)
      setError(err.message)
      setInvoices([])
      setActiveInvoiceId(null)
    } finally {
      setLoading(false)
    }
  }, [paymentStatusFilter, search, dateFrom, dateTo])

  useEffect(() => {
    fetchInvoices()
  }, [fetchInvoices])

  // API already returns invoice_date desc (newest first) -- no client-side sort
  // needed now that column-header sorting is dropped along with the table.
  const sortedInvoices = invoices

  const activeInvoice = useMemo(() => sortedInvoices.find(i => i.id === activeInvoiceId) ?? null, [sortedInvoices, activeInvoiceId])

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
    <div className="p-4 flex flex-col h-full">
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

      <div className="flex-1 min-h-[320px] border rounded overflow-hidden flex">
        {/* List pane -- hidden on mobile once an invoice is open, matching Sales
            Ledger's drill-in navigation; always visible at md+. */}
        <div className={cn('w-full md:w-[300px] lg:w-[360px] md:flex-shrink-0 border-r border-border flex flex-col', activeInvoice && 'hidden md:flex')}>
          <div className="flex-1 overflow-y-auto">
            {sortedInvoices.map((inv) => (
              <InvoiceListItem
                key={inv.id}
                invoice={inv}
                active={inv.id === activeInvoiceId}
                onOpen={() => setActiveInvoiceId(inv.id)}
              />
            ))}
            {sortedInvoices.length === 0 && (
              <p className="p-4 text-center text-sm text-muted-foreground">No purchase invoices found.</p>
            )}
          </div>
        </div>

        {/* Detail pane -- full width on mobile (replaces the list), flex-1 at md+. */}
        <div className={cn('flex-1 min-w-0', !activeInvoice && 'hidden md:flex md:items-center md:justify-center')}>
          {activeInvoice ? (
            <InvoiceDetailPane invoice={activeInvoice} onBack={() => setActiveInvoiceId(null)} />
          ) : (
            <p className="text-sm text-muted-foreground">Select an invoice to view details.</p>
          )}
        </div>
      </div>
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

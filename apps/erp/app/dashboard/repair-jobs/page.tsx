'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useRole } from '@/lib/auth/useRole'
import RequirePageAccess from '@/components/RequirePageAccess'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { Pagination } from '@/components/Pagination'
import { StatusBadge } from '@/components/StatusBadge'
import { StatCardsRow } from '@/components/StatCardsRow'
import { EditRepairJobDialog, RepairJobDetail } from '@/components/EditRepairJobDialog'
import { RecordZohoInvoiceDialog } from '@/components/RecordZohoInvoiceDialog'
import { REPAIR_JOB_STATUS_TONES, PAYMENT_STATUS_TONES, toneFor } from '@/lib/status-styles'

type SortField = 'job_date' | 'job_number' | 'customer_name' | 'status' | 'payment_status' | 'amount_charged'
type SortOrder = 'asc' | 'desc'

const PAGE_SIZE = 25

type SaleSummary = { id: string; finalized: boolean; invoice_number: string | null; sale_total: number; amount_paid: number; payment_status: string; payment_account: string; is_deleted?: boolean }

type RepairJob = RepairJobDetail & {
  customers: { customer_name: string; phone: string | null } | null
  sales?: SaleSummary[]
}

// Mirrors app/dashboard/sales/page.tsx's InvoiceCell -- once a job is billed (has one
// or more linked sales -- the labor charge and/or one per consumed part), the same
// Generate Invoice / Record Zoho Invoice # actions are available right here, instead
// of only reachable via a separate trip to Sales Ledger. When a job has more than one
// unfinalized sale (e.g. a labor charge + parts), they're combined into ONE invoice via
// the same finalize-batch route Sales Ledger's own multi-select already uses.
function RepairInvoiceCell({ job, isOwner, onDone }: { job: RepairJob; isOwner: boolean; onDone: () => void }) {
  const [showZohoDialog, setShowZohoDialog] = useState(false)
  const sales = job.sales || []
  if (sales.length === 0) return <span className="text-muted-foreground text-xs">Not billed yet</span>

  const unfinalized = sales.filter((s) => !s.finalized)
  if (unfinalized.length === 0) {
    // All finalized -- show every invoice number (usually just one, but a job's
    // charges could have been invoiced separately at different times).
    const numbers = [...new Set(sales.map((s) => s.invoice_number).filter(Boolean))]
    return <span className="text-success text-xs">✓ {numbers.join(', ')}</span>
  }
  if (!isOwner) return <span className="text-muted-foreground text-xs">Awaiting invoice</span>

  const isExternal = job.invoice_mode === 'external'
  const { run: generateInvoice, pending: generating } = useAsyncAction(async () => {
    const res = unfinalized.length === 1
      ? await apiFetch(`/api/sales/${unfinalized[0].id}/finalize`, { method: 'POST', body: '{}' })
      : await apiFetch(`/api/sales/finalize-batch`, { method: 'POST', body: JSON.stringify({ sale_ids: unfinalized.map((s) => s.id) }) })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      alert(e.error || 'Failed to generate invoice.')
    } else {
      onDone()
    }
  })

  return (
    <>
      {isExternal ? (
        <button onClick={() => setShowZohoDialog(true)} className="text-warning underline text-xs" title="This entity is issuing invoices in Zoho during the transition">
          Record Zoho Invoice #
        </button>
      ) : (
        <button onClick={() => generateInvoice()} disabled={generating} className="text-warning underline text-xs inline-flex items-center gap-1">
          {generating && <Loader2 className="size-3 animate-spin" />}
          Generate Invoice
        </button>
      )}
      {showZohoDialog && (
        <RecordZohoInvoiceDialog saleIds={unfinalized.map((s) => s.id)} onClose={() => setShowZohoDialog(false)} onRecorded={onDone} />
      )}
    </>
  )
}

function JobRow({ job, canEdit, isOwner, onDone, index, variant = 'row' }: { job: RepairJob; canEdit: boolean; isOwner: boolean; onDone: () => void; index: number; variant?: 'row' | 'card' }) {
  const [showEdit, setShowEdit] = useState(false)

  // Once a job is billed (has one or more linked, non-deleted sales), those sales are
  // the source of truth for what's actually charged/paid -- repair_jobs.payment_status/
  // amount_paid freeze at their intake-time value and are never updated afterward (see
  // CLAUDE.md). The list API already computes these aggregates (app/api/repair-jobs/route.ts).
  const billed = (job.sale_count || 0) > 0
  const displayPaymentStatus = billed ? (job.aggregate_payment_status || 'pending') : job.payment_status
  const displayAmountPaid = billed ? (job.total_paid ?? 0) : (job.amount_paid ?? 0)

  const { run: markDone, pending: marking } = useAsyncAction(async () => {
    const res = await apiFetch(`/api/repair-jobs/${job.id}/finalize`, { method: 'POST' })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      alert(e.error || 'Failed to mark done.')
    } else {
      onDone()
    }
  })

  const actions = canEdit ? (
    <div className="flex items-center gap-3">
      <button onClick={() => setShowEdit(true)} className="text-primary underline text-xs">Edit</button>
      {job.status !== 'done' && (
        <button onClick={() => markDone()} disabled={marking} className="text-success underline text-xs flex items-center gap-1">
          {marking && <Loader2 className="size-3 animate-spin" />}Mark Done
        </button>
      )}
    </div>
  ) : null

  const editDialog = showEdit && (
    <EditRepairJobDialog job={job} onClose={() => setShowEdit(false)} onSaved={onDone} />
  )

  if (variant === 'card') {
    return (
      <div className="border rounded-lg p-3 space-y-2">
        <div className="flex justify-between items-start gap-2">
          <div>
            <div className="text-xs text-muted-foreground">{job.job_date?.slice(0, 10) || '—'}</div>
            <div className="font-medium">{job.job_number}</div>
            {job.is_own_stock && <div className="text-xs text-muted-foreground">Our stock</div>}
          </div>
          <StatusBadge tone={toneFor(REPAIR_JOB_STATUS_TONES, job.status)}>{job.status.replace(/_/g, ' ')}</StatusBadge>
        </div>
        <div className="text-sm">{job.customers?.customer_name || '—'}</div>
        <div className="text-sm text-muted-foreground">{job.problem_description || job.customer_device_description || '—'}</div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <StatusBadge tone={toneFor(PAYMENT_STATUS_TONES, displayPaymentStatus)}>{displayPaymentStatus}</StatusBadge>
          <span className="tabular-nums">₹{displayAmountPaid.toFixed(2)}</span>
          <span>{job.payment_account || '—'}</span>
        </div>
        <RepairInvoiceCell job={job} isOwner={isOwner} onDone={onDone} />
        {canEdit && <div className="pt-1 border-t">{actions}</div>}
        {editDialog}
      </div>
    )
  }

  return (
    <tr>
      <td className="border p-2 text-right tabular-nums text-muted-foreground">{index + 1}</td>
      <td className="border p-2 whitespace-nowrap">{job.job_date?.slice(0, 10) || '—'}</td>
      <td className="border p-2">{job.job_number}{job.is_own_stock ? ' (our stock)' : ''}</td>
      <td className="border p-2">{job.customers?.customer_name || '—'}</td>
      <td className="border p-2 max-w-xs truncate">{job.problem_description || job.customer_device_description || '—'}</td>
      <td className="border p-2"><StatusBadge tone={toneFor(REPAIR_JOB_STATUS_TONES, job.status)}>{job.status.replace(/_/g, ' ')}</StatusBadge></td>
      <td className="border p-2"><StatusBadge tone={toneFor(PAYMENT_STATUS_TONES, displayPaymentStatus)}>{displayPaymentStatus}</StatusBadge></td>
      <td className="border p-2 text-right tabular-nums">₹{displayAmountPaid.toFixed(2)}</td>
      <td className="border p-2">{job.payment_account || '—'}</td>
      <td className="border p-2"><RepairInvoiceCell job={job} isOwner={isOwner} onDone={onDone} /></td>
      {canEdit && (
        <td className="border p-2 space-y-1">{actions}{editDialog}</td>
      )}
    </tr>
  )
}

function RepairJobsPage() {
  const { canEditPage, isOwner } = useRole()
  const canEdit = canEditPage('repair_jobs')
  const [jobs, setJobs] = useState<RepairJob[]>([])
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  // searchInput updates on every keystroke; searchTerm catches up 300ms after typing
  // stops and is what actually drives the fetch -- same debounce pattern as StockView.
  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(searchInput), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const [sortField, setSortField] = useState<SortField>('job_date')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))
    else { setSortField(field); setSortOrder('desc') }
  }
  const sortIndicator = (field: SortField) => (sortField === field ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : '')

  // Summary counts shown as clickable stat cards -- independent of the active status
  // filter/page, but respects the search term so the numbers stay consistent with
  // what's actually reachable through the search box.
  const [statCounts, setStatCounts] = useState({ total: 0, open: 0, done: 0, cancelled: 0 })
  const fetchStats = useCallback(async () => {
    const params = new URLSearchParams()
    if (searchTerm) params.set('search', searchTerm)
    const res = await apiFetch(`/api/repair-jobs?${params.toString()}`)
    if (res.ok) {
      const all: RepairJob[] = await res.json()
      setStatCounts({
        total: all.length,
        open: all.filter(j => j.status === 'intake' || j.status === 'in_progress').length,
        done: all.filter(j => j.status === 'done').length,
        cancelled: all.filter(j => j.status === 'cancelled').length,
      })
    }
  }, [searchTerm])

  const fetchJobs = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (searchTerm) params.set('search', searchTerm)
    params.set('sort', sortField)
    params.set('order', sortOrder)
    params.set('page', String(page))
    params.set('limit', String(PAGE_SIZE))
    const res = await apiFetch(`/api/repair-jobs?${params.toString()}`)
    if (res.ok) {
      const json = await res.json()
      setJobs(json.data || [])
      setTotal(json.total || 0)
    } else {
      setJobs([])
    }
    setLoading(false)
  }, [statusFilter, searchTerm, sortField, sortOrder, page])

  useEffect(() => { fetchJobs() }, [fetchJobs])
  useEffect(() => { fetchStats() }, [fetchStats])

  const refresh = () => { fetchJobs(); fetchStats() }

  // Any filter change invalidates the current page's meaning -- reset to page 1.
  useEffect(() => { setPage(1) }, [statusFilter, searchTerm])

  return (
    <div className="p-4">
      <div className="flex justify-between items-start gap-4 mb-4">
        <h1 className="text-2xl font-bold">Repair Jobs</h1>
        <Link href="/dashboard/entry/service?return_to=%2Fdashboard%2Frepair-jobs" className="bg-primary text-primary-foreground px-4 py-2 rounded text-sm font-medium shrink-0">
          + New Service Entry
        </Link>
      </div>

      <StatCardsRow
        cards={[
          { label: 'Total', value: statCounts.total, active: !statusFilter, onClick: () => setStatusFilter('') },
          { label: 'Open', value: statCounts.open, active: statusFilter === 'intake,in_progress', onClick: () => setStatusFilter('intake,in_progress') },
          { label: 'Done', value: statCounts.done, active: statusFilter === 'done', onClick: () => setStatusFilter('done') },
          { label: 'Cancelled', value: statCounts.cancelled, active: statusFilter === 'cancelled', onClick: () => setStatusFilter('cancelled') },
        ]}
      />

      <div className="flex gap-4 mb-4 flex-wrap items-center">
        <input
          type="text"
          placeholder="Search job #, problem, device, or customer..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="border p-2 rounded"
        />
        {(statusFilter || searchInput) && (
          <button onClick={() => { setStatusFilter(''); setSearchInput(''); setSearchTerm('') }} className="text-sm text-muted-foreground underline">
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : (
        <div className="hidden md:block overflow-x-auto">
          <table className="min-w-full border text-sm">
            <thead>
              <tr>
                <th className="border p-2 w-10 text-right">#</th>
                <th className="border p-2 cursor-pointer select-none" onClick={() => toggleSort('job_date')}>
                  Date{sortIndicator('job_date')}
                </th>
                <th className="border p-2 cursor-pointer select-none" onClick={() => toggleSort('job_number')}>
                  Job #{sortIndicator('job_number')}
                </th>
                <th className="border p-2 cursor-pointer select-none" onClick={() => toggleSort('customer_name')}>
                  Customer{sortIndicator('customer_name')}
                </th>
                <th className="border p-2">Problem / Device</th>
                <th className="border p-2 cursor-pointer select-none" onClick={() => toggleSort('status')}>
                  Status{sortIndicator('status')}
                </th>
                <th className="border p-2 cursor-pointer select-none" onClick={() => toggleSort('payment_status')}>
                  Payment{sortIndicator('payment_status')}
                </th>
                <th className="border p-2">Amount Paid</th>
                <th className="border p-2">Received Into</th>
                <th className="border p-2">Invoice</th>
                {canEdit && <th className="border p-2">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {jobs.map((job, idx) => <JobRow key={job.id} job={job} canEdit={canEdit} isOwner={isOwner} onDone={refresh} index={(page - 1) * PAGE_SIZE + idx} />)}
              {jobs.length === 0 && (
                <tr><td colSpan={canEdit ? 11 : 10} className="border p-4 text-center text-muted-foreground">No repair jobs found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && (
        <div className="md:hidden space-y-2">
          {jobs.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No repair jobs found.</p>}
          {jobs.map((job, idx) => (
            <JobRow key={job.id} job={job} canEdit={canEdit} isOwner={isOwner} onDone={refresh} index={(page - 1) * PAGE_SIZE + idx} variant="card" />
          ))}
        </div>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
    </div>
  )
}

export default function RepairJobsPageGuarded() {
  return (
    <RequirePageAccess pageKey="repair_jobs">
      <RepairJobsPage />
    </RequirePageAccess>
  )
}

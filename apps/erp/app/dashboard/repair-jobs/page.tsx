'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { Loader2, ArrowLeft } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useIsDesktopViewport } from '@/lib/useIsDesktopViewport'
import { useRole } from '@/lib/auth/useRole'
import RequirePageAccess from '@/components/RequirePageAccess'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { Pagination } from '@/components/Pagination'
import { StatusBadge } from '@/components/StatusBadge'
import { StatCardsRow } from '@/components/StatCardsRow'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { RepairJobDetail } from '@/components/EditRepairJobDialog'
import { REPAIR_JOB_STATUS_TONES, PAYMENT_STATUS_TONES, toneFor } from '@/lib/status-styles'
import { cn } from '@/lib/utils'

// Modal dialogs only render behind a click (gated by a state flag) -- code-split
// out of the initial bundle rather than shipped unconditionally.
const EditRepairJobDialog = dynamic(() => import('@/components/EditRepairJobDialog').then(m => m.EditRepairJobDialog), { ssr: false })
const RecordZohoInvoiceDialog = dynamic(() => import('@/components/RecordZohoInvoiceDialog').then(m => m.RecordZohoInvoiceDialog), { ssr: false })

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
        <Button variant="link" size="sm" onClick={() => setShowZohoDialog(true)} className="text-warning text-xs" title="This entity is issuing invoices in Zoho during the transition">
          Record Zoho Invoice #
        </Button>
      ) : (
        <Button variant="link" size="sm" onClick={() => generateInvoice()} disabled={generating} className="text-warning text-xs inline-flex items-center gap-1">
          {generating && <Loader2 className="size-3 animate-spin" />}
          Generate Invoice
        </Button>
      )}
      {showZohoDialog && (
        <RecordZohoInvoiceDialog saleIds={unfinalized.map((s) => s.id)} onClose={() => setShowZohoDialog(false)} onRecorded={onDone} />
      )}
    </>
  )
}

// One field in the detail pane's label/value grid -- keeps every row's spacing and
// label styling consistent without repeating the wrapper markup (matches Sales Ledger's
// own Field helper).
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5 border-b border-border grid grid-cols-3 gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2">{children}</span>
    </div>
  )
}

// Left-pane list block -- deliberately just the fields the user scans a job list by
// (customer, job #, date, job status + payment status), matching Sales Ledger's list
// row. This single compact block replaces what used to be a separate desktop <tr> AND
// a separate md:hidden card -- both showed essentially the same summary, so there's no
// longer a second, separately-maintained mobile-only variant to keep in sync; the full
// remaining detail (problem/device, amount paid, received into, invoice, actions) now
// lives only in the detail pane.
function JobListItem({ job, active, onOpen }: { job: RepairJob; active: boolean; onOpen: () => void }) {
  const billed = (job.sale_count || 0) > 0
  const displayPaymentStatus = billed ? (job.aggregate_payment_status || 'pending') : job.payment_status

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
          <span className="font-medium text-sm text-foreground truncate">{job.customers?.customer_name || '—'}</span>
        </div>
        <div className="flex items-baseline justify-between gap-2 mt-0.5">
          <p className="text-xs text-muted-foreground truncate">{job.job_number}{job.is_own_stock ? ' (our stock)' : ''}</p>
          <span className="text-xs text-muted-foreground whitespace-nowrap">{job.job_date?.slice(0, 10) || '—'}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <StatusBadge tone={toneFor(REPAIR_JOB_STATUS_TONES, job.status)}>{job.status.replace(/_/g, ' ')}</StatusBadge>
          <StatusBadge tone={toneFor(PAYMENT_STATUS_TONES, displayPaymentStatus)}>{displayPaymentStatus}</StatusBadge>
        </div>
      </div>
    </button>
  )
}

// Right-pane detail view -- everything the old wide table's columns (and the mobile
// card's) showed for one job, now laid out as a single record, matching Sales Ledger's
// SaleDetailPane.
function JobDetailPane({ job, canEdit, isOwner, onDone, onBack }: {
  job: RepairJob
  canEdit: boolean
  isOwner: boolean
  onDone: () => void
  onBack: () => void
}) {
  const [showEdit, setShowEdit] = useState(false)
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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
        <div className="min-w-0">
          <button type="button" onClick={onBack} className="md:hidden mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowLeft className="size-4" /> Back to list
          </button>
          <h2 className="text-lg font-semibold text-foreground truncate">{job.customers?.customer_name || '—'}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{job.job_number}{job.is_own_stock ? ' (our stock)' : ''}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <StatusBadge tone={toneFor(REPAIR_JOB_STATUS_TONES, job.status)}>{job.status.replace(/_/g, ' ')}</StatusBadge>
            <StatusBadge tone={toneFor(PAYMENT_STATUS_TONES, displayPaymentStatus)}>{displayPaymentStatus}</StatusBadge>
          </div>
          {canEdit && (
            <div className="flex items-center gap-3">
              <Button variant="link" size="sm" onClick={() => setShowEdit(true)} className="text-primary text-xs">Edit</Button>
              {job.status !== 'done' && (
                <Button variant="link" size="sm" onClick={() => markDone()} disabled={marking} className="text-success text-xs flex items-center gap-1">
                  {marking && <Loader2 className="size-3 animate-spin" />}Mark Done
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <Field label="Date">{job.job_date?.slice(0, 10) || '—'}</Field>
        <Field label="Problem / Device">{job.problem_description || job.customer_device_description || '—'}</Field>
        {job.customer_device_serial && <Field label="Device Serial">{job.customer_device_serial}</Field>}
        {job.solution_description && <Field label="Solution">{job.solution_description}</Field>}
        <Field label="Amount Paid"><span className="tabular-nums">₹{displayAmountPaid.toFixed(2)}</span></Field>
        <Field label="Received Into">{job.payment_account || '—'}</Field>
        <Field label="Invoice"><RepairInvoiceCell job={job} isOwner={isOwner} onDone={onDone} /></Field>
      </div>

      {showEdit && <EditRepairJobDialog job={job} onClose={() => setShowEdit(false)} onSaved={onDone} />}
    </div>
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
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const isDesktop = useIsDesktopViewport()

  // searchInput updates on every keystroke; searchTerm catches up 300ms after typing
  // stops and is what actually drives the fetch -- same debounce pattern as StockView.
  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(searchInput), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

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
    // Newest job first, matching every other ledger page's date-column default.
    params.set('sort', 'job_date')
    params.set('order', 'desc')
    params.set('page', String(page))
    params.set('limit', String(PAGE_SIZE))
    const res = await apiFetch(`/api/repair-jobs?${params.toString()}`)
    if (res.ok) {
      const json = await res.json()
      const data: RepairJob[] = json.data || []
      setJobs(data)
      setTotal(json.total || 0)
      // Auto-open the first row on load/refetch, but don't yank focus away from
      // whatever's already open if it's still in the refetched data (matches
      // Sales Ledger's own activeSaleId logic).
      setActiveJobId((prev) => (prev && data.some((j) => j.id === prev)) ? prev : (isDesktop ? (data[0]?.id ?? null) : null))
    } else {
      setJobs([])
      setTotal(0)
      setActiveJobId(null)
    }
    setLoading(false)
  }, [statusFilter, searchTerm, page])

  useEffect(() => { fetchJobs() }, [fetchJobs])
  useEffect(() => { fetchStats() }, [fetchStats])

  const refresh = () => { fetchJobs(); fetchStats() }

  // Any filter change invalidates the current page's meaning -- reset to page 1.
  useEffect(() => { setPage(1) }, [statusFilter, searchTerm])

  const activeJob = useMemo(() => jobs.find(j => j.id === activeJobId) ?? null, [jobs, activeJobId])

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex flex-wrap justify-between items-start gap-4 mb-4">
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
        <Input
          type="text"
          placeholder="Search job #, problem, device, or customer..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-64"
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
        <div className="flex-1 min-h-[1100px] md:min-h-[500px] lg:min-h-[320px] border rounded overflow-visible lg:overflow-hidden flex">
          {/* List pane -- hidden on mobile once a job is open, matching an email
              client's drill-in navigation; always visible at md+. */}
          <div className={cn('w-full md:w-[300px] lg:w-[360px] md:flex-shrink-0 border-r border-border flex flex-col', activeJob && 'hidden md:flex')}>
            <div className="flex-1 overflow-visible lg:overflow-y-auto">
              {jobs.map((job) => (
                <JobListItem
                  key={job.id}
                  job={job}
                  active={job.id === activeJobId}
                  onOpen={() => setActiveJobId(job.id)}
                />
              ))}
              {jobs.length === 0 && (
                <p className="p-4 text-center text-sm text-muted-foreground">No repair jobs found.</p>
              )}
            </div>
            <div className="border-t border-border p-2">
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
            </div>
          </div>

          {/* Detail pane -- full width on mobile (replaces the list), flex-1 at md+. */}
          <div className={cn('flex-1 min-w-0', !activeJob && 'hidden md:flex md:items-center md:justify-center')}>
            {activeJob ? (
              <JobDetailPane
                job={activeJob}
                canEdit={canEdit}
                isOwner={isOwner}
                onDone={refresh}
                onBack={() => setActiveJobId(null)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Select a job to view details.</p>
            )}
          </div>
        </div>
      )}
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

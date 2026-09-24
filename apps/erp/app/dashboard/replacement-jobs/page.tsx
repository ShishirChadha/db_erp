'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { Loader2, ArrowLeft } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useIsDesktopViewport } from '@/lib/useIsDesktopViewport'
import { useRole } from '@/lib/auth/useRole'
import RequirePageAccess from '@/components/RequirePageAccess'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { Pagination } from '@/components/Pagination'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { REPAIR_JOB_STATUS_TONES, toneFor } from '@/lib/status-styles'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 25

interface ReplacementJob {
  id: string
  job_number: string
  is_own_stock: boolean
  customer_device_description: string | null
  problem_description: string | null
  status: string
  amount_charged: number | null
  payment_account: string | null
  job_date: string | null
  customers: { customer_name: string; phone: string | null } | null
  old_asset: { asset_number: string | null; serial_number: string | null } | null
  new_asset: { asset_number: string | null; serial_number: string | null } | null
}

// Accessories are sku_master rows like everything else (see docs/decisions.md,
// 2026-07-23), tracked by quantity alone -- so an accessory replacement job is a
// separate table (accessory_replacement_jobs) keyed on sku_id + quantity instead of
// asset_id, mirroring accessory_rma_events' relationship to asset_rma_events.
interface AccessoryReplacementJob {
  id: string
  job_number: string
  is_own_stock: boolean
  old_quantity: number | null
  replacement_quantity: number
  customer_device_description: string | null
  problem_description: string | null
  status: string
  amount_charged: number | null
  payment_account: string | null
  job_date: string | null
  customers: { customer_name: string; phone: string | null } | null
  old_sku: { full_sku_code: string; sku_description: string | null } | null
  new_sku: { full_sku_code: string; sku_description: string | null } | null
}

function unitLabel(u: { asset_number: string | null; serial_number: string | null } | null) {
  if (!u) return '—'
  return u.asset_number || (u.serial_number ? `SN: ${u.serial_number}` : '—')
}

function skuLabel(s: { full_sku_code: string; sku_description: string | null } | null) {
  if (!s) return '—'
  return s.sku_description || s.full_sku_code
}

// One field in the detail pane's label/value grid -- keeps every row's spacing
// and label styling consistent without repeating the wrapper markup (matches
// the Sales Ledger reference implementation).
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5 border-b border-border grid grid-cols-3 gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2">{children}</span>
    </div>
  )
}

function MarkDoneButton({ status, isOwner, onMarkDone, pending }: { status: string; isOwner: boolean; onMarkDone: () => void; pending: boolean }) {
  if (!isOwner || status === 'done') return null
  return (
    <Button variant="link" size="sm" onClick={onMarkDone} disabled={pending} className="text-success text-xs inline-flex items-center gap-1">
      {pending && <Loader2 className="size-3 animate-spin" />}Mark Done
    </Button>
  )
}

// Left-pane list block -- customer, the old→new swap, date and status, matching the
// Sales Ledger reference (email/Zoho-Invoices-style list row); everything else lives
// in the detail pane.
function JobListItem({ job, swapLabel, active, onOpen }: {
  job: ReplacementJob | AccessoryReplacementJob
  swapLabel: string
  active: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'w-full text-left px-3 py-2.5 border-b border-border flex flex-col gap-0.5 transition-colors',
        active ? 'bg-primary/10' : 'hover:bg-muted'
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-sm text-foreground truncate">{job.customers?.customer_name || '—'}</span>
        <span className="text-sm font-medium tabular-nums whitespace-nowrap text-foreground">₹{job.amount_charged?.toFixed(2) ?? '—'}</span>
      </div>
      <p className="text-xs text-muted-foreground truncate">{swapLabel}</p>
      <div className="flex items-baseline justify-between gap-2 mt-1">
        <StatusBadge tone={toneFor(REPAIR_JOB_STATUS_TONES, job.status)}>{job.status.replace(/_/g, ' ')}</StatusBadge>
        <span className="text-xs text-muted-foreground whitespace-nowrap">{job.job_date?.slice(0, 10) || '—'}</span>
      </div>
    </button>
  )
}

// Right-pane detail view for a unit replacement job.
function JobDetailPane({ job, isOwner, onDone, onBack }: {
  job: ReplacementJob
  isOwner: boolean
  onDone: () => void
  onBack: () => void
}) {
  const { run: markDone, pending: marking } = useAsyncAction(async () => {
    const res = await apiFetch(`/api/replacement-jobs/${job.id}/finalize`, { method: 'POST' })
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
          <span className="text-xl font-semibold tabular-nums text-foreground">₹{job.amount_charged?.toFixed(2) ?? '—'}</span>
          <StatusBadge tone={toneFor(REPAIR_JOB_STATUS_TONES, job.status)}>{job.status.replace(/_/g, ' ')}</StatusBadge>
          <MarkDoneButton status={job.status} isOwner={isOwner} onMarkDone={markDone} pending={marking} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <Field label="Date">{job.job_date?.slice(0, 10) || '—'}</Field>
        <Field label="Old Unit">{unitLabel(job.old_asset)}</Field>
        <Field label="New Unit">{unitLabel(job.new_asset)}</Field>
        <Field label="Reason / Device">{job.problem_description || job.customer_device_description || '—'}</Field>
        <Field label="Received Into">{job.payment_account || '—'}</Field>
      </div>
    </div>
  )
}

// Right-pane detail view for an accessory replacement job.
function AccessoryJobDetailPane({ job, isOwner, onDone, onBack }: {
  job: AccessoryReplacementJob
  isOwner: boolean
  onDone: () => void
  onBack: () => void
}) {
  const { run: markDone, pending: marking } = useAsyncAction(async () => {
    const res = await apiFetch(`/api/accessory-replacement-jobs/${job.id}/finalize`, { method: 'POST' })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      alert(e.error || 'Failed to mark done.')
    } else {
      onDone()
    }
  })

  const oldLabel = job.is_own_stock ? `${skuLabel(job.old_sku)} x${job.old_quantity}` : '—'
  const newLabel = `${skuLabel(job.new_sku)} x${job.replacement_quantity}`

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
          <span className="text-xl font-semibold tabular-nums text-foreground">₹{job.amount_charged?.toFixed(2) ?? '—'}</span>
          <StatusBadge tone={toneFor(REPAIR_JOB_STATUS_TONES, job.status)}>{job.status.replace(/_/g, ' ')}</StatusBadge>
          <MarkDoneButton status={job.status} isOwner={isOwner} onMarkDone={markDone} pending={marking} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <Field label="Date">{job.job_date?.slice(0, 10) || '—'}</Field>
        <Field label="Old Accessory">{oldLabel}</Field>
        <Field label="New Accessory">{newLabel}</Field>
        <Field label="Reason / Device">{job.problem_description || job.customer_device_description || '—'}</Field>
        <Field label="Received Into">{job.payment_account || '—'}</Field>
      </div>
    </div>
  )
}

function ReplacementJobsPage() {
  const { isOwner } = useRole()
  const [itemKind, setItemKind] = useState<'unit' | 'accessory'>('unit')
  const [jobs, setJobs] = useState<ReplacementJob[]>([])
  const [accessoryJobs, setAccessoryJobs] = useState<AccessoryReplacementJob[]>([])
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  // Which job is open in the right-hand detail pane (separate ids per tab so
  // switching tabs doesn't try to match an id from the other job type).
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const isDesktop = useIsDesktopViewport()

  const fetchJobs = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    params.set('page', String(page))
    params.set('limit', String(PAGE_SIZE))
    const res = await apiFetch(`/api/replacement-jobs?${params.toString()}`)
    if (res.ok) {
      const json = await res.json()
      const data: ReplacementJob[] = json.data || []
      setJobs(data)
      setTotal(json.total || 0)
      setActiveJobId((prev) => (prev && data.some((j) => j.id === prev)) ? prev : (isDesktop ? (data[0]?.id ?? null) : null))
    } else {
      setJobs([])
      setActiveJobId(null)
    }
    setLoading(false)
  }, [statusFilter, page])

  // accessory_replacement_jobs isn't paginated server-side (a much smaller list in
  // practice than serialized replacement jobs) -- same non-paginated GET shape as
  // /api/accessory-rma.
  const fetchAccessoryJobs = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    const res = await apiFetch(`/api/accessory-replacement-jobs?${params.toString()}`)
    if (res.ok) {
      const data: AccessoryReplacementJob[] = await res.json()
      setAccessoryJobs(data)
      setActiveJobId((prev) => (prev && data.some((j) => j.id === prev)) ? prev : (isDesktop ? (data[0]?.id ?? null) : null))
    } else {
      setAccessoryJobs([])
      setActiveJobId(null)
    }
    setLoading(false)
  }, [statusFilter])

  useEffect(() => {
    if (itemKind === 'unit') fetchJobs()
    else fetchAccessoryJobs()
  }, [itemKind, fetchJobs, fetchAccessoryJobs])

  // Any filter change invalidates the current page's meaning -- reset to page 1.
  useEffect(() => { setPage(1) }, [statusFilter])

  const newJobHref = itemKind === 'unit'
    ? '/dashboard/entry/service?subtype=replacement&return_to=%2Fdashboard%2Freplacement-jobs'
    : '/dashboard/entry/service?subtype=replacement&item_kind=accessory&return_to=%2Fdashboard%2Freplacement-jobs'

  const refresh = itemKind === 'unit' ? fetchJobs : fetchAccessoryJobs

  const activeJob = useMemo(
    () => (itemKind === 'unit' ? jobs.find(j => j.id === activeJobId) ?? null : null),
    [itemKind, jobs, activeJobId]
  )
  const activeAccessoryJob = useMemo(
    () => (itemKind === 'accessory' ? accessoryJobs.find(j => j.id === activeJobId) ?? null : null),
    [itemKind, accessoryJobs, activeJobId]
  )
  const hasActive = itemKind === 'unit' ? !!activeJob : !!activeAccessoryJob

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex flex-wrap justify-between items-start gap-4 mb-4">
        <h1 className="text-2xl font-bold">Replacement Jobs</h1>
        <Link href={newJobHref} className="bg-primary text-primary-foreground px-4 py-2 rounded text-sm font-medium shrink-0">
          + New Replacement
        </Link>
      </div>

      <div className="flex gap-2 mb-4 border-b">
        <button
          onClick={() => { setItemKind('unit'); setActiveJobId(null) }}
          className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${itemKind === 'unit' ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`}
        >
          Units
        </button>
        <button
          onClick={() => { setItemKind('accessory'); setActiveJobId(null) }}
          className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${itemKind === 'accessory' ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`}
        >
          Accessories
        </button>
      </div>

      <Select value={statusFilter || 'all'} onValueChange={(v) => setStatusFilter(v === 'all' ? '' : v)}>
        <SelectTrigger className="w-auto mb-4"><SelectValue placeholder="All Statuses" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="intake,in_progress">Open</SelectItem>
          <SelectItem value="done">Done</SelectItem>
          <SelectItem value="cancelled">Cancelled</SelectItem>
        </SelectContent>
      </Select>

      {loading ? (
        <div>Loading...</div>
      ) : (
        <div className="flex-1 min-h-[1100px] md:min-h-[500px] lg:min-h-[320px] border rounded overflow-visible lg:overflow-hidden flex">
          {/* List pane -- hidden on mobile once a job is open, matching an
              email client's drill-in navigation; always visible at md+. */}
          <div className={cn('w-full md:w-[300px] lg:w-[360px] md:flex-shrink-0 border-r border-border flex flex-col', hasActive && 'hidden md:flex')}>
            <div className="flex-1 overflow-visible lg:overflow-y-auto">
              {itemKind === 'unit' ? (
                <>
                  {jobs.map((job) => (
                    <JobListItem
                      key={job.id}
                      job={job}
                      swapLabel={`Old: ${unitLabel(job.old_asset)} → New: ${unitLabel(job.new_asset)}`}
                      active={job.id === activeJobId}
                      onOpen={() => setActiveJobId(job.id)}
                    />
                  ))}
                  {jobs.length === 0 && (
                    <p className="p-4 text-center text-sm text-muted-foreground">No replacement jobs found.</p>
                  )}
                </>
              ) : (
                <>
                  {accessoryJobs.map((job) => {
                    const oldLabel = job.is_own_stock ? `${skuLabel(job.old_sku)} x${job.old_quantity}` : '—'
                    const newLabel = `${skuLabel(job.new_sku)} x${job.replacement_quantity}`
                    return (
                      <JobListItem
                        key={job.id}
                        job={job}
                        swapLabel={`Old: ${oldLabel} → New: ${newLabel}`}
                        active={job.id === activeJobId}
                        onOpen={() => setActiveJobId(job.id)}
                      />
                    )
                  })}
                  {accessoryJobs.length === 0 && (
                    <p className="p-4 text-center text-sm text-muted-foreground">No accessory replacement jobs found.</p>
                  )}
                </>
              )}
            </div>
            {itemKind === 'unit' && (
              <div className="border-t border-border p-2">
                <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
              </div>
            )}
          </div>

          {/* Detail pane -- full width on mobile (replaces the list), flex-1 at md+. */}
          <div className={cn('flex-1 min-w-0', !hasActive && 'hidden md:flex md:items-center md:justify-center')}>
            {itemKind === 'unit' && activeJob ? (
              <JobDetailPane job={activeJob} isOwner={isOwner} onDone={refresh} onBack={() => setActiveJobId(null)} />
            ) : itemKind === 'accessory' && activeAccessoryJob ? (
              <AccessoryJobDetailPane job={activeAccessoryJob} isOwner={isOwner} onDone={refresh} onBack={() => setActiveJobId(null)} />
            ) : (
              <p className="text-sm text-muted-foreground">Select a replacement job to view details.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ReplacementJobsPageGuarded() {
  return (
    <RequirePageAccess pageKey="replacement_jobs">
      <ReplacementJobsPage />
    </RequirePageAccess>
  )
}

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
import { REPAIR_JOB_STATUS_TONES, toneFor } from '@/lib/status-styles'

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

function JobRow({ job, isOwner, onDone, index, variant = 'row' }: { job: ReplacementJob; isOwner: boolean; onDone: () => void; index: number; variant?: 'row' | 'card' }) {
  const { run: markDone, pending: marking } = useAsyncAction(async () => {
    const res = await apiFetch(`/api/replacement-jobs/${job.id}/finalize`, { method: 'POST' })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      alert(e.error || 'Failed to mark done.')
    } else {
      onDone()
    }
  })

  const doneButton = isOwner && job.status !== 'done' ? (
    <button onClick={() => markDone()} disabled={marking} className="text-success underline text-xs flex items-center gap-1">
      {marking && <Loader2 className="size-3 animate-spin" />}Mark Done
    </button>
  ) : null

  if (variant === 'card') {
    return (
      <div className="border rounded-lg p-3 space-y-2">
        <div className="flex justify-between items-start gap-2">
          <div>
            <div className="font-medium">{job.job_number}</div>
            {job.is_own_stock && <div className="text-xs text-muted-foreground">Our stock</div>}
          </div>
          <StatusBadge tone={toneFor(REPAIR_JOB_STATUS_TONES, job.status)}>{job.status.replace(/_/g, ' ')}</StatusBadge>
        </div>
        <div className="text-sm">{job.customers?.customer_name || '—'}</div>
        <div className="text-xs text-muted-foreground">Old: {unitLabel(job.old_asset)} → New: {unitLabel(job.new_asset)}</div>
        <div className="text-sm text-muted-foreground">{job.problem_description || job.customer_device_description || '—'}</div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">₹{job.amount_charged?.toFixed(2) ?? '—'}</span>
          <span>{job.payment_account || '—'}</span>
        </div>
        {doneButton && <div className="pt-1 border-t">{doneButton}</div>}
      </div>
    )
  }

  return (
    <tr>
      <td className="border p-2 text-right tabular-nums text-muted-foreground">{index + 1}</td>
      <td className="border p-2">{job.job_number}{job.is_own_stock ? ' (our stock)' : ''}</td>
      <td className="border p-2">{job.customers?.customer_name || '—'}</td>
      <td className="border p-2">{unitLabel(job.old_asset)}</td>
      <td className="border p-2">{unitLabel(job.new_asset)}</td>
      <td className="border p-2 max-w-xs truncate">{job.problem_description || job.customer_device_description || '—'}</td>
      <td className="border p-2"><StatusBadge tone={toneFor(REPAIR_JOB_STATUS_TONES, job.status)}>{job.status.replace(/_/g, ' ')}</StatusBadge></td>
      <td className="border p-2 text-right tabular-nums">₹{job.amount_charged?.toFixed(2) ?? '—'}</td>
      <td className="border p-2">{job.payment_account || '—'}</td>
      {isOwner && <td className="border p-2">{doneButton}</td>}
    </tr>
  )
}

function AccessoryJobRow({ job, isOwner, onDone, index, variant = 'row' }: { job: AccessoryReplacementJob; isOwner: boolean; onDone: () => void; index: number; variant?: 'row' | 'card' }) {
  const { run: markDone, pending: marking } = useAsyncAction(async () => {
    const res = await apiFetch(`/api/accessory-replacement-jobs/${job.id}/finalize`, { method: 'POST' })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      alert(e.error || 'Failed to mark done.')
    } else {
      onDone()
    }
  })

  const doneButton = isOwner && job.status !== 'done' ? (
    <button onClick={() => markDone()} disabled={marking} className="text-success underline text-xs flex items-center gap-1">
      {marking && <Loader2 className="size-3 animate-spin" />}Mark Done
    </button>
  ) : null

  const oldLabel = job.is_own_stock ? `${skuLabel(job.old_sku)} x${job.old_quantity}` : '—'
  const newLabel = `${skuLabel(job.new_sku)} x${job.replacement_quantity}`

  if (variant === 'card') {
    return (
      <div className="border rounded-lg p-3 space-y-2">
        <div className="flex justify-between items-start gap-2">
          <div>
            <div className="font-medium">{job.job_number}</div>
            {job.is_own_stock && <div className="text-xs text-muted-foreground">Our stock</div>}
          </div>
          <StatusBadge tone={toneFor(REPAIR_JOB_STATUS_TONES, job.status)}>{job.status.replace(/_/g, ' ')}</StatusBadge>
        </div>
        <div className="text-sm">{job.customers?.customer_name || '—'}</div>
        <div className="text-xs text-muted-foreground">Old: {oldLabel} → New: {newLabel}</div>
        <div className="text-sm text-muted-foreground">{job.problem_description || job.customer_device_description || '—'}</div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">₹{job.amount_charged?.toFixed(2) ?? '—'}</span>
          <span>{job.payment_account || '—'}</span>
        </div>
        {doneButton && <div className="pt-1 border-t">{doneButton}</div>}
      </div>
    )
  }

  return (
    <tr>
      <td className="border p-2 text-right tabular-nums text-muted-foreground">{index + 1}</td>
      <td className="border p-2">{job.job_number}{job.is_own_stock ? ' (our stock)' : ''}</td>
      <td className="border p-2">{job.customers?.customer_name || '—'}</td>
      <td className="border p-2">{oldLabel}</td>
      <td className="border p-2">{newLabel}</td>
      <td className="border p-2 max-w-xs truncate">{job.problem_description || job.customer_device_description || '—'}</td>
      <td className="border p-2"><StatusBadge tone={toneFor(REPAIR_JOB_STATUS_TONES, job.status)}>{job.status.replace(/_/g, ' ')}</StatusBadge></td>
      <td className="border p-2 text-right tabular-nums">₹{job.amount_charged?.toFixed(2) ?? '—'}</td>
      <td className="border p-2">{job.payment_account || '—'}</td>
      {isOwner && <td className="border p-2">{doneButton}</td>}
    </tr>
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

  const fetchJobs = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    params.set('page', String(page))
    params.set('limit', String(PAGE_SIZE))
    const res = await apiFetch(`/api/replacement-jobs?${params.toString()}`)
    if (res.ok) {
      const json = await res.json()
      setJobs(json.data || [])
      setTotal(json.total || 0)
    } else {
      setJobs([])
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
    if (res.ok) setAccessoryJobs(await res.json())
    else setAccessoryJobs([])
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

  return (
    <div className="p-4">
      <div className="flex justify-between items-start gap-4 mb-4">
        <h1 className="text-2xl font-bold">Replacement Jobs</h1>
        <Link href={newJobHref} className="bg-primary text-primary-foreground px-4 py-2 rounded text-sm font-medium shrink-0">
          + New Replacement
        </Link>
      </div>

      <div className="flex gap-2 mb-4 border-b">
        <button
          onClick={() => setItemKind('unit')}
          className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${itemKind === 'unit' ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`}
        >
          Units
        </button>
        <button
          onClick={() => setItemKind('accessory')}
          className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${itemKind === 'accessory' ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`}
        >
          Accessories
        </button>
      </div>

      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border p-2 rounded mb-4">
        <option value="">All Statuses</option>
        <option value="intake,in_progress">Open</option>
        <option value="done">Done</option>
        <option value="cancelled">Cancelled</option>
      </select>

      {loading ? (
        <div>Loading...</div>
      ) : itemKind === 'unit' ? (
        <>
          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full border text-sm">
              <thead>
                <tr>
                  <th className="border p-2 w-10 text-right">#</th>
                  <th className="border p-2">Job #</th>
                  <th className="border p-2">Customer</th>
                  <th className="border p-2">Old Unit</th>
                  <th className="border p-2">New Unit</th>
                  <th className="border p-2">Reason / Device</th>
                  <th className="border p-2">Status</th>
                  <th className="border p-2">Amount</th>
                  <th className="border p-2">Received Into</th>
                  {isOwner && <th className="border p-2">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {jobs.map((job, idx) => <JobRow key={job.id} job={job} isOwner={isOwner} onDone={fetchJobs} index={(page - 1) * PAGE_SIZE + idx} />)}
                {jobs.length === 0 && (
                  <tr><td colSpan={isOwner ? 10 : 9} className="border p-4 text-center text-muted-foreground">No replacement jobs found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-2">
            {jobs.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No replacement jobs found.</p>}
            {jobs.map((job, idx) => (
              <JobRow key={job.id} job={job} isOwner={isOwner} onDone={fetchJobs} index={(page - 1) * PAGE_SIZE + idx} variant="card" />
            ))}
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </>
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full border text-sm">
              <thead>
                <tr>
                  <th className="border p-2 w-10 text-right">#</th>
                  <th className="border p-2">Job #</th>
                  <th className="border p-2">Customer</th>
                  <th className="border p-2">Old Accessory</th>
                  <th className="border p-2">New Accessory</th>
                  <th className="border p-2">Reason / Device</th>
                  <th className="border p-2">Status</th>
                  <th className="border p-2">Amount</th>
                  <th className="border p-2">Received Into</th>
                  {isOwner && <th className="border p-2">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {accessoryJobs.map((job, idx) => <AccessoryJobRow key={job.id} job={job} isOwner={isOwner} onDone={fetchAccessoryJobs} index={idx} />)}
                {accessoryJobs.length === 0 && (
                  <tr><td colSpan={isOwner ? 10 : 9} className="border p-4 text-center text-muted-foreground">No accessory replacement jobs found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="md:hidden space-y-2">
            {accessoryJobs.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No accessory replacement jobs found.</p>}
            {accessoryJobs.map((job, idx) => (
              <AccessoryJobRow key={job.id} job={job} isOwner={isOwner} onDone={fetchAccessoryJobs} index={idx} variant="card" />
            ))}
          </div>
        </>
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

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

function unitLabel(u: { asset_number: string | null; serial_number: string | null } | null) {
  if (!u) return '—'
  return u.asset_number || (u.serial_number ? `SN: ${u.serial_number}` : '—')
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
    <button onClick={() => markDone()} disabled={marking} className="text-green-700 underline text-xs flex items-center gap-1">
      {marking && <Loader2 className="size-3 animate-spin" />}Mark Done
    </button>
  ) : null

  if (variant === 'card') {
    return (
      <div className="border rounded-lg p-3 space-y-2">
        <div className="flex justify-between items-start gap-2">
          <div>
            <div className="font-medium">{job.job_number}</div>
            {job.is_own_stock && <div className="text-xs text-gray-500">Our stock</div>}
          </div>
          <StatusBadge tone={toneFor(REPAIR_JOB_STATUS_TONES, job.status)}>{job.status.replace(/_/g, ' ')}</StatusBadge>
        </div>
        <div className="text-sm">{job.customers?.customer_name || '—'}</div>
        <div className="text-xs text-gray-600">Old: {unitLabel(job.old_asset)} → New: {unitLabel(job.new_asset)}</div>
        <div className="text-sm text-gray-600">{job.problem_description || job.customer_device_description || '—'}</div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
          <span className="tabular-nums">₹{job.amount_charged?.toFixed(2) ?? '—'}</span>
          <span>{job.payment_account || '—'}</span>
        </div>
        {doneButton && <div className="pt-1 border-t">{doneButton}</div>}
      </div>
    )
  }

  return (
    <tr>
      <td className="border p-2 text-right tabular-nums text-gray-400">{index + 1}</td>
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

function ReplacementJobsPage() {
  const { isOwner } = useRole()
  const [jobs, setJobs] = useState<ReplacementJob[]>([])
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

  useEffect(() => { fetchJobs() }, [fetchJobs])

  // Any filter change invalidates the current page's meaning -- reset to page 1.
  useEffect(() => { setPage(1) }, [statusFilter])

  return (
    <div className="p-4">
      <div className="flex justify-between items-start gap-4 mb-4">
        <h1 className="text-2xl font-bold">Replacement Jobs</h1>
        <Link href="/dashboard/entry/service?subtype=replacement&return_to=%2Fdashboard%2Freplacement-jobs" className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium shrink-0">
          + New Replacement
        </Link>
      </div>

      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border p-2 rounded mb-4">
        <option value="">All Statuses</option>
        <option value="intake,in_progress">Open</option>
        <option value="done">Done</option>
        <option value="cancelled">Cancelled</option>
      </select>

      {loading ? (
        <div>Loading...</div>
      ) : (
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
                <tr><td colSpan={isOwner ? 10 : 9} className="border p-4 text-center text-gray-400">No replacement jobs found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && (
        <div className="md:hidden space-y-2">
          {jobs.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No replacement jobs found.</p>}
          {jobs.map((job, idx) => (
            <JobRow key={job.id} job={job} isOwner={isOwner} onDone={fetchJobs} index={(page - 1) * PAGE_SIZE + idx} variant="card" />
          ))}
        </div>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
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

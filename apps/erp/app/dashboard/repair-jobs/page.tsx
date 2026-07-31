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
import { REPAIR_JOB_STATUS_TONES, PAYMENT_STATUS_TONES, toneFor } from '@/lib/status-styles'

const PAGE_SIZE = 25

interface RepairJob {
  id: string
  job_number: string
  is_own_stock: boolean
  customer_device_description: string | null
  problem_description: string | null
  status: string
  payment_status: string
  amount_charged: number | null
  amount_paid: number
  payment_account: string | null
  customers: { customer_name: string; phone: string | null } | null
}

const PAYMENT_ACCOUNTS = ['Digitalbluez', 'Techtenth', 'Cash']

function JobRow({ job, isOwner, onDone, index, variant = 'row' }: { job: RepairJob; isOwner: boolean; onDone: () => void; index: number; variant?: 'row' | 'card' }) {
  const [paymentStatus, setPaymentStatus] = useState(job.payment_status)
  const [amountPaid, setAmountPaid] = useState(job.amount_paid || 0)
  const [paymentAccount, setPaymentAccount] = useState(job.payment_account || '')
  const [err, setErr] = useState('')

  const { run: savePayment, pending: saving } = useAsyncAction(async () => {
    setErr('')
    try {
      const res = await apiFetch(`/api/repair-jobs/${job.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ payment_status: paymentStatus, amount_paid: amountPaid, payment_account: paymentAccount || null }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to save.')
      onDone()
    } catch (e: any) {
      setErr(e.message)
    }
  })

  const { run: markDone, pending: marking } = useAsyncAction(async () => {
    const res = await apiFetch(`/api/repair-jobs/${job.id}/finalize`, { method: 'POST' })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      alert(e.error || 'Failed to mark done.')
    } else {
      onDone()
    }
  })

  const busy = saving || marking

  const paymentEditor = isOwner ? (
    <div className="flex flex-wrap items-center gap-2">
      <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className="border p-1 rounded text-xs">
        <option value="pending">Pending</option>
        <option value="partial">Partial</option>
        <option value="paid">Paid</option>
      </select>
      <input type="number" value={amountPaid} onChange={(e) => setAmountPaid(Number(e.target.value))} className="border p-1 w-20 rounded text-xs" placeholder="Amount paid" />
      <select value={paymentAccount} onChange={(e) => setPaymentAccount(e.target.value)} className="border p-1 rounded text-xs">
        <option value="">Received into —</option>
        {PAYMENT_ACCOUNTS.map(a => <option key={a} value={a}>{a}</option>)}
      </select>
    </div>
  ) : null

  const actions = isOwner ? (
    <div className="flex items-center gap-3">
      {err && <div className="text-red-600 text-xs">{err}</div>}
      <button onClick={() => savePayment()} disabled={busy} className="text-blue-600 underline text-xs flex items-center gap-1">
        {saving && <Loader2 className="size-3 animate-spin" />}Save
      </button>
      {job.status !== 'done' && (
        <button onClick={() => markDone()} disabled={busy} className="text-green-700 underline text-xs flex items-center gap-1">
          {marking && <Loader2 className="size-3 animate-spin" />}Mark Done
        </button>
      )}
    </div>
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
        <div className="text-sm text-gray-600">{job.problem_description || job.customer_device_description || '—'}</div>
        {isOwner ? paymentEditor : (
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
            <StatusBadge tone={toneFor(PAYMENT_STATUS_TONES, job.payment_status)}>{job.payment_status}</StatusBadge>
            <span className="tabular-nums">₹{job.amount_paid?.toFixed(2)}</span>
            <span>{job.payment_account || '—'}</span>
          </div>
        )}
        {isOwner && <div className="pt-1 border-t">{actions}</div>}
      </div>
    )
  }

  return (
    <tr>
      <td className="border p-2 text-right tabular-nums text-gray-400">{index + 1}</td>
      <td className="border p-2">{job.job_number}{job.is_own_stock ? ' (our stock)' : ''}</td>
      <td className="border p-2">{job.customers?.customer_name || '—'}</td>
      <td className="border p-2 max-w-xs truncate">{job.problem_description || job.customer_device_description || '—'}</td>
      <td className="border p-2"><StatusBadge tone={toneFor(REPAIR_JOB_STATUS_TONES, job.status)}>{job.status.replace(/_/g, ' ')}</StatusBadge></td>
      {isOwner ? (
        <>
          <td className="border p-2">
            <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className="border p-1 rounded text-xs">
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
            </select>
          </td>
          <td className="border p-2">
            <input type="number" value={amountPaid} onChange={(e) => setAmountPaid(Number(e.target.value))} className="border p-1 w-20 rounded text-xs" />
          </td>
          <td className="border p-2">
            <select value={paymentAccount} onChange={(e) => setPaymentAccount(e.target.value)} className="border p-1 rounded text-xs">
              <option value="">—</option>
              {PAYMENT_ACCOUNTS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </td>
          <td className="border p-2 space-y-1">
            {err && <div className="text-red-600 text-xs">{err}</div>}
            <button onClick={() => savePayment()} disabled={busy} className="text-blue-600 underline text-xs flex items-center gap-1">
              {saving && <Loader2 className="size-3 animate-spin" />}Save
            </button>
            {job.status !== 'done' && (
              <button onClick={() => markDone()} disabled={busy} className="text-green-700 underline text-xs flex items-center gap-1">
                {marking && <Loader2 className="size-3 animate-spin" />}Mark Done
              </button>
            )}
          </td>
        </>
      ) : (
        <>
          <td className="border p-2"><StatusBadge tone={toneFor(PAYMENT_STATUS_TONES, job.payment_status)}>{job.payment_status}</StatusBadge></td>
          <td className="border p-2 text-right tabular-nums">₹{job.amount_paid?.toFixed(2)}</td>
          <td className="border p-2">{job.payment_account || '—'}</td>
        </>
      )}
    </tr>
  )
}

function RepairJobsPage() {
  const { isOwner } = useRole()
  const [jobs, setJobs] = useState<RepairJob[]>([])
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
    const res = await apiFetch(`/api/repair-jobs?${params.toString()}`)
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
        <h1 className="text-2xl font-bold">Repair Jobs</h1>
        <Link href="/dashboard/entry/service?return_to=%2Fdashboard%2Frepair-jobs" className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium shrink-0">
          + New Service Entry
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
                <th className="border p-2">Problem / Device</th>
                <th className="border p-2">Status</th>
                <th className="border p-2">Payment</th>
                <th className="border p-2">Amount Paid</th>
                <th className="border p-2">Received Into</th>
                {isOwner && <th className="border p-2">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {jobs.map((job, idx) => <JobRow key={job.id} job={job} isOwner={isOwner} onDone={fetchJobs} index={(page - 1) * PAGE_SIZE + idx} />)}
              {jobs.length === 0 && (
                <tr><td colSpan={isOwner ? 9 : 8} className="border p-4 text-center text-gray-400">No repair jobs found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && (
        <div className="md:hidden space-y-2">
          {jobs.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No repair jobs found.</p>}
          {jobs.map((job, idx) => (
            <JobRow key={job.id} job={job} isOwner={isOwner} onDone={fetchJobs} index={(page - 1) * PAGE_SIZE + idx} variant="card" />
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

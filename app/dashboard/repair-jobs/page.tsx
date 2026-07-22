'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useRole } from '@/lib/auth/useRole'
import RequirePageAccess from '@/components/RequirePageAccess'

interface RepairJob {
  id: string
  job_number: string
  job_type: 'repair' | 'replacement'
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

function JobRow({ job, isOwner, onDone }: { job: RepairJob; isOwner: boolean; onDone: () => void }) {
  const [paymentStatus, setPaymentStatus] = useState(job.payment_status)
  const [amountPaid, setAmountPaid] = useState(job.amount_paid || 0)
  const [paymentAccount, setPaymentAccount] = useState(job.payment_account || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const savePayment = async () => {
    setErr('')
    setBusy(true)
    try {
      const res = await apiFetch(`/api/repair-jobs/${job.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ payment_status: paymentStatus, amount_paid: amountPaid, payment_account: paymentAccount || null }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to save.')
      onDone()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const markDone = async () => {
    setBusy(true)
    const res = await apiFetch(`/api/repair-jobs/${job.id}/finalize`, { method: 'POST' })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      alert(e.error || 'Failed to mark done.')
    } else {
      onDone()
    }
    setBusy(false)
  }

  return (
    <tr>
      <td className="border p-2">{job.job_number}</td>
      <td className="border p-2 capitalize">{job.job_type}{job.is_own_stock ? ' (our stock)' : ''}</td>
      <td className="border p-2">{job.customers?.customer_name || '—'}</td>
      <td className="border p-2 max-w-xs truncate">{job.problem_description || job.customer_device_description || '—'}</td>
      <td className="border p-2 capitalize">{job.status.replace(/_/g, ' ')}</td>
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
            <button onClick={savePayment} disabled={busy} className="text-blue-600 underline text-xs block">Save</button>
            {job.status !== 'done' && (
              <button onClick={markDone} disabled={busy} className="text-green-700 underline text-xs block">Mark Done</button>
            )}
          </td>
        </>
      ) : (
        <>
          <td className="border p-2 capitalize">{job.payment_status}</td>
          <td className="border p-2">₹{job.amount_paid?.toFixed(2)}</td>
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

  const fetchJobs = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    const res = await apiFetch(`/api/repair-jobs?${params.toString()}`)
    setJobs(res.ok ? await res.json() : [])
    setLoading(false)
  }, [statusFilter])

  useEffect(() => { fetchJobs() }, [fetchJobs])

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Repair Jobs</h1>

      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border p-2 rounded mb-4">
        <option value="">All Statuses</option>
        <option value="intake,in_progress">Open</option>
        <option value="done">Done</option>
        <option value="cancelled">Cancelled</option>
      </select>

      {loading ? (
        <div>Loading...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border text-sm">
            <thead>
              <tr>
                <th className="border p-2">Job #</th>
                <th className="border p-2">Type</th>
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
              {jobs.map(job => <JobRow key={job.id} job={job} isOwner={isOwner} onDone={fetchJobs} />)}
              {jobs.length === 0 && (
                <tr><td colSpan={isOwner ? 9 : 8} className="border p-4 text-center text-gray-400">No repair jobs found.</td></tr>
              )}
            </tbody>
          </table>
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

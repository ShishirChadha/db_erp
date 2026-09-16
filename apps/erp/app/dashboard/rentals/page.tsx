'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api-client'
import { useRole } from '@/lib/auth/useRole'
import RequirePageAccess from '@/components/RequirePageAccess'
import { Pagination } from '@/components/Pagination'
import { StatusBadge } from '@/components/StatusBadge'
import { StatCardsRow } from '@/components/StatCardsRow'
import { RENTAL_STATUS_TONES, toneFor } from '@/lib/status-styles'
import { NewRentalDialog } from '@/components/NewRentalDialog'

type SortField = 'start_date' | 'agreement_number' | 'expected_return_date' | 'rent_amount' | 'next_billing_date'
type SortOrder = 'asc' | 'desc'
const PAGE_SIZE = 25

interface RentalAgreement {
  id: string
  agreement_number: string
  customer_name: string | null
  customer_phone: string | null
  status: string
  start_date: string
  expected_return_date: string | null
  billing_interval: string
  rent_amount: number
  payment_account: string | null
  next_billing_date: string | null
  security_deposit_amount: number | null
  units_on_rent: number
  units_total: number
  is_overdue: boolean
}

const INTERVAL_LABELS: Record<string, string> = {
  one_time: 'One-time',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
}

function money(n: number | null | undefined) {
  if (n == null) return '—'
  return `₹${Math.round(Number(n)).toLocaleString('en-IN')}`
}

function day(d: string | null | undefined) {
  if (!d) return '—'
  const dt = new Date(`${d}T12:00:00.000Z`)
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

// One row component, two renders -- the table row and the phone card share all state
// and derived values rather than being maintained as two separate components.
function RentalRow({ agreement, index, variant = 'row' }: {
  agreement: RentalAgreement
  index: number
  variant?: 'row' | 'card'
}) {
  const a = agreement
  const statusBadge = (
    <StatusBadge tone={toneFor(RENTAL_STATUS_TONES, a.status)}>{a.status}</StatusBadge>
  )
  const overdueBadge = a.is_overdue ? (
    <span className="text-xs font-medium text-destructive">Overdue</span>
  ) : null
  const units = `${a.units_on_rent} / ${a.units_total}`

  if (variant === 'card') {
    return (
      <div className="border rounded-lg p-3 space-y-2">
        <div className="flex justify-between items-start gap-2">
          <div>
            <div className="text-xs text-gray-500">{day(a.start_date)}</div>
            <Link href={`/dashboard/rentals/${a.id}`} className="font-medium underline">
              {a.agreement_number}
            </Link>
          </div>
          <div className="flex flex-col items-end gap-1">{statusBadge}{overdueBadge}</div>
        </div>
        <div className="text-sm">{a.customer_name || '—'}</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
          <span>{units} out</span>
          <span>{INTERVAL_LABELS[a.billing_interval] || a.billing_interval}</span>
          <span className="tabular-nums">{money(a.rent_amount)}</span>
          {a.payment_account && <span>{a.payment_account}</span>}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
          <span>Due back: {day(a.expected_return_date)}</span>
          <span>Next bill: {day(a.next_billing_date)}</span>
        </div>
      </div>
    )
  }

  return (
    <tr className="border-t">
      <td className="p-2 text-right text-gray-500">{index + 1}</td>
      <td className="p-2 whitespace-nowrap">{day(a.start_date)}</td>
      <td className="p-2 whitespace-nowrap">
        <Link href={`/dashboard/rentals/${a.id}`} className="underline font-medium">{a.agreement_number}</Link>
      </td>
      <td className="p-2">{a.customer_name || '—'}</td>
      <td className="p-2 text-right tabular-nums">{units}</td>
      <td className="p-2">{INTERVAL_LABELS[a.billing_interval] || a.billing_interval}</td>
      <td className="p-2 text-right tabular-nums">{money(a.rent_amount)}</td>
      <td className="p-2 text-right tabular-nums">{money(a.security_deposit_amount)}</td>
      <td className="p-2 whitespace-nowrap">{day(a.expected_return_date)}</td>
      <td className="p-2 whitespace-nowrap">{day(a.next_billing_date)}</td>
      <td className="p-2">
        <div className="flex flex-col gap-1 items-start">{statusBadge}{overdueBadge}</div>
      </td>
    </tr>
  )
}

function RentalsPage() {
  const { canEditPage } = useRole()
  const canEdit = canEditPage('rentals')
  const [agreements, setAgreements] = useState<RentalAgreement[]>([])
  const [statusFilter, setStatusFilter] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [showNew, setShowNew] = useState(false)

  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(searchInput), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const [sortField, setSortField] = useState<SortField>('start_date')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    else { setSortField(field); setSortOrder('desc') }
  }
  const sortIndicator = (field: SortField) => (sortField === field ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : '')

  const [statCounts, setStatCounts] = useState({ total: 0, active: 0, closed: 0, due_to_bill: 0, overdue: 0 })
  const fetchStats = useCallback(async () => {
    const res = await apiFetch('/api/rentals?counts=true')
    if (res.ok) setStatCounts(await res.json())
  }, [])

  const fetchAgreements = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (searchTerm) params.set('search', searchTerm)
    params.set('sort', sortField)
    params.set('order', sortOrder)
    params.set('page', String(page))
    params.set('limit', String(PAGE_SIZE))
    const res = await apiFetch(`/api/rentals?${params.toString()}`)
    if (res.ok) {
      const json = await res.json()
      setAgreements(json.data || [])
      setTotal(json.total || 0)
    } else {
      setAgreements([])
    }
    setLoading(false)
  }, [statusFilter, searchTerm, sortField, sortOrder, page])

  useEffect(() => { fetchAgreements() }, [fetchAgreements])
  useEffect(() => { fetchStats() }, [fetchStats])

  const refresh = () => { fetchAgreements(); fetchStats() }

  useEffect(() => { setPage(1) }, [statusFilter, searchTerm, overdueOnly])

  // Overdue is a derived property, not a stored status, so it filters client-side over
  // the current page rather than becoming a server-side status value.
  const displayed = overdueOnly ? agreements.filter((a) => a.is_overdue) : agreements

  return (
    <div>
      <div className="flex justify-between items-start gap-4 mb-4">
        <h1 className="text-2xl font-bold">Rentals</h1>
        {canEdit && (
          <button
            onClick={() => setShowNew(true)}
            className="bg-primary text-primary-foreground px-4 py-2 rounded text-sm font-medium shrink-0"
          >
            + New Rental
          </button>
        )}
      </div>

      <StatCardsRow
        cards={[
          { label: 'Total', value: statCounts.total, active: !statusFilter && !overdueOnly, onClick: () => { setStatusFilter(''); setOverdueOnly(false) } },
          { label: 'Active', value: statCounts.active, active: statusFilter === 'active' && !overdueOnly, onClick: () => { setStatusFilter('active'); setOverdueOnly(false) } },
          { label: 'Overdue', value: statCounts.overdue, active: overdueOnly, onClick: () => { setStatusFilter('active'); setOverdueOnly(true) } },
          { label: 'Due to Bill', value: statCounts.due_to_bill, active: false, onClick: () => { setStatusFilter('active'); setOverdueOnly(false) } },
          { label: 'Closed', value: statCounts.closed, active: statusFilter === 'closed', onClick: () => { setStatusFilter('closed'); setOverdueOnly(false) } },
        ]}
      />

      <div className="flex gap-4 mb-4 flex-wrap items-center">
        <input
          type="text"
          placeholder="Search agreement #, customer, or notes..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="border p-2 rounded"
        />
        {(statusFilter || searchInput || overdueOnly) && (
          <button
            onClick={() => { setStatusFilter(''); setSearchInput(''); setSearchTerm(''); setOverdueOnly(false) }}
            className="text-sm text-muted-foreground underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2 text-right w-10">#</th>
                  <th className="p-2 text-left cursor-pointer" onClick={() => toggleSort('start_date')}>Start{sortIndicator('start_date')}</th>
                  <th className="p-2 text-left cursor-pointer" onClick={() => toggleSort('agreement_number')}>Agreement #{sortIndicator('agreement_number')}</th>
                  <th className="p-2 text-left">Customer</th>
                  <th className="p-2 text-right">Out / Total</th>
                  <th className="p-2 text-left">Billing</th>
                  <th className="p-2 text-right cursor-pointer" onClick={() => toggleSort('rent_amount')}>Rent{sortIndicator('rent_amount')}</th>
                  <th className="p-2 text-right">Deposit</th>
                  <th className="p-2 text-left cursor-pointer" onClick={() => toggleSort('expected_return_date')}>Due Back{sortIndicator('expected_return_date')}</th>
                  <th className="p-2 text-left cursor-pointer" onClick={() => toggleSort('next_billing_date')}>Next Bill{sortIndicator('next_billing_date')}</th>
                  <th className="p-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {displayed.length === 0 ? (
                  <tr><td colSpan={11} className="p-4 text-center text-muted-foreground">No rental agreements found.</td></tr>
                ) : displayed.map((a, idx) => (
                  <RentalRow key={a.id} agreement={a} index={(page - 1) * PAGE_SIZE + idx} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-2">
            {displayed.length === 0 ? (
              <p className="p-4 text-center text-muted-foreground">No rental agreements found.</p>
            ) : displayed.map((a, idx) => (
              <RentalRow key={a.id} agreement={a} index={(page - 1) * PAGE_SIZE + idx} variant="card" />
            ))}
          </div>

          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </>
      )}

      {showNew && (
        <NewRentalDialog onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); refresh() }} />
      )}
    </div>
  )
}

export default function RentalsPageGuarded() {
  return (
    <RequirePageAccess pageKey="rentals">
      <RentalsPage />
    </RequirePageAccess>
  )
}

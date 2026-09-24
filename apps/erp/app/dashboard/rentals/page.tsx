'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useIsDesktopViewport } from '@/lib/useIsDesktopViewport'
import { useRole } from '@/lib/auth/useRole'
import RequirePageAccess from '@/components/RequirePageAccess'
import { Pagination } from '@/components/Pagination'
import { StatusBadge } from '@/components/StatusBadge'
import { StatCardsRow } from '@/components/StatCardsRow'
import { Input } from '@/components/ui/input'
import { RENTAL_STATUS_TONES, toneFor } from '@/lib/status-styles'
import { cn } from '@/lib/utils'

// Only renders behind a click (gated by a state flag) -- code-split out of the
// initial bundle rather than shipped unconditionally.
const NewRentalDialog = dynamic(() => import('@/components/NewRentalDialog').then(m => m.NewRentalDialog), { ssr: false })

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

// Overdue is derived (see CLAUDE.md), not a stored status -- the badge shown here
// mirrors the detail page's own status + overdue presentation.
function displayStatus(a: RentalAgreement) {
  if (a.is_overdue) return 'Overdue'
  return a.status
}

// One field in the detail pane's label/value grid -- matches SaleDetailPane's Field
// helper on the Sales Ledger reference implementation.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5 border-b border-border grid grid-cols-3 gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2">{children}</span>
    </div>
  )
}

// Left-pane list block -- customer, agreement #, due-back date (the actionable date
// for day-to-day rental watching, since overdue units are what staff need to catch),
// and status, matching the Sales Ledger's SaleListItem pattern. Rent amount sits
// top-right like the sale total there.
function RentalListItem({ agreement, active, onOpen }: {
  agreement: RentalAgreement
  active: boolean
  onOpen: () => void
}) {
  const a = agreement
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
          <span className="font-medium text-sm text-foreground truncate">{a.customer_name || '—'}</span>
          <span className="text-sm font-medium tabular-nums whitespace-nowrap text-foreground">{money(a.rent_amount)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-2 mt-0.5">
          <p className="text-xs text-muted-foreground truncate">{a.agreement_number}</p>
          <span className="text-xs text-muted-foreground whitespace-nowrap">Due {day(a.expected_return_date)}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <StatusBadge tone={a.is_overdue ? 'danger' : toneFor(RENTAL_STATUS_TONES, a.status)}>{displayStatus(a)}</StatusBadge>
        </div>
      </div>
    </button>
  )
}

// Right-pane detail view -- a solid summary of the agreement (the fields that used
// to live in the table's remaining columns) plus a prominent link into the existing
// full agreement page at /dashboard/rentals/[id], which already owns line items,
// billing cycles, and deposit/return/buyout actions -- not re-implemented here.
function RentalDetailPane({ agreement, onBack }: { agreement: RentalAgreement; onBack: () => void }) {
  const a = agreement
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
        <div className="min-w-0">
          <button type="button" onClick={onBack} className="md:hidden mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowLeft className="size-4" /> Back to list
          </button>
          <h2 className="text-lg font-semibold text-foreground truncate">{a.customer_name || '—'}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{a.agreement_number}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span className="text-xl font-semibold tabular-nums text-foreground">{money(a.rent_amount)}</span>
          <StatusBadge tone={a.is_overdue ? 'danger' : toneFor(RENTAL_STATUS_TONES, a.status)}>{displayStatus(a)}</StatusBadge>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <Field label="Start Date">{day(a.start_date)}</Field>
        <Field label="Due Back">{day(a.expected_return_date)}</Field>
        <Field label="Out / Total"><span className="tabular-nums">{a.units_on_rent} / {a.units_total}</span></Field>
        <Field label="Billing">{INTERVAL_LABELS[a.billing_interval] || a.billing_interval}</Field>
        <Field label="Next Bill">{day(a.next_billing_date)}</Field>
        <Field label="Deposit"><span className="tabular-nums">{money(a.security_deposit_amount)}</span></Field>
        <Field label="Received Into">{a.payment_account || '—'}</Field>
        {a.customer_phone && <Field label="Phone">{a.customer_phone}</Field>}
      </div>

      <div className="p-4 border-t border-border">
        <Link
          href={`/dashboard/rentals/${a.id}`}
          className="inline-flex items-center gap-1.5 text-primary underline text-sm font-medium"
        >
          Open full agreement <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </div>
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
  // Which agreement is open in the right-hand detail pane.
  const [activeId, setActiveId] = useState<string | null>(null)
  const isDesktop = useIsDesktopViewport()

  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(searchInput), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const sortField: SortField = 'start_date'
  const sortOrder: SortOrder = 'desc'

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
      const data: RentalAgreement[] = json.data || []
      setAgreements(data)
      setTotal(json.total || 0)
      // Auto-open the first row on load/refetch, but don't yank focus away from
      // whatever's already open if it's still in the refetched data.
      setActiveId((prev) => (prev && data.some((a) => a.id === prev)) ? prev : (isDesktop ? (data[0]?.id ?? null) : null))
    } else {
      setAgreements([])
      setTotal(0)
      setActiveId(null)
    }
    setLoading(false)
  }, [statusFilter, searchTerm, page])

  useEffect(() => { fetchAgreements() }, [fetchAgreements])
  useEffect(() => { fetchStats() }, [fetchStats])

  const refresh = () => { fetchAgreements(); fetchStats() }

  useEffect(() => { setPage(1) }, [statusFilter, searchTerm, overdueOnly])

  // Overdue is a derived property, not a stored status, so it filters client-side over
  // the current page rather than becoming a server-side status value.
  const displayed = overdueOnly ? agreements.filter((a) => a.is_overdue) : agreements

  const activeAgreement = useMemo(
    () => displayed.find((a) => a.id === activeId) ?? null,
    [displayed, activeId]
  )

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex flex-wrap justify-between items-start gap-4 mb-4">
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

      <div className="flex gap-4 mb-2 flex-wrap items-center">
        <Input
          type="text"
          placeholder="Search agreement #, customer, or notes..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-64"
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
        <div className="flex-1 min-h-[1100px] md:min-h-[500px] lg:min-h-[320px] border rounded overflow-visible lg:overflow-hidden flex">
          {/* List pane -- hidden on mobile once an agreement is open, matching an
              email client's drill-in navigation; always visible at md+. */}
          <div className={cn('w-full md:w-[300px] lg:w-[360px] md:flex-shrink-0 border-r border-border flex flex-col', activeAgreement && 'hidden md:flex')}>
            <div className="flex-1 overflow-visible lg:overflow-y-auto">
              {displayed.map((a) => (
                <RentalListItem
                  key={a.id}
                  agreement={a}
                  active={a.id === activeId}
                  onOpen={() => setActiveId(a.id)}
                />
              ))}
              {displayed.length === 0 && (
                <p className="p-4 text-center text-sm text-muted-foreground">No rental agreements found.</p>
              )}
            </div>
            <div className="border-t border-border p-2">
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
            </div>
          </div>

          {/* Detail pane -- full width on mobile (replaces the list), flex-1 at md+. */}
          <div className={cn('flex-1 min-w-0', !activeAgreement && 'hidden md:flex md:items-center md:justify-center')}>
            {activeAgreement ? (
              <RentalDetailPane agreement={activeAgreement} onBack={() => setActiveId(null)} />
            ) : (
              <p className="text-sm text-muted-foreground">Select a rental agreement to view details.</p>
            )}
          </div>
        </div>
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

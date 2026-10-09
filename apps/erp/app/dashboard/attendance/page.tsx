'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import RequirePageAccess from '@/components/RequirePageAccess'
import { useRole } from '@/lib/auth/useRole'
import { apiFetch } from '@/lib/api-client'
import { ErrorBanner } from '@/components/ErrorBanner'
import { StatCardsRow } from '@/components/StatCardsRow'
import { Pagination } from '@/components/Pagination'
import { useListPageSize } from '@/lib/useListPageSize'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PunchWidget } from '@/components/PunchWidget'
import { DayRegister, type RegisterRow } from '@/components/attendance/DayRegister'
import { MonthSummaryTable, type SummaryRow } from '@/components/attendance/MonthSummaryTable'
import { LeaveRequestsTable, type LeaveRow } from '@/components/attendance/LeaveRequestsTable'
import { istToday } from '@/lib/attendance'
import { cn } from '@/lib/utils'
import { Loader2, Plus } from 'lucide-react'

// Code-split: only one tab's dialog is ever open, and the correction dialog in
// particular pulls in the punch log.
const CorrectDayDialog = dynamic(
  () => import('@/components/attendance/CorrectDayDialog').then(m => m.CorrectDayDialog),
  { ssr: false },
)
const StaffCalendar = dynamic(
  () => import('@/components/attendance/StaffCalendar').then(m => m.StaffCalendar),
  { ssr: false },
)
const NewLeaveRequestDialog = dynamic(
  () => import('@/components/attendance/NewLeaveRequestDialog').then(m => m.NewLeaveRequestDialog),
  { ssr: false },
)
const ApproveLeaveDialog = dynamic(
  () => import('@/components/attendance/ApproveLeaveDialog').then(m => m.ApproveLeaveDialog),
  { ssr: false },
)

type Tab = 'today' | 'register' | 'calendar' | 'monthly' | 'leave'

const TABS: { key: Tab; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'register', label: 'Register' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'leave', label: 'Leave' },
]

function currentMonth() {
  return istToday().slice(0, 7)
}

function AttendancePage() {
  const { canEditPage, isManagerOrAbove } = useRole()
  const canEdit = canEditPage('attendance')

  const [tab, setTab] = useState<Tab>('today')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // ---- register (Today / Register share one fetch shape) ----
  const [date, setDate] = useState(istToday())
  const [rows, setRows] = useState<RegisterRow[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [statusFilter, setStatusFilter] = useState('')
  const [correcting, setCorrecting] = useState<RegisterRow | null>(null)

  // ---- monthly ----
  const [month, setMonth] = useState(currentMonth())
  const [summary, setSummary] = useState<SummaryRow[]>([])

  // ---- leave ----
  const [leaveRows, setLeaveRows] = useState<LeaveRow[]>([])
  const [leaveTotal, setLeaveTotal] = useState(0)
  const [leavePage, setLeavePage] = useState(1)
  const [leaveStatus, setLeaveStatus] = useState('')
  const [newLeaveOpen, setNewLeaveOpen] = useState(false)
  const [deciding, setDeciding] = useState<LeaveRow | null>(null)
  const PAGE_SIZE = useListPageSize()

  // Calendar tab: owns its own correcting state so the refresh can be scoped.
  const [calendarCorrecting, setCalendarCorrecting] = useState<RegisterRow | null>(null)
  const [calendarCorrectingDate, setCalendarCorrectingDate] = useState('')
  const [calendarKey, setCalendarKey] = useState(0)   // bump to force a re-mount after save

  // Today and Register are the same view over a different date -- Today pins it
  // to the current IST date so the common case needs no date picking.
  const activeDate = tab === 'today' ? istToday() : date

  const loadRegister = useCallback(async () => {
    setLoading(true)
    setError('')
    const [regRes, countRes] = await Promise.all([
      apiFetch(`/api/attendance?date=${activeDate}`),
      apiFetch(`/api/attendance?counts=true&date=${activeDate}`),
    ])
    if (!regRes.ok) {
      setError('Could not load the register.')
      setRows([])
    } else {
      const json = await regRes.json()
      setRows(json.rows || [])
    }
    if (countRes.ok) setCounts(await countRes.json())
    setLoading(false)
  }, [activeDate])

  const loadSummary = useCallback(async () => {
    setLoading(true)
    setError('')
    const res = await apiFetch(`/api/attendance/summary?month=${month}`)
    if (!res.ok) {
      setError('Could not load the monthly summary.')
      setSummary([])
    } else {
      const json = await res.json()
      setSummary(json.rows || [])
    }
    setLoading(false)
  }, [month])

  const loadLeave = useCallback(async () => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ page: String(leavePage), limit: String(PAGE_SIZE) })
    if (leaveStatus) params.set('status', leaveStatus)
    const res = await apiFetch(`/api/leave-requests?${params.toString()}`)
    if (!res.ok) {
      setError('Could not load leave requests.')
      setLeaveRows([])
      setLeaveTotal(0)
    } else {
      const json = await res.json()
      setLeaveRows(json.data || [])
      setLeaveTotal(json.total || 0)
    }
    setLoading(false)
  }, [leavePage, leaveStatus, PAGE_SIZE])

  useEffect(() => {
    if (tab === 'today' || tab === 'register') loadRegister()
    else if (tab === 'monthly') loadSummary()
    else loadLeave()
  }, [tab, loadRegister, loadSummary, loadLeave])

  useEffect(() => { setLeavePage(1) }, [leaveStatus])

  const visibleRows = useMemo(() => {
    if (!statusFilter) return rows
    if (statusFilter === 'not_marked') return rows.filter(r => !r.day)
    if (statusFilter === 'late') return rows.filter(r => r.day?.is_late)
    return rows.filter(r => r.day?.status === statusFilter)
  }, [rows, statusFilter])

  const cards = useMemo(() => {
    const spec: { key: string; label: string }[] = [
      { key: 'present', label: 'Present' },
      { key: 'half_day', label: 'Half day' },
      { key: 'absent', label: 'Absent' },
      { key: 'leave', label: 'Leave' },
      { key: 'week_off', label: 'Week off' },
      { key: 'holiday', label: 'Holiday' },
      { key: 'not_marked', label: 'Not marked' },
      { key: 'late', label: 'Late' },
    ]
    return spec.map(s => ({
      label: s.label,
      value: counts[s.key] ?? 0,
      active: statusFilter === s.key,
      onClick: () => setStatusFilter(statusFilter === s.key ? '' : s.key),
    }))
  }, [counts, statusFilter])

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Attendance</h1>
          <p className="text-sm text-muted-foreground">
            {isManagerOrAbove ? 'Punches, corrections and leave for the whole team.' : 'Your attendance and leave.'}
          </p>
        </div>
        {/* The desktop counterpart of the mobile top-bar widget. */}
        <PunchWidget className="w-full sm:w-auto sm:min-w-[20rem]" />
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-3 py-2 text-sm -mb-px border-b-2 transition-colors',
              tab === t.key
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <ErrorBanner message={error} />}

      {(tab === 'today' || tab === 'register') && (
        <div className="space-y-3">
          {tab === 'register' && (
            <div className="flex items-end gap-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Date</label>
                <Input type="date" value={date} max={istToday()} className="h-8 w-auto"
                  onChange={e => setDate(e.target.value)} />
              </div>
            </div>
          )}
          <StatCardsRow cards={cards} />
          {loading && rows.length === 0 ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <DayRegister
              rows={visibleRows}
              canEdit={canEdit && isManagerOrAbove}
              onCorrect={setCorrecting}
              loading={loading}
            />
          )}
        </div>
      )}

      {tab === 'calendar' && (
        <StaffCalendar
          key={calendarKey}
          canEdit={canEdit && isManagerOrAbove}
          onCorrect={(row, date) => { setCalendarCorrecting(row); setCalendarCorrectingDate(date) }}
        />
      )}

      {tab === 'monthly' && (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Month</label>
            <Input type="month" value={month} max={currentMonth()} className="h-8 w-auto"
              onChange={e => setMonth(e.target.value)} />
          </div>
          {loading && summary.length === 0 ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <MonthSummaryTable rows={summary} loading={loading} />
          )}
        </div>
      )}

      {tab === 'leave' && (
        <div className="space-y-3">
          <div className="flex items-end justify-between gap-2 flex-wrap">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Status</label>
              <select value={leaveStatus} onChange={e => setLeaveStatus(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm">
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <Button size="sm" className="h-8" onClick={() => setNewLeaveOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Apply for leave
            </Button>
          </div>
          {loading && leaveRows.length === 0 ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <LeaveRequestsTable
                rows={leaveRows}
                canDecide={canEdit && isManagerOrAbove}
                onDecide={setDeciding}
                loading={loading}
              />
              <Pagination page={leavePage} pageSize={PAGE_SIZE} total={leaveTotal} onPageChange={setLeavePage} />
            </>
          )}
        </div>
      )}

      <CorrectDayDialog
        row={correcting}
        date={activeDate}
        isOpen={!!correcting}
        onClose={() => setCorrecting(null)}
        onSaved={loadRegister}
      />
      <CorrectDayDialog
        row={calendarCorrecting}
        date={calendarCorrectingDate}
        isOpen={!!calendarCorrecting}
        onClose={() => setCalendarCorrecting(null)}
        onSaved={() => { setCalendarCorrecting(null); setCalendarKey(k => k + 1) }}
      />
      <NewLeaveRequestDialog
        isOpen={newLeaveOpen}
        onClose={() => setNewLeaveOpen(false)}
        onSaved={loadLeave}
        canFileForOthers={canEdit}
      />
      <ApproveLeaveDialog
        row={deciding}
        isOpen={!!deciding}
        onClose={() => setDeciding(null)}
        onSaved={loadLeave}
      />
    </div>
  )
}

export default function AttendancePageGuarded() {
  return (
    <RequirePageAccess pageKey="attendance">
      <AttendancePage />
    </RequirePageAccess>
  )
}

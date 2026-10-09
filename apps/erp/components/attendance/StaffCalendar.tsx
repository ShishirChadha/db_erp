'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { ATTENDANCE_STATUSES } from '@/lib/attendance'
import { ATTENDANCE_STATUS_TONES, toneFor } from '@/lib/status-styles'
import { StatusBadge } from '@/components/StatusBadge'
import { formatMinutes, istToday } from '@/lib/attendance'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ErrorBanner } from '@/components/ErrorBanner'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { Loader2, CheckSquare, Square, X } from 'lucide-react'
import type { RegisterRow } from '@/components/attendance/DayRegister'
import { cn } from '@/lib/utils'

interface StaffOption {
  id: string
  full_name: string
  employee_code: string | null
}

interface CalendarDay {
  date: string
  dayOfMonth: number
  isCurrentMonth: boolean
  isPast: boolean
  row: RegisterRow
  hasRecord: boolean   // true if attendance_days row exists for this day
}

function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number)
  const first = `${month}-01`
  const last = new Date(y, m, 0)
  const lastStr = `${month}-${String(last.getDate()).padStart(2, '0')}`
  return { first, last: lastStr, daysInMonth: last.getDate() }
}

function firstDOW(month: string) {
  const d = new Date(`${month}-01`)
  return (d.getDay() + 6) % 7
}

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function currentMonth() {
  return istToday().slice(0, 7)
}

export function StaffCalendar({
  canEdit,
  onCorrect,
}: {
  canEdit: boolean
  onCorrect: (row: RegisterRow, date: string) => void
}) {
  const [staff, setStaff] = useState<StaffOption[]>([])
  const [staffMeta, setStaffMeta] = useState<Record<string, { shift: RegisterRow['shift']; weekly_off_days: number[] }>>({})
  const [selectedId, setSelectedId] = useState('')
  const [month, setMonth] = useState(currentMonth())
  const [days, setDays] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(false)
  const today = istToday()

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false)
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set())
  const [bulkStatus, setBulkStatus] = useState('')
  const [bulkReason, setBulkReason] = useState('')
  const [bulkError, setBulkError] = useState('')
  const [bulkResult, setBulkResult] = useState<{ saved: number; failed: string[] } | null>(null)

  // Load the roster once to get staff list + shift/weekly_off_days metadata.
  useEffect(() => {
    apiFetch(`/api/attendance?date=${today}`).then(async r => {
      if (!r.ok) return
      const json = await r.json()
      const rows: RegisterRow[] = json.rows || []
      const opts: StaffOption[] = rows.map(r => ({ id: r.staff.id, full_name: r.staff.full_name, employee_code: r.staff.employee_code }))
      setStaff(opts)
      const meta: Record<string, { shift: RegisterRow['shift']; weekly_off_days: number[] }> = {}
      rows.forEach(r => { meta[r.staff.id] = { shift: r.shift, weekly_off_days: r.weekly_off_days } })
      setStaffMeta(meta)
      if (opts.length > 0 && !selectedId) setSelectedId(opts[0].id)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMonth = useCallback(async () => {
    if (!selectedId) return
    setLoading(true)
    const { first, last } = monthBounds(month)
    const res = await apiFetch(`/api/attendance?staff_id=${selectedId}&from=${first}&to=${last}`)
    if (res.ok) {
      const rows: any[] = await res.json()
      const map: Record<string, any> = {}
      rows.forEach(r => { map[r.work_date] = r })
      setDays(map)
    }
    setLoading(false)
  }, [selectedId, month])

  useEffect(() => { loadMonth() }, [loadMonth])

  // Clear selections when staff or month changes.
  useEffect(() => {
    setSelectedDates(new Set())
    setBulkResult(null)
    setBulkError('')
  }, [selectedId, month])

  const cells = useMemo<CalendarDay[]>(() => {
    const { daysInMonth } = monthBounds(month)
    const offset = firstDOW(month)
    const out: CalendarDay[] = []

    for (let i = 0; i < offset; i++) {
      const [y, mo] = month.split('-').map(Number)
      const prev = new Date(y, mo - 1, -offset + i + 1)
      const d = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`
      out.push({
        date: d, dayOfMonth: prev.getDate(), isCurrentMonth: false,
        isPast: d < today, hasRecord: false,
        row: { staff: { id: selectedId, full_name: '', employee_code: null }, shift: staffMeta[selectedId]?.shift ?? null, weekly_off_days: staffMeta[selectedId]?.weekly_off_days ?? [], day: null },
      })
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${month}-${String(d).padStart(2, '0')}`
      const staffInfo = staff.find(s => s.id === selectedId)
      const dayRecord = days[dateStr] ?? null
      out.push({
        date: dateStr,
        dayOfMonth: d,
        isCurrentMonth: true,
        isPast: dateStr <= today,
        hasRecord: dayRecord !== null,
        row: {
          staff: { id: selectedId, full_name: staffInfo?.full_name ?? '', employee_code: staffInfo?.employee_code ?? null },
          shift: staffMeta[selectedId]?.shift ?? null,
          weekly_off_days: staffMeta[selectedId]?.weekly_off_days ?? [],
          day: dayRecord,
        },
      })
    }

    return out
  }, [month, days, selectedId, staff, staffMeta, today])

  const toggleDate = (date: string) => {
    setSelectedDates(prev => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
    setBulkResult(null)
    setBulkError('')
  }

  const clearSelection = () => {
    setSelectedDates(new Set())
    setBulkResult(null)
    setBulkError('')
  }

  const exitSelectMode = () => {
    setSelectMode(false)
    clearSelection()
  }

  const saveAll = useAsyncAction(async () => {
    if (!bulkStatus) { setBulkError('Choose a status to apply.'); return }
    if (!bulkReason.trim()) { setBulkError('A reason is required.'); return }
    setBulkError('')
    setBulkResult(null)

    const dates = Array.from(selectedDates).sort()
    const results = await Promise.all(dates.map(async date => {
      const res = await apiFetch('/api/attendance', {
        method: 'POST',
        body: JSON.stringify({ staff_id: selectedId, work_date: date, status: bulkStatus, reason: bulkReason.trim() }),
      })
      if (res.ok) return { date, ok: true }
      const json = await res.json().catch(() => ({}))
      // 409 = race with nightly scan; patch the existing row instead
      if (res.status === 409 && json.existing_id) {
        const patch = await apiFetch(`/api/attendance/${json.existing_id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: bulkStatus, reason: bulkReason.trim() }),
        })
        return { date, ok: patch.ok }
      }
      return { date, ok: false }
    }))

    const failed = results.filter(r => !r.ok).map(r => r.date)
    const saved = results.filter(r => r.ok).length
    setBulkResult({ saved, failed })
    if (saved > 0) {
      clearSelection()
      await loadMonth()
    }
  })

  const selectedStaff = staff.find(s => s.id === selectedId)
  const selectedCount = selectedDates.size

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Staff member</label>
          <select
            value={selectedId}
            onChange={e => { setSelectedId(e.target.value); exitSelectMode() }}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm min-w-[180px]"
          >
            {staff.map(s => (
              <option key={s.id} value={s.id}>
                {s.full_name}{s.employee_code ? ` (${s.employee_code})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Month</label>
          <Input
            type="month"
            value={month}
            max={currentMonth()}
            className="h-8 w-auto"
            onChange={e => { setMonth(e.target.value); exitSelectMode() }}
          />
        </div>
        {canEdit && (
          <Button
            variant={selectMode ? 'default' : 'outline'}
            size="sm"
            className="h-8"
            onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
          >
            {selectMode
              ? <><X className="h-3.5 w-3.5 mr-1" />Exit select</>
              : <><CheckSquare className="h-3.5 w-3.5 mr-1" />Select days</>}
          </Button>
        )}
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mb-1" />}
      </div>

      {selectedStaff && (
        <p className="text-xs text-muted-foreground">
          {selectedStaff.full_name} — {month}
          {selectedStaff.employee_code && ` · ${selectedStaff.employee_code}`}
          {canEdit && !selectMode && <span className="ml-2">Click any day to edit individually.</span>}
          {canEdit && selectMode && <span className="ml-2 text-primary font-medium">Select mode: click blank days to select, then set a status for all at once. Days with records must be edited individually.</span>}
        </p>
      )}

      {bulkResult && (
        <div className={cn('rounded-md border p-2 text-sm', bulkResult.failed.length === 0 ? 'border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-400' : 'border-destructive/30 bg-destructive/5 text-destructive')}>
          {bulkResult.saved > 0 && <span>{bulkResult.saved} day{bulkResult.saved !== 1 ? 's' : ''} saved. </span>}
          {bulkResult.failed.length > 0 && <span>Failed: {bulkResult.failed.join(', ')}</span>}
        </div>
      )}

      {/* Calendar grid */}
      <div className="rounded-md border border-border overflow-hidden">
        <div className="grid grid-cols-7 bg-muted/50 border-b border-border">
          {DOW_LABELS.map(d => (
            <div key={d} className="p-2 text-xs font-medium text-center text-muted-foreground">{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 divide-x divide-y divide-border">
          {cells.map((cell, i) => {
            const isToday = cell.date === today
            const isSelected = selectedDates.has(cell.date)
            const isBlankSelectable = selectMode && cell.isCurrentMonth && cell.isPast && !cell.hasRecord

            const handleClick = () => {
              if (!cell.isCurrentMonth) return
              if (selectMode) {
                if (!cell.hasRecord && cell.isPast) {
                  // Blank past day → toggle selection
                  toggleDate(cell.date)
                }
                // Days with records: do nothing in select mode
              } else if (canEdit) {
                onCorrect(cell.row, cell.date)
              }
            }

            return (
              <div
                key={i}
                onClick={handleClick}
                className={cn(
                  'min-h-[72px] p-1.5 text-xs transition-colors relative',
                  cell.isCurrentMonth ? 'bg-background' : 'bg-muted/20',
                  isToday && !isSelected && 'bg-primary/5',
                  isSelected && 'bg-primary/15 ring-1 ring-inset ring-primary',
                  isBlankSelectable && !isSelected && 'hover:bg-accent',
                  canEdit && !selectMode && cell.isCurrentMonth && 'cursor-pointer hover:bg-accent',
                  selectMode && cell.isCurrentMonth && cell.hasRecord && 'opacity-50',
                  isBlankSelectable && 'cursor-pointer',
                )}
              >
                <div className={cn(
                  'font-medium mb-1 w-5 h-5 flex items-center justify-center rounded-full text-[11px]',
                  isToday && !isSelected && 'bg-primary text-primary-foreground',
                  isSelected && 'bg-primary text-primary-foreground',
                  !cell.isCurrentMonth && 'text-muted-foreground/40',
                )}>
                  {cell.dayOfMonth}
                </div>

                {isSelected && (
                  <div className="absolute top-1 right-1">
                    <Square className="h-3 w-3 fill-primary text-primary" />
                  </div>
                )}

                {cell.isCurrentMonth && cell.row.day ? (
                  <div className="space-y-0.5">
                    <StatusBadge tone={toneFor(ATTENDANCE_STATUS_TONES, cell.row.day.status)} className="text-[10px] px-1 py-0">
                      {cell.row.day.status.replace(/_/g, ' ')}
                    </StatusBadge>
                    {cell.row.day.worked_minutes > 0 && (
                      <div className="text-muted-foreground tabular-nums leading-tight">
                        {formatMinutes(cell.row.day.worked_minutes)}
                      </div>
                    )}
                  </div>
                ) : cell.isCurrentMonth && cell.isPast ? (
                  <span className="text-muted-foreground/50">{selectMode ? 'tap to select' : '—'}</span>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      {/* Bulk action bar — shown when days are selected */}
      {selectMode && (
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">
              {selectedCount === 0
                ? 'No days selected — click blank days above'
                : `${selectedCount} blank day${selectedCount !== 1 ? 's' : ''} selected`}
            </div>
            {selectedCount > 0 && (
              <button onClick={clearSelection} className="text-xs text-muted-foreground hover:text-foreground">
                Clear selection
              </button>
            )}
          </div>

          {bulkError && <ErrorBanner message={bulkError} />}

          {selectedCount > 0 && (
            <>
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[160px]">
                  <label className="text-xs text-muted-foreground block mb-1">Status to apply</label>
                  <select
                    value={bulkStatus}
                    onChange={e => setBulkStatus(e.target.value)}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">-- choose --</option>
                    {ATTENDANCE_STATUSES.map(s => (
                      <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-[200px]">
                  <label className="text-xs text-muted-foreground block mb-1">Reason <span className="text-destructive">*</span></label>
                  <Input
                    value={bulkReason}
                    onChange={e => setBulkReason(e.target.value)}
                    placeholder="e.g. On approved leave"
                    className="h-8"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={saveAll.pending || !bulkStatus || !bulkReason.trim()}
                  onClick={() => saveAll.run()}
                >
                  {saveAll.pending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  Save {selectedCount} day{selectedCount !== 1 ? 's' : ''}
                </Button>
                <Button variant="ghost" size="sm" onClick={exitSelectMode}>Cancel</Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { ATTENDANCE_STATUS_TONES, toneFor } from '@/lib/status-styles'
import { StatusBadge } from '@/components/StatusBadge'
import { formatMinutes, istToday } from '@/lib/attendance'
import { Input } from '@/components/ui/input'
import { Loader2 } from 'lucide-react'
import type { RegisterRow } from '@/components/attendance/DayRegister'
import { cn } from '@/lib/utils'

interface StaffOption {
  id: string
  full_name: string
  employee_code: string | null
}

interface CalendarDay {
  date: string          // YYYY-MM-DD
  dayOfMonth: number
  isCurrentMonth: boolean
  isPast: boolean
  row: RegisterRow      // always present; day may be null
}

// Returns the first and last day of a YYYY-MM month string.
function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number)
  const first = `${month}-01`
  const last = new Date(y, m, 0)   // day 0 of next month = last day of this month
  const lastStr = `${month}-${String(last.getDate()).padStart(2, '0')}`
  return { first, last: lastStr, daysInMonth: last.getDate() }
}

// Day-of-week for the first of the month (0=Mon … 6=Sun, per ISO week).
function firstDOW(month: string) {
  const d = new Date(`${month}-01`)
  return (d.getDay() + 6) % 7   // JS getDay: 0=Sun; we want 0=Mon
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
  const [days, setDays] = useState<Record<string, any>>({})   // work_date → attendance_days row
  const [loading, setLoading] = useState(false)
  const today = istToday()

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

  // Expose reload so the parent can refresh after a correction.
  // (We surface it via the onCorrect callback chain instead of a ref.)

  const cells = useMemo<CalendarDay[]>(() => {
    const { daysInMonth } = monthBounds(month)
    const offset = firstDOW(month)
    const out: CalendarDay[] = []

    // Leading blank cells from the previous month.
    for (let i = 0; i < offset; i++) {
      // placeholder — isCurrentMonth=false keeps them visually empty
      const [y, mo] = month.split('-').map(Number)
      const prev = new Date(y, mo - 1, -offset + i + 1)
      const d = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`
      out.push({
        date: d, dayOfMonth: prev.getDate(), isCurrentMonth: false,
        isPast: d < today,
        row: { staff: { id: selectedId, full_name: '', employee_code: null }, shift: staffMeta[selectedId]?.shift ?? null, weekly_off_days: staffMeta[selectedId]?.weekly_off_days ?? [], day: null },
      })
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${month}-${String(d).padStart(2, '0')}`
      const staffInfo = staff.find(s => s.id === selectedId)
      out.push({
        date: dateStr,
        dayOfMonth: d,
        isCurrentMonth: true,
        isPast: dateStr <= today,
        row: {
          staff: { id: selectedId, full_name: staffInfo?.full_name ?? '', employee_code: staffInfo?.employee_code ?? null },
          shift: staffMeta[selectedId]?.shift ?? null,
          weekly_off_days: staffMeta[selectedId]?.weekly_off_days ?? [],
          day: days[dateStr] ?? null,
        },
      })
    }

    return out
  }, [month, days, selectedId, staff, staffMeta, today])

  const selectedStaff = staff.find(s => s.id === selectedId)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Staff member</label>
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
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
            onChange={e => setMonth(e.target.value)}
          />
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mb-1" />}
      </div>

      {selectedStaff && (
        <p className="text-sm text-muted-foreground">
          {selectedStaff.full_name} — {month}
          {selectedStaff.employee_code && ` · ${selectedStaff.employee_code}`}
          {canEdit && <span className="ml-2">Click any day to edit.</span>}
        </p>
      )}

      {/* Calendar grid */}
      <div className="rounded-md border border-border overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-7 bg-muted/50 border-b border-border">
          {DOW_LABELS.map(d => (
            <div key={d} className="p-2 text-xs font-medium text-center text-muted-foreground">{d}</div>
          ))}
        </div>

        {/* Day cells — 7 per row */}
        <div className="grid grid-cols-7 divide-x divide-y divide-border">
          {cells.map((cell, i) => {
            const isToday = cell.date === today
            const clickable = canEdit && cell.isCurrentMonth
            return (
              <div
                key={i}
                onClick={() => { if (clickable) onCorrect(cell.row, cell.date) }}
                className={cn(
                  'min-h-[72px] p-1.5 text-xs transition-colors',
                  cell.isCurrentMonth ? 'bg-background' : 'bg-muted/20',
                  isToday && 'bg-primary/5',
                  clickable && 'cursor-pointer hover:bg-accent',
                )}
              >
                <div className={cn(
                  'font-medium mb-1 w-5 h-5 flex items-center justify-center rounded-full text-[11px]',
                  isToday && 'bg-primary text-primary-foreground',
                  !cell.isCurrentMonth && 'text-muted-foreground/40',
                )}>
                  {cell.dayOfMonth}
                </div>

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
                  <span className="text-muted-foreground/50">—</span>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

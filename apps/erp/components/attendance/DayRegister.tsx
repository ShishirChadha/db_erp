'use client'

import { StatusBadge } from '@/components/StatusBadge'
import { EmptyTableRow } from '@/components/EmptyTableRow'
import { ATTENDANCE_STATUS_TONES, toneFor } from '@/lib/status-styles'
import { formatMinutes } from '@/lib/attendance'
import { Button } from '@/components/ui/button'
import { Pencil } from 'lucide-react'

export interface RegisterRow {
  staff: { id: string; full_name: string; employee_code: string | null }
  shift: { id: string; name: string; start_time: string; end_time: string } | null
  weekly_off_days: number[]
  day: {
    id: string
    work_date: string
    status: string
    status_source: string
    first_in_at: string | null
    last_out_at: string | null
    worked_minutes: number
    late_minutes: number
    is_late: boolean
    overtime_minutes: number
    note: string | null
    override_reason: string | null
  } | null
}

function istTime(iso: string | null) {
  if (!iso) return '--'
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

// "Not marked" is a real, common state, not a bug: the nightly scan only
// materializes rows after IST midnight, so everyone who has not punched yet
// today has no attendance_days row at all. The register left-joins the roster
// precisely so those people stay visible.
function StatusCell({ row }: { row: RegisterRow }) {
  if (!row.day) {
    return <span className="text-xs text-muted-foreground">Not marked</span>
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <StatusBadge tone={toneFor(ATTENDANCE_STATUS_TONES, row.day.status)}>
        {row.day.status.replace(/_/g, ' ')}
      </StatusBadge>
      {row.day.status_source !== 'derived' && (
        <span
          className="text-[10px] uppercase tracking-wide text-muted-foreground"
          title={row.day.override_reason || `Set by ${row.day.status_source}`}
        >
          {row.day.status_source}
        </span>
      )}
      {row.day.is_late && row.day.late_minutes > 0 && (
        <span className="text-xs text-warning tabular-nums">{formatMinutes(row.day.late_minutes)} late</span>
      )}
    </div>
  )
}

// One row per active staff member for a single date -- the paper hazri register
// this replaces. Deliberately a grid rather than a master-detail list: the
// roster is small and the task is inherently "mark the whole team for one
// date", which master-detail would turn into one click per person.
export function DayRegister({
  rows, canEdit, onCorrect, loading,
}: {
  rows: RegisterRow[]
  canEdit: boolean
  onCorrect: (row: RegisterRow) => void
  loading?: boolean
}) {
  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-2 font-medium">Staff</th>
              <th className="p-2 font-medium">Status</th>
              <th className="p-2 font-medium">In</th>
              <th className="p-2 font-medium">Out</th>
              <th className="p-2 font-medium text-right">Worked</th>
              <th className="p-2 font-medium text-right">Overtime</th>
              <th className="p-2 font-medium">Shift</th>
              {canEdit && <th className="p-2 font-medium w-10" />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <EmptyTableRow colSpan={canEdit ? 8 : 7} message="No active staff on the roster." />
            )}
            {rows.map(row => (
              <tr key={row.staff.id} className="border-t border-border">
                <td className="p-2">
                  <div className="font-medium">{row.staff.full_name}</div>
                  {row.staff.employee_code && (
                    <div className="text-xs text-muted-foreground">{row.staff.employee_code}</div>
                  )}
                </td>
                <td className="p-2"><StatusCell row={row} /></td>
                <td className="p-2 tabular-nums">{istTime(row.day?.first_in_at ?? null)}</td>
                <td className="p-2 tabular-nums">{istTime(row.day?.last_out_at ?? null)}</td>
                <td className="p-2 text-right tabular-nums">{formatMinutes(row.day?.worked_minutes ?? 0)}</td>
                <td className="p-2 text-right tabular-nums">
                  {row.day?.overtime_minutes ? formatMinutes(row.day.overtime_minutes) : '--'}
                </td>
                <td className="p-2 text-xs text-muted-foreground">
                  {row.shift ? `${row.shift.start_time.slice(0, 5)}-${row.shift.end_time.slice(0, 5)}` : '--'}
                </td>
                {canEdit && (
                  <td className="p-2">
                    <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => onCorrect(row)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards -- this register is realistically checked from a phone on
          the shop floor, so it gets a real card layout sharing the same row
          shape rather than a horizontally-scrolling table. */}
      <div className="md:hidden space-y-2">
        {rows.length === 0 && !loading && (
          <p className="text-center text-sm text-muted-foreground py-4">No active staff on the roster.</p>
        )}
        {rows.map(row => (
          <div key={row.staff.id} className="rounded-md border border-border p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium truncate">{row.staff.full_name}</div>
                {row.staff.employee_code && (
                  <div className="text-xs text-muted-foreground">{row.staff.employee_code}</div>
                )}
              </div>
              {canEdit && (
                <Button variant="ghost" size="sm" className="h-8 px-2 shrink-0" onClick={() => onCorrect(row)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <StatusCell row={row} />
            <div className="text-xs text-muted-foreground tabular-nums">
              In {istTime(row.day?.first_in_at ?? null)} · Out {istTime(row.day?.last_out_at ?? null)}
              {' · '}{formatMinutes(row.day?.worked_minutes ?? 0)}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

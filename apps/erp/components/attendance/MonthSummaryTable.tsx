'use client'

import { EmptyTableRow } from '@/components/EmptyTableRow'
import { formatMinutes } from '@/lib/attendance'

export interface SummaryRow {
  staff_id: string
  full_name: string
  employee_code: string | null
  present_days: number | string
  half_days: number
  absent_days: number
  leave_days: number
  holiday_days: number
  week_off_days: number
  on_duty_days: number
  late_days: number
  worked_minutes: number
  overtime_minutes: number
}

// Per-staff totals for a month. "Payable-equivalent days" counts a half day as
// 0.5 and on-duty as a full day -- computed in attendance_month_summary(), not
// here, so the number is the same wherever it is read.
//
// This build has NO payroll output by decision; this table is for the owner to
// read, not to feed a salary calculation.
export function MonthSummaryTable({ rows, loading }: { rows: SummaryRow[]; loading?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr className="text-left">
            <th className="p-2 font-medium">Staff</th>
            <th className="p-2 font-medium text-right">Days</th>
            <th className="p-2 font-medium text-right">Half</th>
            <th className="p-2 font-medium text-right">Absent</th>
            <th className="p-2 font-medium text-right">Leave</th>
            <th className="p-2 font-medium text-right">Week off</th>
            <th className="p-2 font-medium text-right">Holiday</th>
            <th className="p-2 font-medium text-right">Late</th>
            <th className="p-2 font-medium text-right">Worked</th>
            <th className="p-2 font-medium text-right">Overtime</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && !loading && <EmptyTableRow colSpan={10} message="Nothing recorded in this period." />}
          {rows.map(r => (
            <tr key={r.staff_id} className="border-t border-border">
              <td className="p-2">
                <div className="font-medium">{r.full_name}</div>
                {r.employee_code && <div className="text-xs text-muted-foreground">{r.employee_code}</div>}
              </td>
              <td className="p-2 text-right tabular-nums font-medium">{Number(r.present_days)}</td>
              <td className="p-2 text-right tabular-nums">{r.half_days}</td>
              <td className="p-2 text-right tabular-nums">{r.absent_days || '--'}</td>
              <td className="p-2 text-right tabular-nums">{r.leave_days || '--'}</td>
              <td className="p-2 text-right tabular-nums">{r.week_off_days || '--'}</td>
              <td className="p-2 text-right tabular-nums">{r.holiday_days || '--'}</td>
              <td className="p-2 text-right tabular-nums">{r.late_days || '--'}</td>
              <td className="p-2 text-right tabular-nums">{formatMinutes(r.worked_minutes)}</td>
              <td className="p-2 text-right tabular-nums">{r.overtime_minutes ? formatMinutes(r.overtime_minutes) : '--'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

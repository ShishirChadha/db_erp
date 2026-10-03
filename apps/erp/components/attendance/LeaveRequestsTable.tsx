'use client'

import { StatusBadge } from '@/components/StatusBadge'
import { EmptyTableRow } from '@/components/EmptyTableRow'
import { LEAVE_STATUS_TONES, toneFor } from '@/lib/status-styles'
import { LEAVE_TYPE_LABELS, type LeaveType } from '@/lib/attendance'
import { Button } from '@/components/ui/button'

export interface LeaveRow {
  id: string
  staff_id: string
  leave_type: LeaveType
  from_date: string
  to_date: string
  day_part: string
  reason: string | null
  status: string
  decision_note: string | null
  decided_at: string | null
  staff: { id: string; full_name: string; employee_code: string | null } | null
}

function range(r: LeaveRow) {
  return r.from_date === r.to_date ? r.from_date : `${r.from_date} to ${r.to_date}`
}

// Date column first and default-sorted newest-first, per the house list rule --
// the ordering itself is applied server-side in app/api/leave-requests/route.ts
// so it matches the displayed column rather than an unrelated timestamp.
export function LeaveRequestsTable({
  rows, canDecide, onDecide, loading,
}: {
  rows: LeaveRow[]
  canDecide: boolean
  onDecide: (row: LeaveRow) => void
  loading?: boolean
}) {
  return (
    <>
      <div className="hidden md:block overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-2 font-medium">Dates</th>
              <th className="p-2 font-medium">Staff</th>
              <th className="p-2 font-medium">Type</th>
              <th className="p-2 font-medium">Status</th>
              <th className="p-2 font-medium">Reason</th>
              {canDecide && <th className="p-2 font-medium w-24" />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <EmptyTableRow colSpan={canDecide ? 6 : 5} message="No leave requests." />
            )}
            {rows.map(r => (
              <tr key={r.id} className="border-t border-border">
                <td className="p-2 tabular-nums whitespace-nowrap">{range(r)}</td>
                <td className="p-2">{r.staff?.full_name ?? '--'}</td>
                <td className="p-2">
                  {LEAVE_TYPE_LABELS[r.leave_type] ?? r.leave_type}
                  {r.day_part !== 'full' && (
                    <span className="text-xs text-muted-foreground"> ({r.day_part.replace('_', ' ')})</span>
                  )}
                </td>
                <td className="p-2">
                  <StatusBadge tone={toneFor(LEAVE_STATUS_TONES, r.status)}>{r.status}</StatusBadge>
                </td>
                <td className="p-2 text-xs text-muted-foreground max-w-[18rem] truncate" title={r.reason || ''}>
                  {r.reason || '--'}
                  {r.decision_note && <div className="italic">note: {r.decision_note}</div>}
                </td>
                {canDecide && (
                  <td className="p-2">
                    {r.status === 'pending' && (
                      <Button size="sm" className="h-8" onClick={() => onDecide(r)}>Decide</Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-2">
        {rows.length === 0 && !loading && (
          <p className="text-center text-sm text-muted-foreground py-4">No leave requests.</p>
        )}
        {rows.map(r => (
          <div key={r.id} className="rounded-md border border-border p-3 space-y-1.5">
            <div className="text-xs text-muted-foreground tabular-nums">{range(r)}</div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium truncate">{r.staff?.full_name ?? '--'}</span>
              <StatusBadge tone={toneFor(LEAVE_STATUS_TONES, r.status)}>{r.status}</StatusBadge>
            </div>
            <div className="text-xs text-muted-foreground">
              {LEAVE_TYPE_LABELS[r.leave_type] ?? r.leave_type}
              {r.reason && ` · ${r.reason}`}
            </div>
            {canDecide && r.status === 'pending' && (
              <Button size="sm" className="h-8 w-full" onClick={() => onDecide(r)}>Decide</Button>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

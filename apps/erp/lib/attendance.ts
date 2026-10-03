// Attendance & Leave shared constants, types and formatters.
//
// Deliberately free of any server-only import (no supabase client, no
// lib/auth/session) so client components -- PunchWidget, the register, the
// dialogs -- can import formatMinutes/istToday/the status lists without
// dragging @db/db/server (and next/headers) into the browser bundle. The
// database-touching helpers live in lib/attendance-server.ts.
//
// The whole module hangs off one idea: `staff` is the roster, and a `profiles`
// row (a login) is linked to at most one staff row via staff.profile_id. Most
// staff have no login at all and are only ever marked by a supervisor -- see
// docs/bible/modules/attendance.md.

export const ATTENDANCE_STATUSES = [
  'present', 'half_day', 'absent', 'leave', 'holiday', 'week_off', 'on_duty',
] as const
export type AttendanceStatus = typeof ATTENDANCE_STATUSES[number]

export const STATUS_SOURCES = ['derived', 'manual', 'leave', 'holiday', 'week_off'] as const

export const LEAVE_TYPES = ['casual', 'sick', 'unpaid', 'comp_off', 'other'] as const
export type LeaveType = typeof LEAVE_TYPES[number]

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  casual: 'Casual leave',
  sick: 'Sick leave',
  unpaid: 'Unpaid leave',
  comp_off: 'Comp off',
  other: 'Other',
}

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const

export const DAY_PARTS = ['full', 'first_half', 'second_half'] as const

export interface StaffShift {
  id: string
  name: string
  start_time: string
  end_time: string
  crosses_midnight: boolean
  grace_minutes: number
  half_day_min_minutes: number
  full_day_min_minutes: number
  weekly_off_days: number[]
  is_active: boolean
}

export interface StaffRow {
  id: string
  full_name: string
  employee_code: string | null
  profile_id: string | null
  join_date: string | null
  default_shift_id: string | null
  weekly_off_days: number[] | null
  phone: string | null
  is_active: boolean
  staff_shifts?: StaffShift | null
}

// Today's date in IST, as YYYY-MM-DD. The database stamps work_date from
// Asia/Kolkata (see set_attendance_punch_work_date), so anything the UI or a
// route computes as "today" has to agree with that, not with the server's or
// the browser's timezone -- a Vercel function runs in UTC, where after 18:30
// IST `new Date().toISOString()` is already the wrong day.
export function istToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

// The IST calendar date of an arbitrary instant, same contract as istToday().
export function istDate(at: Date | string): string {
  const d = typeof at === 'string' ? new Date(at) : at
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

// "7h 20m" / "45m" / "--". Used for the worked/late/overtime columns, all of
// which are stored as plain integer minutes.
export function formatMinutes(mins: number | null | undefined): string {
  if (mins === null || mins === undefined) return '--'
  if (mins <= 0) return '0m'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

// Resolve the weekly offs that actually apply to a person: their own override
// first, then the shift's, then Sunday. Mirrors the
// coalesce(s.weekly_off_days, sh.weekly_off_days, '{7}') used in
// scan_attendance_days() and decide_leave_request() -- keep the two in step.
export function resolveWeeklyOffs(staff: Pick<StaffRow, 'weekly_off_days'> & {
  staff_shifts?: Pick<StaffShift, 'weekly_off_days'> | null
}): number[] {
  if (staff.weekly_off_days) return staff.weekly_off_days
  if (staff.staff_shifts?.weekly_off_days) return staff.staff_shifts.weekly_off_days
  return [7]
}

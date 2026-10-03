import { supabaseAdmin } from '@/lib/supabase/service'
import { SessionUser, isManagerOrAbove } from '@/lib/auth/session'
import type { StaffRow } from '@/lib/attendance'

// Server-only half of the attendance module: everything that touches the
// database or a SessionUser. Split from lib/attendance.ts so client components
// can import the constants and formatters there without pulling
// @db/db/server (and next/headers) into the browser bundle.
//
// Re-exports lib/attendance.ts so a route only needs one import.
export * from '@/lib/attendance'

const STAFF_SELECT = `
  id, full_name, employee_code, profile_id, join_date, default_shift_id,
  weekly_off_days, phone, is_active,
  staff_shifts ( id, name, start_time, end_time, crosses_midnight, grace_minutes,
                 half_day_min_minutes, full_day_min_minutes, weekly_off_days, is_active )
`

// The only link between a login and the roster. Returns null for a user with no
// staff row (an admin-only login, or a staff member not yet added to the
// roster) -- every self-service endpoint returns a `staff: null` shape rather
// than inventing a row, and the punch widget renders nothing at all, so the
// module stays invisible to accounts it does not apply to.
export async function getMyStaffRow(userId: string): Promise<StaffRow | null> {
  const { data } = await supabaseAdmin
    .from('staff')
    .select(STAFF_SELECT)
    .eq('profile_id', userId)
    .eq('is_deleted', false)
    .eq('is_active', true)
    .maybeSingle()
  return (data as StaffRow | null) ?? null
}

// The own-only clamp used by every attendance list/summary route.
//
// 'all' means no staff filter at all (owner/manager). Otherwise the caller is
// forced onto their own staff id regardless of what they asked for, and gets an
// EMPTY list -- not a 403 -- when they have no roster row. Two deliberate
// choices there: a requested staff_id naming someone else is ignored rather
// than rejected, and the response shape and status code are identical whether
// or not the other person exists, so neither can be used as an existence
// oracle. See the own-only assertions in scripts/verify-attendance.mjs.
export async function resolveVisibleStaffIds(
  sessionUser: SessionUser,
  requestedStaffId?: string | null,
): Promise<{ staffIds: string[] | 'all'; ownStaffId: string | null }> {
  if (isManagerOrAbove(sessionUser)) {
    return { staffIds: requestedStaffId ? [requestedStaffId] : 'all', ownStaffId: null }
  }
  const own = await getMyStaffRow(sessionUser.id)
  return { staffIds: own ? [own.id] : [], ownStaffId: own?.id ?? null }
}

// Owners, plus managers who hold the attendance page key.
//
// Deliberately NOT areValidUsers() from lib/activities.ts: that gate requires
// 'activities' in allowed_pages, so a manager who approves leave but was never
// granted the Activity Hub would be rejected -- the same reason
// scan_recurring_expenses() and scan_rental_cycles() insert activity_assignees
// rows directly instead of going through it.
export async function getLeaveApprovers(): Promise<string[]> {
  const { data: owners } = await supabaseAdmin
    .from('profiles').select('id').eq('role', 'owner').eq('is_active', true)

  const { data: managers } = await supabaseAdmin
    .from('profiles')
    .select('id, profile_page_actions(page_key, can_edit)')
    .eq('role', 'manager').eq('is_active', true)

  const managerIds = (managers || [])
    .filter((m: any) => (m.profile_page_actions || [])
      .some((a: any) => a.page_key === 'attendance' && a.can_edit))
    .map((m: any) => m.id as string)

  return Array.from(new Set([...(owners || []).map(o => o.id as string), ...managerIds]))
}

// The open (unmatched, non-voided) punch-in for a staff member, if any. This is
// what makes punching a toggle rather than two buttons, and what rejects a
// second punch-out. Backed by attendance_punches_open_in_idx.
export async function getOpenPunch(
  staffId: string,
): Promise<{ id: string; punched_at: string; work_date: string } | null> {
  const { data: lastIn } = await supabaseAdmin
    .from('attendance_punches')
    .select('id, punched_at, work_date')
    .eq('staff_id', staffId)
    .eq('punch_type', 'in')
    .is('voided_at', null)
    .order('punched_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!lastIn) return null

  // Open only if no non-voided punch-out came after it.
  const { count } = await supabaseAdmin
    .from('attendance_punches')
    .select('id', { count: 'exact', head: true })
    .eq('staff_id', staffId)
    .eq('punch_type', 'out')
    .is('voided_at', null)
    .gt('punched_at', lastIn.punched_at)

  return (count || 0) > 0 ? null : lastIn
}

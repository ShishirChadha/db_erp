import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser } from '@/lib/auth/session'
import { getMyStaffRow, getOpenPunch, istToday } from '@/lib/attendance-server'

// The punch widget's only data source.
//
// No page key: punching your own card is self-service, like Settings >
// Appearance. Requiring 'attendance' in allowed_pages first would be a setup
// trap -- the owner adds a staff member, they log in, and punching silently
// 403s until someone remembers a checkbox. The authorization that matters is
// structural: getMyStaffRow() resolves at most one roster row, your own.
// Seeing the register, anyone else's data, or the monthly summary does need the
// key -- see app/api/attendance/route.ts.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const staff = await getMyStaffRow(sessionUser.id)
  // Not an error: an owner-only login, or a staff member not yet on the roster.
  // The widget renders nothing on this, so the module stays invisible to
  // accounts it does not apply to.
  if (!staff) return NextResponse.json({ staff: null })

  const today = istToday()

  const [openPunch, { data: todayRow }, { data: recent }] = await Promise.all([
    getOpenPunch(staff.id),
    supabaseAdmin
      .from('attendance_days')
      .select('id, work_date, status, status_source, first_in_at, last_out_at, worked_minutes, late_minutes, is_late, overtime_minutes, day_part, note')
      .eq('staff_id', staff.id)
      .eq('work_date', today)
      .maybeSingle(),
    supabaseAdmin
      .from('attendance_days')
      .select('id, work_date, status, status_source, first_in_at, last_out_at, worked_minutes, late_minutes, is_late')
      .eq('staff_id', staff.id)
      .order('work_date', { ascending: false })
      .limit(14),
  ])

  return NextResponse.json({
    staff: {
      id: staff.id,
      full_name: staff.full_name,
      employee_code: staff.employee_code,
      shift: staff.staff_shifts ?? null,
    },
    today: todayRow ?? null,
    open_punch: openPunch,
    recent: recent || [],
  })
}

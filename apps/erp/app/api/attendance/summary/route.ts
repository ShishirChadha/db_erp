import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { resolveVisibleStaffIds, istToday } from '@/lib/attendance-server'

// Monthly (or arbitrary-range) per-staff totals, via the
// attendance_month_summary RPC -- one round trip rather than a status count per
// person per bucket, the same posture as stock_status_counts.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'attendance')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)

  // ?month=YYYY-MM is the normal call; ?from=&to= covers anything else.
  let from = searchParams.get('from')
  let to = searchParams.get('to')
  const month = searchParams.get('month')
  if (month) {
    const [y, m] = month.split('-').map(Number)
    if (!y || !m || m < 1 || m > 12) {
      return NextResponse.json({ error: 'month must be YYYY-MM.' }, { status: 400 })
    }
    from = `${month}-01`
    // Day 0 of the next month is the last day of this one, so this is correct
    // for February and leap years without a special case.
    to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  }
  if (!from || !to) {
    const today = istToday()
    from = today.slice(0, 8) + '01'
    to = today
  }

  const { staffIds } = await resolveVisibleStaffIds(sessionUser, searchParams.get('staff_id'))
  if (staffIds !== 'all' && staffIds.length === 0) {
    return NextResponse.json({ from, to, rows: [] })
  }

  // The RPC takes a single optional staff filter, which is exactly what the
  // own-only clamp resolves to for a non-manager.
  const { data, error } = await supabaseAdmin.rpc('attendance_month_summary', {
    p_from: from,
    p_to: to,
    p_staff_id: staffIds === 'all' ? null : staffIds[0],
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ from, to, rows: data || [] })
}

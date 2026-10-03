import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { withRetry } from '@/lib/db-retry'
import { resolveVisibleStaffIds } from '@/lib/attendance-server'

// The raw punch log for one staff member / one day -- what the correction dialog
// shows. Voided rows are included deliberately: the point of an append-only log
// is that a correction never erases what was originally recorded, so the UI has
// to be able to show it struck through.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'attendance')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const { staffIds } = await resolveVisibleStaffIds(sessionUser, searchParams.get('staff_id'))
  if (staffIds !== 'all' && staffIds.length === 0) return NextResponse.json([])

  let query = supabaseAdmin
    .from('attendance_punches')
    .select(`
      id, staff_id, punch_type, punched_at, work_date, source, note, reason,
      client_ip, ip_check, voided_at, voided_by, void_reason, created_at,
      recorded_by, staff ( full_name )
    `)
    .order('punched_at', { ascending: true })

  if (staffIds !== 'all') query = query.in('staff_id', staffIds)

  const workDate = searchParams.get('work_date')
  if (workDate) query = query.eq('work_date', workDate)

  const { data, error } = await withRetry(() => query)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

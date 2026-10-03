import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, canEditPage, isManagerOrAbove } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// Voids a punch. The row is NOT deleted -- voided_at/voided_by/void_reason are
// set and recompute_attendance_day() (via trg_attendance_punches_sync_day)
// stops counting it, while the original tap stays on the record forever. That
// is the whole reason attendance_punches is append-only.
//
// Audited as 'void', which SEVERITY_BY_ACTION puts in the MAJOR bucket -- a
// corrected attendance record deserves that visibility.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManagerOrAbove(sessionUser) || !canEditPage(sessionUser, 'attendance')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason) {
    return NextResponse.json({ error: 'A reason is required to void a punch.' }, { status: 400 })
  }

  const { data: punch } = await supabaseAdmin
    .from('attendance_punches')
    .select('id, staff_id, punch_type, punched_at, work_date, voided_at, staff ( full_name )')
    .eq('id', id)
    .maybeSingle()
  if (!punch) return NextResponse.json({ error: 'Punch not found.' }, { status: 404 })
  if (punch.voided_at) {
    return NextResponse.json({ error: 'That punch is already voided.' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('attendance_punches')
    .update({ voided_at: new Date().toISOString(), voided_by: sessionUser.id, void_reason: reason })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: day } = await supabaseAdmin
    .from('attendance_days')
    .select('*')
    .eq('staff_id', punch.staff_id)
    .eq('work_date', punch.work_date)
    .maybeSingle()

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'void',
    module: 'attendance',
    tableName: 'attendance_punches',
    recordId: id,
    recordLabel: `${(punch as any).staff?.full_name ?? 'staff'} punch ${punch.punch_type} ${punch.work_date} voided`,
    reason,
    metadata: { punched_at: punch.punched_at, staff_id: punch.staff_id },
  })

  return NextResponse.json({ success: true, day: day ?? null })
}

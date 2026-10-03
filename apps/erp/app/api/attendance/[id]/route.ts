import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, canEditPage, isManagerOrAbove } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { ATTENDANCE_STATUSES, DAY_PARTS } from '@/lib/attendance-server'

// Supervisor override of a day's status, or a revert back to derived.
//
// Sending status: null reverts the day to status_source='derived' and recomputes
// it from the punch log -- that is the escape hatch from a wrong correction,
// and the reason recompute_attendance_day() exists as its own function.
//
// A manual status is sticky by design: recompute_attendance_day() only rewrites
// `status` while status_source is 'derived', so a later punch (or the nightly
// scan, or an approved leave) can never silently undo this. The derived MINUTE
// columns keep updating regardless, so the real punch data stays visible.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManagerOrAbove(sessionUser) || !canEditPage(sessionUser, 'attendance')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const { data: day } = await supabaseAdmin
    .from('attendance_days')
    .select('id, staff_id, work_date, status, status_source, staff ( full_name )')
    .eq('id', id)
    .maybeSingle()
  if (!day) return NextResponse.json({ error: 'Attendance record not found.' }, { status: 404 })

  const staffName = (day as any).staff?.full_name ?? 'staff'

  // ---------- revert to derived ----------
  if (body.status === null) {
    const { error: clearErr } = await supabaseAdmin
      .from('attendance_days')
      .update({
        status_source: 'derived',
        override_reason: null,
        overridden_by: sessionUser.id,
        overridden_at: new Date().toISOString(),
        day_part: 'full',
      })
      .eq('id', id)
    if (clearErr) return NextResponse.json({ error: clearErr.message }, { status: 500 })

    const { error: rpcErr } = await supabaseAdmin.rpc('recompute_attendance_day', {
      p_staff_id: day.staff_id,
      p_date: day.work_date,
    })
    if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 })

    await logAuditEvent({
      actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
      actionType: 'status_change',
      module: 'attendance',
      tableName: 'attendance_days',
      recordId: id,
      recordLabel: `${staffName} ${day.work_date} reverted to derived`,
      reason: typeof body.reason === 'string' ? body.reason : null,
      metadata: { from: day.status, from_source: day.status_source, to_source: 'derived' },
    })

    const { data: fresh } = await supabaseAdmin
      .from('attendance_days').select('*').eq('id', id).single()
    return NextResponse.json({ success: true, day: fresh })
  }

  // ---------- manual override ----------
  const status = body.status
  if (!ATTENDANCE_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${ATTENDANCE_STATUSES.join(', ')}, or null to revert.` },
      { status: 400 },
    )
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  // Mirrors attendance_days_manual_reason_check -- enforced here too so the
  // user gets a readable message instead of a raw constraint violation.
  if (!reason) {
    return NextResponse.json(
      { error: 'A reason is required when overriding attendance.' },
      { status: 400 },
    )
  }
  const dayPart = body.day_part ?? 'full'
  if (!DAY_PARTS.includes(dayPart)) {
    return NextResponse.json({ error: `day_part must be one of: ${DAY_PARTS.join(', ')}.` }, { status: 400 })
  }

  const { data: updated, error } = await supabaseAdmin
    .from('attendance_days')
    .update({
      status,
      status_source: 'manual',
      day_part: dayPart,
      note: body.note ?? null,
      override_reason: reason,
      overridden_by: sessionUser.id,
      overridden_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'status_change',
    module: 'attendance',
    tableName: 'attendance_days',
    recordId: id,
    recordLabel: `${staffName} ${day.work_date} -> ${status}`,
    reason,
    metadata: { from: day.status, from_source: day.status_source, to: status, to_source: 'manual' },
  })

  return NextResponse.json({ success: true, day: updated })
}

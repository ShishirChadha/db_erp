import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, canEditPage, isManagerOrAbove } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { getMyStaffRow, getOpenPunch } from '@/lib/attendance-server'
import { checkPunchNetwork, offNetworkMessage, getTrustedClientIp } from '@/lib/attendance-network'
import { getClientIp } from '@/lib/auth/device-sessions'

// Records a punch. Two distinct branches:
//
//   SELF       -- no staff_id and no punched_at in the body. Session-only (see
//                 me/route.ts for why there is no page key), gated on the
//                 office-IP allowlist, always "now", always your own row.
//   SUPERVISOR -- staff_id and/or punched_at present. Needs the attendance edit
//                 grant AND manager-or-above, requires a written reason, and is
//                 deliberately EXEMPT from the IP check so the owner can fix a
//                 record from home. Fully audited either way.
//
// A punch is never edited or deleted afterwards: a correction is a new row plus
// a void on the one it replaces (see punches/[id]/void), so the original tap
// survives forever.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const type = body.type
  if (type !== 'in' && type !== 'out') {
    return NextResponse.json({ error: 'type must be "in" or "out".' }, { status: 400 })
  }

  const isSupervisorAction = !!body.staff_id || !!body.punched_at
  let staffId: string
  let source: 'self' | 'supervisor'
  let ipCheck: 'allowed' | 'exempt_supervisor' | 'not_enforced'
  let clientIp: string | null

  if (isSupervisorAction) {
    if (!isManagerOrAbove(sessionUser) || !canEditPage(sessionUser, 'attendance')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason) {
      return NextResponse.json(
        { error: 'A reason is required when recording a punch for someone else.' },
        { status: 400 },
      )
    }
    staffId = body.staff_id
    if (!staffId) {
      return NextResponse.json({ error: 'staff_id is required.' }, { status: 400 })
    }
    source = 'supervisor'
    ipCheck = 'exempt_supervisor'
    clientIp = getTrustedClientIp(req)
  } else {
    const staff = await getMyStaffRow(sessionUser.id)
    if (!staff) {
      return NextResponse.json(
        { error: 'You are not on the staff roster, so there is nothing to punch.' },
        { status: 404 },
      )
    }
    staffId = staff.id

    const verdict = await checkPunchNetwork(req)
    if (!verdict.ok) {
      // No punch row is written -- but the attempt must still be visible, since
      // a pattern of them is exactly what the owner would want to notice.
      await logAuditEvent({
        actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
        actionType: 'blocked',
        module: 'attendance',
        tableName: 'attendance_punches',
        recordLabel: `${staff.full_name} punch ${type} blocked (off-network)`,
        reason: verdict.reason,
        metadata: {
          // The IP the decision was actually made on. NULL when the reason is
          // 'no_ip' -- i.e. there was no proxy-set header to trust at all.
          client_ip: verdict.ip,
          // Best-effort, CLIENT-SETTABLE and therefore not trusted for the
          // decision -- recorded anyway so a blocked attempt is still
          // traceable when client_ip is null, which is the whole point of
          // auditing something that wrote no row. Never treat this as proof of
          // origin; see lib/attendance-network.ts.
          observed_ip_untrusted: getClientIp(req),
          punch_type: type,
          staff_id: staff.id,
        },
      })
      return NextResponse.json(
        { error: offNetworkMessage(verdict.reason), code: 'off_network' },
        { status: 403 },
      )
    }
    source = 'self'
    ipCheck = verdict.check
    clientIp = verdict.ip
  }

  const { data: staffRow } = await supabaseAdmin
    .from('staff')
    .select('id, full_name, is_active, is_deleted')
    .eq('id', staffId)
    .maybeSingle()
  if (!staffRow || staffRow.is_deleted) {
    return NextResponse.json({ error: 'Staff member not found.' }, { status: 404 })
  }
  if (!staffRow.is_active) {
    return NextResponse.json({ error: 'That staff member is inactive.' }, { status: 400 })
  }

  // Punching is a toggle, so the open-punch state decides what is legal next.
  // Checked for a backdated supervisor punch too -- otherwise a stray 'out'
  // with no matching 'in' would silently contribute nothing to worked_minutes
  // and look like a no-op bug.
  const open = await getOpenPunch(staffId)
  if (type === 'in' && open) {
    return NextResponse.json(
      { error: 'Already punched in -- punch out first.', code: 'already_in' },
      { status: 400 },
    )
  }
  if (type === 'out' && !open) {
    return NextResponse.json(
      { error: 'No open punch-in to close.', code: 'not_in' },
      { status: 400 },
    )
  }

  const insert: Record<string, any> = {
    staff_id: staffId,
    punch_type: type,
    source,
    recorded_by: sessionUser.id,
    note: body.note ?? null,
    client_ip: clientIp,
    ip_check: ipCheck,
    // work_date is NEVER set here -- trg_attendance_punches_work_date derives it
    // from Asia/Kolkata and makes a punch-out inherit its punch-in's day.
  }
  if (source === 'supervisor') {
    insert.reason = body.reason.trim()
    if (body.punched_at) insert.punched_at = body.punched_at
  }

  const { data: punch, error } = await supabaseAdmin
    .from('attendance_punches')
    .insert(insert)
    .select('id, staff_id, punch_type, punched_at, work_date, source')
    .single()

  if (error || !punch) {
    return NextResponse.json({ error: error?.message || 'Failed to record punch.' }, { status: 500 })
  }

  // attendance_days is written by trg_attendance_punches_sync_day, so this read
  // happens after the insert and reflects the freshly derived summary.
  const { data: day } = await supabaseAdmin
    .from('attendance_days')
    .select('id, work_date, status, status_source, first_in_at, last_out_at, worked_minutes, punch_pair_count, late_minutes, is_late, overtime_minutes')
    .eq('staff_id', staffId)
    .eq('work_date', punch.work_date)
    .maybeSingle()

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'attendance',
    tableName: 'attendance_punches',
    recordId: punch.id,
    recordLabel: `${staffRow.full_name} punch ${type} ${punch.work_date}`,
    reason: source === 'supervisor' ? body.reason.trim() : null,
    metadata: { source, client_ip: clientIp, ip_check: ipCheck, on_behalf_of: source === 'supervisor' ? staffId : undefined },
  })

  return NextResponse.json({ success: true, punch, day: day ?? null }, { status: 201 })
}

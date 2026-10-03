import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, canEditPage, isManagerOrAbove } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { notify } from '@/lib/notifications'

// Approve or reject.
//
// The whole decision is one RPC call, because the status flip and the
// attendance_days writes must be a single transaction -- a half-applied
// approval (decided but no days written, or days written twice) is the worst
// failure mode in this module. decide_leave_request() carries two independent
// atomic claims for exactly that: one on status='pending', one on
// applied_at IS NULL. `claimed: false` means another call already won the race,
// which is a 409 here rather than a silent second approval.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManagerOrAbove(sessionUser) || !canEditPage(sessionUser, 'attendance')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const decision = body.decision
  if (decision !== 'approved' && decision !== 'rejected') {
    return NextResponse.json({ error: 'decision must be "approved" or "rejected".' }, { status: 400 })
  }

  const { data: existing } = await supabaseAdmin
    .from('leave_requests')
    .select('id, from_date, to_date, status, staff ( full_name )')
    .eq('id', id)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Leave request not found.' }, { status: 404 })

  const { data, error } = await supabaseAdmin.rpc('decide_leave_request', {
    p_leave_id: id,
    p_decision: decision,
    p_actor: sessionUser.id,
    p_note: body.note?.trim() || null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!data?.claimed) {
    return NextResponse.json({ error: 'This leave request was already decided.' }, { status: 409 })
  }

  const staffName = (existing as any).staff?.full_name ?? 'staff'

  // Tell the person who filed it. notify() no-ops when recipient === actor, so
  // a supervisor approving their own request does not notify themselves.
  if (data.requested_by) {
    await notify({
      recipientId: data.requested_by,
      type: 'status_changed',
      actorId: sessionUser.id,
      activityId: data.activity_id ?? null,
      title: `Leave ${decision}: ${staffName}`,
      body: `${existing.from_date}${existing.to_date !== existing.from_date ? ` to ${existing.to_date}` : ''}`
        + (body.note?.trim() ? ` - ${body.note.trim()}` : ''),
      link: `/dashboard/attendance?tab=leave&open=${id}`,
    })
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'status_change',
    module: 'attendance',
    tableName: 'leave_requests',
    recordId: id,
    recordLabel: `${staffName} leave ${decision} (${existing.from_date}..${existing.to_date})`,
    reason: body.note?.trim() || null,
    metadata: { from: 'pending', to: decision, days_written: data.days_written },
  })

  return NextResponse.json({ success: true, days_written: data.days_written })
}

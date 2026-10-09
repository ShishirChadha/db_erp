import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner, isManagerOrAbove } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { getMyStaffRow } from '@/lib/attendance-server'

const SELECT = `
  id, staff_id, leave_type, from_date, to_date, day_part, reason, status,
  requested_by, decided_by, decided_at, decision_note, activity_id, applied_at,
  created_at, staff ( id, full_name, employee_code, profile_id )
`

async function loadVisible(id: string, sessionUser: { id: string; role: string }) {
  const { data } = await supabaseAdmin.from('leave_requests').select(SELECT).eq('id', id).maybeSingle()
  if (!data) return { row: null, allowed: false }
  if (isManagerOrAbove(sessionUser as any)) return { row: data, allowed: true }
  const own = await getMyStaffRow(sessionUser.id)
  return { row: data, allowed: !!own && own.id === (data as any).staff_id }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { row, allowed } = await loadVisible(id, sessionUser)
  // Same 404 whether it does not exist or is not yours -- no existence oracle.
  if (!row || !allowed) return NextResponse.json({ error: 'Leave request not found.' }, { status: 404 })
  return NextResponse.json(row)
}

// Cancel. Two different acts behind one verb:
//   - a PENDING request can be withdrawn by its own staff member (or a manager)
//   - an APPROVED request can only be undone by the owner, because attendance
//     days have already been written and have to be released and recomputed,
//     which is what revoke_leave_from_days() does atomically.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  if (body.status !== 'cancelled') {
    return NextResponse.json(
      { error: 'Only status: "cancelled" is supported here. Use /decide to approve or reject.' },
      { status: 400 },
    )
  }

  const { row, allowed } = await loadVisible(id, sessionUser)
  if (!row || !allowed) return NextResponse.json({ error: 'Leave request not found.' }, { status: 404 })

  const current = (row as any).status as string
  const staffName = (row as any).staff?.full_name ?? 'staff'

  if (current === 'approved') {
    if (!isOwner(sessionUser)) {
      return NextResponse.json(
        { error: 'Only the owner can undo an approved leave.' },
        { status: 403 },
      )
    }
    const { data, error } = await supabaseAdmin.rpc('revoke_leave_from_days', {
      p_leave_id: id,
      p_actor: sessionUser.id,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data?.claimed) {
      return NextResponse.json({ error: 'That leave request is no longer approved.' }, { status: 409 })
    }

    await logAuditEvent({
      actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
      actionType: 'status_change',
      module: 'attendance',
      tableName: 'leave_requests',
      recordId: id,
      recordLabel: `${staffName} approved leave undone`,
      reason: body.reason ?? null,
      metadata: { days_released: data.days_released },
    })
    return NextResponse.json({ success: true, days_released: data.days_released })
  }

  if (current !== 'pending') {
    return NextResponse.json({ error: `A ${current} request cannot be cancelled.` }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('leave_requests').update({ status: 'cancelled' }).eq('id', id).eq('status', 'pending')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Withdraw the approval task too -- there is nothing left to decide.
  if ((row as any).activity_id) {
    await supabaseAdmin.from('activities')
      .update({ status: 'cancelled' }).eq('id', (row as any).activity_id).neq('status', 'cancelled')
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'status_change',
    module: 'attendance',
    tableName: 'leave_requests',
    recordId: id,
    recordLabel: `${staffName} leave request cancelled`,
    metadata: { from: 'pending', to: 'cancelled' },
  })

  return NextResponse.json({ success: true })
}

// Hard-delete a leave request. Owner only.
//
// If approved, calls revoke_leave_from_days first to release the attendance_days
// rows that were written when it was approved — same as the cancel path but then
// physically removes the row so it never shows up in the leave list.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Only the owner can delete a leave request.' }, { status: 403 })

  const { id } = await params
  const { data: row } = await supabaseAdmin.from('leave_requests').select('id, staff_id, status, activity_id, staff ( full_name )').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Leave request not found.' }, { status: 404 })

  const staffName = (row as any).staff?.full_name ?? 'staff'
  const current = (row as any).status as string

  // Release attendance_days rows if the leave was already approved.
  if (current === 'approved') {
    const { data: rpc, error: rpcErr } = await supabaseAdmin.rpc('revoke_leave_from_days', {
      p_leave_id: id,
      p_actor: sessionUser.id,
    })
    if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 })
    if (!rpc?.claimed) {
      return NextResponse.json({ error: 'Could not revoke the approved leave — try again.' }, { status: 409 })
    }
  }

  // Cancel the linked approval task if still open.
  if ((row as any).activity_id) {
    await supabaseAdmin.from('activities')
      .update({ status: 'cancelled' }).eq('id', (row as any).activity_id).neq('status', 'cancelled')
  }

  const { error: delErr } = await supabaseAdmin.from('leave_requests').delete().eq('id', id)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'hard_delete',
    module: 'attendance',
    tableName: 'leave_requests',
    recordId: id,
    recordLabel: `${staffName} leave request deleted (was ${current})`,
    metadata: { was_status: current },
  })

  return NextResponse.json({ success: true })
}

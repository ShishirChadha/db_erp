import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, canEditPage } from '@/lib/auth/session'
import { parsePagination } from '@/lib/pagination'
import { withRetry } from '@/lib/db-retry'
import { logAuditEvent } from '@/lib/audit-log'
import { notifyMany } from '@/lib/notifications'
import {
  resolveVisibleStaffIds, getMyStaffRow, getLeaveApprovers,
  LEAVE_TYPES, LEAVE_TYPE_LABELS, DAY_PARTS, type LeaveType,
} from '@/lib/attendance-server'

const SELECT = `
  id, staff_id, leave_type, from_date, to_date, day_part, reason, status,
  requested_by, decided_by, decided_at, decision_note, activity_id, applied_at,
  created_at, staff ( id, full_name, employee_code )
`

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'attendance')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const { staffIds } = await resolveVisibleStaffIds(sessionUser, searchParams.get('staff_id'))
  const pagination = parsePagination(searchParams)

  if (staffIds !== 'all' && staffIds.length === 0) {
    return pagination ? NextResponse.json({ data: [], total: 0 }) : NextResponse.json([])
  }

  let query = supabaseAdmin
    .from('leave_requests')
    .select(SELECT, pagination ? { count: 'exact' } : undefined)

  if (staffIds !== 'all') query = query.in('staff_id', staffIds)
  const status = searchParams.get('status')
  if (status) query = query.eq('status', status)

  // Date column first, newest first -- the house list rule.
  query = query
    .order('from_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data, error, count } = await withRetry(() => query)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (pagination) return NextResponse.json({ data: data || [], total: count ?? 0 })
  return NextResponse.json(data || [])
}

// File a leave request.
//
// Session-only for your own leave (same self-service reasoning as punching);
// filing on behalf of someone else -- the only way an account-less staff
// member's leave can be recorded -- needs the attendance edit grant.
//
// The approval itself is an `activities` row with related_type='leave_request',
// assigned to the approvers, with notifications. No per-module task table and
// no per-module notifier, per CLAUDE.md.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const onBehalf = !!body.staff_id

  let staffId: string
  if (onBehalf) {
    if (!canEditPage(sessionUser, 'attendance')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }
    staffId = body.staff_id
  } else {
    const own = await getMyStaffRow(sessionUser.id)
    if (!own) {
      return NextResponse.json(
        { error: 'You are not on the staff roster, so there is no leave to file.' },
        { status: 404 },
      )
    }
    staffId = own.id
  }

  const leaveType: LeaveType = body.leave_type
  if (!LEAVE_TYPES.includes(leaveType)) {
    return NextResponse.json({ error: `leave_type must be one of: ${LEAVE_TYPES.join(', ')}.` }, { status: 400 })
  }
  const fromDate = body.from_date
  const toDate = body.to_date || body.from_date
  if (!fromDate || !toDate) {
    return NextResponse.json({ error: 'from_date is required.' }, { status: 400 })
  }
  if (toDate < fromDate) {
    return NextResponse.json({ error: 'to_date cannot be before from_date.' }, { status: 400 })
  }
  const dayPart = body.day_part ?? 'full'
  if (!DAY_PARTS.includes(dayPart)) {
    return NextResponse.json({ error: `day_part must be one of: ${DAY_PARTS.join(', ')}.` }, { status: 400 })
  }
  // Mirrors leave_requests_half_day_single_check.
  if (dayPart !== 'full' && fromDate !== toDate) {
    return NextResponse.json(
      { error: 'A half-day leave must be a single day.' },
      { status: 400 },
    )
  }

  const { data: staff } = await supabaseAdmin
    .from('staff').select('id, full_name, is_deleted').eq('id', staffId).maybeSingle()
  if (!staff || staff.is_deleted) {
    return NextResponse.json({ error: 'Staff member not found.' }, { status: 404 })
  }

  const { data: created, error } = await supabaseAdmin
    .from('leave_requests')
    .insert({
      staff_id: staffId,
      leave_type: leaveType,
      from_date: fromDate,
      to_date: toDate,
      day_part: dayPart,
      reason: body.reason?.trim() || null,
      requested_by: sessionUser.id,
      status: 'pending',
    })
    .select('id')
    .single()

  if (error) {
    // leave_requests_live_range_idx -- a pending/approved request already
    // covers this range.
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'A leave request already covers these dates.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ---------- the approval task ----------
  const approvers = await getLeaveApprovers()
  let activityId: string | null = null

  if (approvers.length > 0) {
    const dayPartSuffix = dayPart === 'full' ? '' : ` (${dayPart.replace('_', ' ')})`
    const { data: act } = await supabaseAdmin
      .from('activities')
      .insert({
        user_id: approvers[0],
        created_by: sessionUser.id,
        title: `Leave request: ${staff.full_name} (${fromDate}${toDate !== fromDate ? ` to ${toDate}` : ''})`,
        description:
          `${LEAVE_TYPE_LABELS[leaveType]}${dayPartSuffix}. Reason: ${body.reason?.trim() || '--'}\n` +
          `Approve or reject from Attendance > Leave.`,
        due_date: new Date(fromDate).toISOString(),
        related_type: 'leave_request',
        related_id: created.id,
        priority: 'normal',
        status: 'pending',
      })
      .select('id')
      .single()

    if (act) {
      activityId = act.id
      // Inserted directly rather than via areValidUsers(): that gate requires
      // 'activities' in allowed_pages, so a manager who approves leave but was
      // never granted the Activity Hub would be rejected. Same reason
      // scan_recurring_expenses()/scan_rental_cycles() insert these themselves.
      await supabaseAdmin.from('activity_assignees').insert(
        approvers.map(uid => ({ activity_id: act.id, user_id: uid, assigned_by: sessionUser.id })),
      )
      await supabaseAdmin.from('leave_requests').update({ activity_id: act.id }).eq('id', created.id)

      await notifyMany(approvers.map(uid => ({
        recipientId: uid,
        type: 'task_assigned' as const,
        actorId: sessionUser.id,
        activityId: act.id,
        title: `Leave request: ${staff.full_name}`,
        body: `${fromDate}${toDate !== fromDate ? ` to ${toDate}` : ''} - ${LEAVE_TYPE_LABELS[leaveType]}`,
        link: `/dashboard/activities?open=${act.id}`,
      })))
    }
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'attendance',
    tableName: 'leave_requests',
    recordId: created.id,
    recordLabel: `${staff.full_name} ${leaveType} ${fromDate}..${toDate}`,
    reason: body.reason?.trim() || null,
    metadata: { on_behalf_of: onBehalf ? staffId : undefined, activity_id: activityId },
  })

  const { data: full } = await supabaseAdmin
    .from('leave_requests').select(SELECT).eq('id', created.id).single()

  return NextResponse.json({ success: true, leave_request: full }, { status: 201 })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logFieldCorrections } from '@/lib/field-corrections'
import {
  ACTIVITY_PRIORITIES, ACTIVITY_STATUSES, ACTIVITY_RELATED_TYPES,
  canSeeActivity, getProfileMap, areValidUsers,
} from '@/lib/activities'
import { notifyMany } from '@/lib/notifications'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- GET: single activity, its assignees, and its change history ----------
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: activity } = await supabaseAdmin
    .from('activities').select('*').eq('id', id).eq('is_deleted', false).maybeSingle()
  if (!activity) return NextResponse.json({ error: 'Activity not found.' }, { status: 404 })
  if (!(await canSeeActivity(sessionUser, id, activity.created_by))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { data: assigneeRows } = await supabaseAdmin
    .from('activity_assignees').select('user_id, assigned_by, assigned_at').eq('activity_id', id)
  const { data: watcherRows } = await supabaseAdmin
    .from('activity_watchers').select('user_id, added_by, added_at').eq('activity_id', id)
  const { data: checklistRows } = await supabaseAdmin
    .from('activity_checklist_items').select('*').eq('activity_id', id).order('position', { ascending: true })
  const { data: history } = await supabaseAdmin
    .from('field_corrections').select('field_name, old_value, new_value, changed_by, changed_at')
    .eq('table_name', 'activities').eq('record_id', id).order('changed_at', { ascending: true })

  const nameIds = [
    activity.created_by, activity.completed_by, activity.reviewed_by,
    ...(assigneeRows || []).flatMap((r) => [r.user_id, r.assigned_by]),
    ...(watcherRows || []).flatMap((r) => [r.user_id, r.added_by]),
    ...(history || []).map((h) => h.changed_by),
  ].filter(Boolean) as string[]
  const profileMap = await getProfileMap(nameIds)
  const nameFor = (uid: string | null) => (uid ? profileMap.get(uid)?.full_name || 'Unknown user' : null)

  return NextResponse.json({
    ...activity,
    created_by_name: nameFor(activity.created_by),
    completed_by_name: nameFor(activity.completed_by),
    reviewed_by_name: nameFor(activity.reviewed_by),
    assignees: (assigneeRows || []).map((r) => ({
      user_id: r.user_id, name: nameFor(r.user_id), assigned_by_name: nameFor(r.assigned_by), assigned_at: r.assigned_at,
    })),
    watchers: (watcherRows || []).map((r) => ({
      user_id: r.user_id, name: nameFor(r.user_id), added_by_name: nameFor(r.added_by), added_at: r.added_at,
    })),
    checklist: checklistRows || [],
    history: (history || []).map((h) => ({ ...h, changed_by_name: nameFor(h.changed_by) })),
  })
}

// ---------- PUT: edit fields / status / assignees; logs field-level history ----------
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing } = await supabaseAdmin
    .from('activities').select('*').eq('id', id).eq('is_deleted', false).maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Activity not found.' }, { status: 404 })

  const body = await req.json()

  if (body.mark_reviewed === true && !isOwner(sessionUser)) {
    return NextResponse.json({ error: 'Only the owner can mark a task reviewed.' }, { status: 403 })
  }
  if (!(await canSeeActivity(sessionUser, id, existing.created_by))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  if (body.status !== undefined && !ACTIVITY_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
  }
  if (body.priority !== undefined && !ACTIVITY_PRIORITIES.includes(body.priority)) {
    return NextResponse.json({ error: 'Invalid priority.' }, { status: 400 })
  }
  const relatedType = body.related_type !== undefined ? body.related_type : existing.related_type
  const relatedId = body.related_id !== undefined ? body.related_id : existing.related_id
  if (relatedType && !ACTIVITY_RELATED_TYPES.includes(relatedType)) {
    return NextResponse.json({ error: 'Invalid related_type.' }, { status: 400 })
  }
  if ((relatedType && !relatedId) || (!relatedType && relatedId)) {
    return NextResponse.json({ error: 'related_type and related_id must be set together.' }, { status: 400 })
  }

  const trackedFields = ['title', 'description', 'status', 'priority', 'due_date', 'related_type', 'related_id'] as const
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const field of trackedFields) {
    if (body[field] !== undefined) updates[field] = body[field]
  }
  if (body.tags !== undefined) updates.tags = Array.isArray(body.tags) ? body.tags : []
  if (body.reminder_at !== undefined) updates.reminder_at = body.reminder_at

  // Completion timestamp follows the status transition, not a client-supplied value.
  if (body.status !== undefined && body.status !== existing.status) {
    if (body.status === 'done') {
      updates.completed_at = new Date().toISOString()
      updates.completed_by = sessionUser.id
    } else if (existing.status === 'done') {
      updates.completed_at = null
      updates.completed_by = null
    }
  }
  if (body.mark_reviewed === true) {
    updates.reviewed_at = new Date().toISOString()
    updates.reviewed_by = sessionUser.id
  }

  // A changed due_date starts a fresh reminder cycle for the pg_cron scan
  // (see scan_activity_due_dates()); reopening a done/cancelled task does too,
  // since its due date may already be in the past.
  const dueDateChanged = body.due_date !== undefined && body.due_date !== existing.due_date
  const reopened = body.status !== undefined && ['done', 'cancelled'].includes(existing.status) && !['done', 'cancelled'].includes(body.status)
  if (dueDateChanged || reopened) {
    updates.due_soon_notified_at = null
    updates.overdue_notified_at = null
  }

  // Fetch current assignees/watchers once -- used both as the status-change
  // notification audience and as the "before" baseline for the diffs below.
  const [{ data: currentAssigneeRows }, { data: currentWatcherRows }] = await Promise.all([
    supabaseAdmin.from('activity_assignees').select('user_id').eq('activity_id', id),
    supabaseAdmin.from('activity_watchers').select('user_id').eq('activity_id', id),
  ])
  const currentIds = (currentAssigneeRows || []).map((r) => r.user_id)
  const currentWatcherIds = (currentWatcherRows || []).map((r) => r.user_id)

  const { data: updated, error } = await supabaseAdmin
    .from('activities').update(updates).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const changes = trackedFields
    .filter((f) => body[f] !== undefined)
    .map((f) => ({ field: f, oldValue: existing[f], newValue: updated[f] }))
  const fieldCorrectionIds = await logFieldCorrections('activities', id, changes, sessionUser.id)

  const statusChanged = body.status !== undefined && body.status !== existing.status
  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: statusChanged ? 'status_change' : 'update',
    module: 'activities',
    tableName: 'activities',
    recordId: id,
    recordLabel: updated.title,
    fieldCorrectionIds,
  })

  if (body.status !== undefined && body.status !== existing.status) {
    const audience = [...new Set([...currentIds, existing.created_by])]
    await notifyMany(audience.map((userId) => ({
      recipientId: userId, type: 'status_changed', actorId: sessionUser.id, activityId: id,
      title: updated.title, body: `${existing.status} → ${updated.status}`,
      link: `/dashboard/activities?open=${id}`,
    })))
  }

  // Assignee changes: diff current vs requested, insert/delete rows, log a summary correction.
  if (Array.isArray(body.assignee_ids)) {
    const newAssigneeIds: string[] = [...new Set(body.assignee_ids as string[])]
    if (!(await areValidUsers(newAssigneeIds))) {
      return NextResponse.json({ error: 'One or more assignees are not valid active users with Activity Hub access.' }, { status: 400 })
    }

    const toRemove = currentIds.filter((uid) => !newAssigneeIds.includes(uid))
    const toAdd = newAssigneeIds.filter((uid) => !currentIds.includes(uid))

    if (toRemove.length > 0) {
      await supabaseAdmin.from('activity_assignees').delete().eq('activity_id', id).in('user_id', toRemove)
    }
    if (toAdd.length > 0) {
      await supabaseAdmin.from('activity_assignees').insert(
        toAdd.map((userId) => ({ activity_id: id, user_id: userId, assigned_by: sessionUser.id }))
      )
      await notifyMany(toAdd.map((userId) => ({
        recipientId: userId, type: 'task_reassigned', actorId: sessionUser.id, activityId: id,
        title: updated.title, link: `/dashboard/activities?open=${id}`,
      })))
    }
    if (toRemove.length > 0 || toAdd.length > 0) {
      const nameMap = await getProfileMap([...currentIds, ...newAssigneeIds])
      const nameList = (ids: string[]) => ids.map((uid) => nameMap.get(uid)?.full_name || uid).join(', ') || '(none)'
      await logFieldCorrections('activities', id,
        [{ field: 'assignees', oldValue: nameList(currentIds), newValue: nameList(newAssigneeIds) }],
        sessionUser.id)
    }
  }

  // Watcher changes: same diff pattern as assignees, kept in a separate table/notification
  // type since watching is visibility-only, not an assignment.
  if (Array.isArray(body.watcher_ids)) {
    const requestedWatcherIds: string[] = [...new Set(body.watcher_ids as string[])]
    // Re-derive the current assignee set (post any change above) so a user who's
    // just been made an assignee is never also left as a redundant watcher.
    const { data: postAssigneeRows } = await supabaseAdmin
      .from('activity_assignees').select('user_id').eq('activity_id', id)
    const postAssigneeIds = (postAssigneeRows || []).map((r) => r.user_id)
    const newWatcherIds = requestedWatcherIds.filter((uid) => !postAssigneeIds.includes(uid))
    if (!(await areValidUsers(newWatcherIds))) {
      return NextResponse.json({ error: 'One or more watchers are not valid active users with Activity Hub access.' }, { status: 400 })
    }

    const toRemove = currentWatcherIds.filter((uid) => !newWatcherIds.includes(uid))
    const toAdd = newWatcherIds.filter((uid) => !currentWatcherIds.includes(uid))

    if (toRemove.length > 0) {
      await supabaseAdmin.from('activity_watchers').delete().eq('activity_id', id).in('user_id', toRemove)
    }
    if (toAdd.length > 0) {
      await supabaseAdmin.from('activity_watchers').insert(
        toAdd.map((userId) => ({ activity_id: id, user_id: userId, added_by: sessionUser.id }))
      )
      await notifyMany(toAdd.map((userId) => ({
        recipientId: userId, type: 'task_watched', actorId: sessionUser.id, activityId: id,
        title: updated.title, link: `/dashboard/activities?open=${id}`,
      })))
    }
    if (toRemove.length > 0 || toAdd.length > 0) {
      const nameMap = await getProfileMap([...currentWatcherIds, ...newWatcherIds])
      const nameList = (ids: string[]) => ids.map((uid) => nameMap.get(uid)?.full_name || uid).join(', ') || '(none)'
      await logFieldCorrections('activities', id,
        [{ field: 'watchers', oldValue: nameList(currentWatcherIds), newValue: nameList(newWatcherIds) }],
        sessionUser.id)
    }
  }

  return NextResponse.json({ success: true })
}

// ---------- DELETE: soft-delete (creator or owner only) ----------
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing } = await supabaseAdmin
    .from('activities').select('id, title, created_by, is_deleted').eq('id', id).maybeSingle()
  if (!existing || existing.is_deleted) return NextResponse.json({ error: 'Activity not found.' }, { status: 404 })
  if (!isOwner(sessionUser) && existing.created_by !== sessionUser.id) {
    return NextResponse.json({ error: 'Only the task creator or the owner can delete a task.' }, { status: 403 })
  }

  const { error } = await supabaseAdmin
    .from('activities').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logFieldCorrections('activities', id, [{ field: 'is_deleted', oldValue: false, newValue: true }], sessionUser.id)

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'soft_delete',
    module: 'activities',
    tableName: 'activities',
    recordId: id,
    recordLabel: existing.title,
    restoreStatus: 'restorable',
  })

  return NextResponse.json({ success: true })
}

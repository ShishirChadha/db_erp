import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, isOwner } from '@/lib/auth/session'
import {
  ACTIVITY_PRIORITIES, ACTIVITY_STATUSES, ACTIVITY_RELATED_TYPES,
  buildOwnVisibilityFilter, getAssigneesForActivities, getProfileMap, areValidAssignees,
} from '@/lib/activities'
import { notifyMany } from '@/lib/notifications'

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'activities')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const statusParam = searchParams.get('status')
  const tag = searchParams.get('tag')
  const dueFrom = searchParams.get('due_from')
  const dueTo = searchParams.get('due_to')
  const remindFrom = searchParams.get('remind_from')
  const search = searchParams.get('search')
  const sortBy = searchParams.get('sort_by') || 'created_at'
  const sortOrder = searchParams.get('sort_order') === 'asc'

  let query = supabaseAdmin.from('activities').select('*').eq('is_deleted', false)

  // Owners see every task; employees see what they created or are assigned to.
  if (!isOwner(sessionUser)) {
    const filter = await buildOwnVisibilityFilter(sessionUser.id)
    query = query.or(filter)
  }

  if (statusParam && statusParam !== 'all') {
    query = query.in('status', statusParam.split(','))
  }
  if (tag) query = query.contains('tags', [tag])
  if (dueFrom) query = query.gte('due_date', dueFrom)
  if (dueTo) query = query.lte('due_date', dueTo)
  if (remindFrom) query = query.gte('reminder_at', remindFrom)
  if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`)

  const columnMap: Record<string, string> = {
    title: 'title', tags: 'tags', status: 'status', priority: 'priority',
    due_date: 'due_date', reminder_at: 'reminder_at', entry_date: 'created_at',
  }
  const dbColumn = columnMap[sortBy] || 'created_at'
  query = query.order(dbColumn, { ascending: sortOrder, nullsFirst: false })

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const activityIds = (data || []).map((a) => a.id)
  const assigneesByActivity = await getAssigneesForActivities(activityIds)
  const allUserIds = [
    ...(data || []).map((a) => a.created_by),
    ...Array.from(assigneesByActivity.values()).flat(),
  ]
  const profileMap = await getProfileMap(allUserIds)

  const enriched = (data || []).map((a) => {
    const assigneeIds = assigneesByActivity.get(a.id) || []
    return {
      ...a,
      created_by_name: profileMap.get(a.created_by)?.full_name || null,
      assignee_ids: assigneeIds,
      assignee_names: assigneeIds.map((id) => profileMap.get(id)?.full_name || 'Unknown user'),
    }
  })

  return NextResponse.json(enriched)
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'activities')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const {
    title, description, tags, status, due_date, reminder_at,
    priority, related_type, related_id, assignee_ids,
  } = body

  if (!title || !String(title).trim()) return NextResponse.json({ error: 'Title is required.' }, { status: 400 })
  if (status && !ACTIVITY_STATUSES.includes(status)) return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
  if (priority && !ACTIVITY_PRIORITIES.includes(priority)) return NextResponse.json({ error: 'Invalid priority.' }, { status: 400 })
  if (related_type && !ACTIVITY_RELATED_TYPES.includes(related_type)) return NextResponse.json({ error: 'Invalid related_type.' }, { status: 400 })
  if ((related_type && !related_id) || (!related_type && related_id)) {
    return NextResponse.json({ error: 'related_type and related_id must be set together.' }, { status: 400 })
  }

  const assigneeIds: string[] = Array.isArray(assignee_ids) ? [...new Set(assignee_ids)] : []
  if (!(await areValidAssignees(assigneeIds))) {
    return NextResponse.json({ error: 'One or more assignees are not valid active users with Activity Hub access.' }, { status: 400 })
  }

  const { data: created, error } = await supabaseAdmin
    .from('activities')
    .insert({
      user_id: sessionUser.id,
      created_by: sessionUser.id,
      title: String(title).trim(),
      description: description || null,
      tags: Array.isArray(tags) ? tags : [],
      status: status || 'pending',
      priority: priority || 'normal',
      due_date: due_date || null,
      reminder_at: reminder_at || null,
      related_type: related_type || null,
      related_id: related_id || null,
    })
    .select('*')
    .single()

  if (error || !created) return NextResponse.json({ error: error?.message || 'Failed to create activity.' }, { status: 500 })

  if (assigneeIds.length > 0) {
    const { error: assignErr } = await supabaseAdmin.from('activity_assignees').insert(
      assigneeIds.map((userId) => ({ activity_id: created.id, user_id: userId, assigned_by: sessionUser.id }))
    )
    if (assignErr) return NextResponse.json({ error: assignErr.message }, { status: 500 })

    await notifyMany(assigneeIds.map((userId) => ({
      recipientId: userId, type: 'task_assigned', actorId: sessionUser.id, activityId: created.id,
      title: created.title, link: `/dashboard/activities?open=${created.id}`,
    })))
  }

  return NextResponse.json({ success: true, id: created.id }, { status: 201 })
}

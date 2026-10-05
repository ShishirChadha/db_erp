import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isManagerOrAbove } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { notify } from '@/lib/notifications'
import { getLeadSetOrNull } from '@/lib/leads'

// ---------- POST: transfer-with-history ----------
// Same leads/activities/comments stay attached -- the new holder sees
// everything the previous one logged. That's what distinguishes this from
// clone (fresh copy), which starts the new set with zero history by
// construction (new leads, activity_id null).
//
// Manager-or-above only: reassigning who can see/work a Set is the access-
// control lever the owner specifically asked for, one notch more sensitive
// than editing a Set's own fields (which the current holder may also do).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManagerOrAbove(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const newAssigneeId = body?.new_assignee_id
  if (!newAssigneeId) return NextResponse.json({ error: 'new_assignee_id is required.' }, { status: 400 })

  const set = await getLeadSetOrNull(id)
  if (!set) return NextResponse.json({ error: 'Set not found.' }, { status: 404 })

  const { data: newAssignee } = await supabaseAdmin
    .from('profiles').select('id, full_name, is_active').eq('id', newAssigneeId).maybeSingle()
  if (!newAssignee || !newAssignee.is_active) {
    return NextResponse.json({ error: 'The chosen staff member is not a valid active user.' }, { status: 400 })
  }

  const previousAssigneeId = set.current_assignee_id

  const { error: setErr } = await supabaseAdmin
    .from('lead_sets')
    .update({ current_assignee_id: newAssigneeId, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 })

  const now = new Date().toISOString()
  if (previousAssigneeId) {
    await supabaseAdmin
      .from('lead_set_assignment_history')
      .update({ unassigned_at: now })
      .eq('set_id', id)
      .is('unassigned_at', null)
  }
  await supabaseAdmin.from('lead_set_assignment_history').insert({
    set_id: id, assignee_id: newAssigneeId, assigned_by: sessionUser.id, note: body?.note ? String(body.note).trim() : null,
  })

  // Activity Hub visibility (lib/activities.ts) is governed by activity_assignees
  // membership independently of lead_sets -- without swapping this, the old
  // holder would keep seeing every worked lead's call-history comments after
  // handoff, silently defeating "transfer" as an access-control boundary.
  const { data: workedLeads } = await supabaseAdmin
    .from('leads').select('id, activity_id').eq('set_id', id).eq('is_deleted', false).not('activity_id', 'is', null)
  const activityIds = (workedLeads || []).map((l: any) => l.activity_id)
  if (activityIds.length > 0 && previousAssigneeId) {
    await supabaseAdmin.from('activity_assignees').delete().eq('user_id', previousAssigneeId).in('activity_id', activityIds)
  }
  if (activityIds.length > 0) {
    await supabaseAdmin.from('activity_assignees').upsert(
      activityIds.map((activityId: string) => ({ activity_id: activityId, user_id: newAssigneeId, assigned_by: sessionUser.id })),
      { onConflict: 'activity_id,user_id', ignoreDuplicates: true }
    )
  }

  await notify({
    recipientId: newAssigneeId, type: 'task_reassigned', actorId: sessionUser.id,
    title: `Lead Set "${set.name}" assigned to you`, link: `/dashboard/leads?set=${id}`,
  })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'leads', tableName: 'lead_sets', recordId: id, recordLabel: set.name,
    metadata: { action: 'reassign', from_assignee: previousAssigneeId, to_assignee: newAssigneeId },
  })

  return NextResponse.json({ success: true })
}

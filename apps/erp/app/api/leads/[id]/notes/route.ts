import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, canEditPage } from '@/lib/auth/session'
import { getProfileMap } from '@/lib/activities'
import { logAuditEvent } from '@/lib/audit-log'
import { getLeadSetOrNull, isCurrentHolderOrManager } from '@/lib/leads'

async function loadLeadWithSet(id: string) {
  const { data: lead } = await supabaseAdmin
    .from('leads').select('id, set_id, name, activity_id').eq('id', id).eq('is_deleted', false).maybeSingle()
  if (!lead) return null
  const set = await getLeadSetOrNull(lead.set_id)
  if (!set) return null
  return { lead, set }
}

// ---------- GET: the lead's call-history thread (empty/no-activity-yet is valid) ----------
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const found = await loadLeadWithSet(id)
  if (!found) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
  if (!isCurrentHolderOrManager(sessionUser, found.set)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  if (!found.lead.activity_id) return NextResponse.json({ activity_id: null, follow_up_date: null, comments: [] })

  const [{ data: comments }, { data: activity }] = await Promise.all([
    supabaseAdmin
      .from('activity_comments').select('id, author_id, body, created_at')
      .eq('activity_id', found.lead.activity_id).eq('is_deleted', false)
      .order('created_at', { ascending: true }),
    supabaseAdmin.from('activities').select('due_date').eq('id', found.lead.activity_id).maybeSingle(),
  ])

  const profileMap = await getProfileMap((comments || []).map((c) => c.author_id))
  return NextResponse.json({
    activity_id: found.lead.activity_id,
    follow_up_date: activity?.due_date || null,
    comments: (comments || []).map((c) => ({ ...c, author_name: profileMap.get(c.author_id)?.full_name || 'Unknown user' })),
  })
}

// ---------- POST: log a call/note and/or set a follow-up date -- lazily creates the linked activities row ----------
// This absence-until-first-touch is deliberate, not an oversight: creating an
// activities row (+ activity_assignees + notification) for every lead at
// import time would flood the Activity Hub for a 500-row CSV, most of which
// will never be worked. It's also what makes a fresh-copy clone's "zero
// history" true for free -- a cloned lead starts with activity_id null, same
// as any never-touched lead.
//
// A follow-up date is just activities.due_date on this same lazily-created
// row -- not a new column, not a new table. That also means the existing,
// related_type-agnostic scan_activity_due_dates() cron already raises
// due_soon/overdue notifications for it with zero further migration: setting
// a follow-up date here is the whole mechanism for "the agent sees it and
// calls back".
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPage(sessionUser, 'leads')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const found = await loadLeadWithSet(id)
  if (!found) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
  if (!isCurrentHolderOrManager(sessionUser, found.set)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const text = String(body?.body || '').trim()
  const hasFollowUpField = body && Object.prototype.hasOwnProperty.call(body, 'follow_up_date')
  const followUpDate: string | null = hasFollowUpField ? (body.follow_up_date || null) : undefined as any
  if (!text && !hasFollowUpField) return NextResponse.json({ error: 'A note or a follow-up date is required.' }, { status: 400 })
  if (followUpDate && !/^\d{4}-\d{2}-\d{2}$/.test(followUpDate)) {
    return NextResponse.json({ error: 'Invalid follow-up date.' }, { status: 400 })
  }

  let activityId = found.lead.activity_id
  if (!activityId) {
    const { data: activity, error: actErr } = await supabaseAdmin
      .from('activities')
      .insert({
        user_id: sessionUser.id,
        created_by: sessionUser.id,
        title: `Lead: ${found.lead.name}`,
        status: 'pending',
        priority: 'normal',
        related_type: 'lead',
        related_id: id,
        due_date: followUpDate || null,
      })
      .select('id').single()
    if (actErr || !activity) return NextResponse.json({ error: actErr?.message || 'Failed to start call history.' }, { status: 500 })
    activityId = activity.id

    if (found.set.current_assignee_id) {
      await supabaseAdmin.from('activity_assignees').insert({
        activity_id: activityId, user_id: found.set.current_assignee_id, assigned_by: sessionUser.id,
      })
    }

    await supabaseAdmin.from('leads').update({ activity_id: activityId, updated_at: new Date().toISOString() }).eq('id', id)
  } else if (hasFollowUpField) {
    const { error: dueErr } = await supabaseAdmin
      .from('activities')
      .update({ due_date: followUpDate, due_soon_notified_at: null, overdue_notified_at: null, updated_at: new Date().toISOString() })
      .eq('id', activityId)
    if (dueErr) return NextResponse.json({ error: dueErr.message }, { status: 500 })
  }

  let comment: { id: string; author_id: string; body: string; created_at: string } | null = null
  if (text) {
    const { data: inserted, error: commentErr } = await supabaseAdmin
      .from('activity_comments')
      .insert({ activity_id: activityId, author_id: sessionUser.id, body: text })
      .select('id, author_id, body, created_at')
      .single()
    if (commentErr || !inserted) return NextResponse.json({ error: commentErr?.message || 'Failed to add note.' }, { status: 500 })
    comment = inserted
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'leads', tableName: 'activities', recordId: activityId,
    recordLabel: found.lead.name, metadata: { lead_id: id, has_note: !!text, follow_up_date: hasFollowUpField ? followUpDate : undefined },
  })

  return NextResponse.json({ success: true, activity_id: activityId, comment, follow_up_date: followUpDate }, { status: 201 })
}

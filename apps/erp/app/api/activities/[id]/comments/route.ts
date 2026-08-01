import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser } from '@/lib/auth/session'
import { canSeeActivity, getProfileMap } from '@/lib/activities'
import { notifyMany } from '@/lib/notifications'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- GET: comment thread for an activity ----------
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: activity } = await supabaseAdmin
    .from('activities').select('id, created_by').eq('id', id).eq('is_deleted', false).maybeSingle()
  if (!activity) return NextResponse.json({ error: 'Activity not found.' }, { status: 404 })
  if (!(await canSeeActivity(sessionUser, id, activity.created_by))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  // Pinned comments float to the top; within each group, oldest first.
  const { data: comments, error } = await supabaseAdmin
    .from('activity_comments').select('*').eq('activity_id', id).eq('is_deleted', false)
    .order('pinned', { ascending: false }).order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const commentIds = (comments || []).map((c) => c.id)
  const { data: reactionRows } = commentIds.length > 0
    ? await supabaseAdmin.from('activity_comment_reactions').select('comment_id, user_id, emoji').in('comment_id', commentIds)
    : { data: [] }

  const nameIds = [
    ...(comments || []).map((c) => c.author_id),
    ...(comments || []).flatMap((c) => c.mentioned_user_ids || []),
    ...(comments || []).map((c) => c.pinned_by).filter(Boolean),
  ]
  const profileMap = await getProfileMap(nameIds)

  return NextResponse.json((comments || []).map((c) => {
    const myReactions = (reactionRows || []).filter((r) => r.comment_id === c.id)
    const reactionSummary = Object.entries(
      myReactions.reduce<Record<string, string[]>>((acc, r) => {
        acc[r.emoji] = [...(acc[r.emoji] || []), r.user_id]
        return acc
      }, {})
    ).map(([emoji, userIds]) => ({ emoji, count: userIds.length, reactedByMe: userIds.includes(sessionUser.id) }))

    return {
      ...c,
      author_name: profileMap.get(c.author_id)?.full_name || 'Unknown user',
      mentioned_names: (c.mentioned_user_ids || []).map((uid: string) => profileMap.get(uid)?.full_name || 'Unknown user'),
      pinned_by_name: c.pinned_by ? profileMap.get(c.pinned_by)?.full_name || 'Unknown user' : null,
      reactions: reactionSummary,
    }
  }))
}

// ---------- POST: add a comment (optionally @mentioning users who can already see the task) ----------
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: activity } = await supabaseAdmin
    .from('activities').select('id, title, created_by').eq('id', id).eq('is_deleted', false).maybeSingle()
  if (!activity) return NextResponse.json({ error: 'Activity not found.' }, { status: 404 })
  if (!(await canSeeActivity(sessionUser, id, activity.created_by))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await req.json()
  const text = String(body.body || '').trim()
  if (!text) return NextResponse.json({ error: 'Comment body is required.' }, { status: 400 })

  // Attachments are uploaded client-side via the existing /api/storage/upload-url
  // signed-URL flow first; the comment just stores the returned {key, name, size}.
  const attachments = Array.isArray(body.attachments)
    ? body.attachments
        .filter((a: unknown): a is { key: unknown; name: unknown } => typeof a === 'object' && a !== null)
        .map((a: { key: unknown; name: unknown; size?: unknown }) => ({
          key: String(a.key || ''), name: String(a.name || ''), size: typeof a.size === 'number' ? a.size : null,
        }))
        .filter((a: { key: string }) => a.key)
    : []

  const { data: assigneeRows } = await supabaseAdmin.from('activity_assignees').select('user_id').eq('activity_id', id)
  const assigneeIds = (assigneeRows || []).map((r) => r.user_id)
  const { data: owners } = await supabaseAdmin.from('profiles').select('id').eq('role', 'owner')
  const ownerIds = (owners || []).map((o) => o.id)

  // Mentions are restricted to people who can already see this task (assignees,
  // the creator, or an owner who sees everything) -- prevents notifying/linking
  // someone into a task they'd get a 403 opening.
  const allowedMentionPool = new Set([...assigneeIds, activity.created_by, ...ownerIds])
  const mentionedIds: string[] = Array.isArray(body.mentioned_user_ids) ? [...new Set(body.mentioned_user_ids as string[])] : []
  if (mentionedIds.some((uid) => !allowedMentionPool.has(uid))) {
    return NextResponse.json({ error: 'Can only mention someone who can already see this task.' }, { status: 400 })
  }

  const { data: comment, error } = await supabaseAdmin
    .from('activity_comments')
    .insert({ activity_id: id, author_id: sessionUser.id, body: text, mentioned_user_ids: mentionedIds, attachments })
    .select('*').single()
  if (error || !comment) return NextResponse.json({ error: error?.message || 'Failed to add comment.' }, { status: 500 })

  const excerpt = text.length > 140 ? `${text.slice(0, 140)}…` : text
  const recipientType = new Map<string, 'comment_added' | 'mention'>()
  for (const uid of [...assigneeIds, activity.created_by]) {
    if (uid !== sessionUser.id) recipientType.set(uid, 'comment_added')
  }
  for (const uid of mentionedIds) {
    if (uid !== sessionUser.id) recipientType.set(uid, 'mention') // mention takes priority over a plain comment notice
  }

  await notifyMany(Array.from(recipientType.entries()).map(([recipientId, type]) => ({
    recipientId, type, actorId: sessionUser.id, activityId: id, commentId: comment.id,
    title: activity.title, body: excerpt, link: `/dashboard/activities?open=${id}`,
  })))

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'activities',
    tableName: 'activity_comments',
    recordId: comment.id,
    recordLabel: excerpt,
    metadata: { activity_id: id },
  })

  return NextResponse.json({ success: true, id: comment.id }, { status: 201 })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- PATCH: edit own comment body (author/owner) and/or pin (owner/task creator) ----------
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; commentId: string }> }) {
  const { commentId } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing } = await supabaseAdmin
    .from('activity_comments').select('id, activity_id, author_id, is_deleted').eq('id', commentId).maybeSingle()
  if (!existing || existing.is_deleted) return NextResponse.json({ error: 'Comment not found.' }, { status: 404 })

  const body = await req.json()
  const updates: Record<string, unknown> = {}

  if (body.body !== undefined) {
    if (!isOwner(sessionUser) && existing.author_id !== sessionUser.id) {
      return NextResponse.json({ error: 'Only the comment author or the owner can edit it.' }, { status: 403 })
    }
    const text = String(body.body || '').trim()
    if (!text) return NextResponse.json({ error: 'Comment body is required.' }, { status: 400 })
    updates.body = text
    updates.edited = true
  }

  // Pinning surfaces an important update to the top of the thread -- a
  // curation action for the task's owner/creator, not any comment author.
  if (body.pinned !== undefined) {
    const { data: activity } = await supabaseAdmin
      .from('activities').select('created_by').eq('id', existing.activity_id).maybeSingle()
    if (!isOwner(sessionUser) && activity?.created_by !== sessionUser.id) {
      return NextResponse.json({ error: 'Only the task creator or the owner can pin a comment.' }, { status: 403 })
    }
    updates.pinned = !!body.pinned
    updates.pinned_by = body.pinned ? sessionUser.id : null
    updates.pinned_at = body.pinned ? new Date().toISOString() : null
  }

  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  updates.updated_at = new Date().toISOString()

  const { error } = await supabaseAdmin.from('activity_comments').update(updates).eq('id', commentId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'activities',
    tableName: 'activity_comments',
    recordId: commentId,
    metadata: { pinned: updates.pinned, edited: updates.body !== undefined },
  })

  return NextResponse.json({ success: true })
}

// ---------- DELETE: soft-delete own comment (author or owner) ----------
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; commentId: string }> }) {
  const { commentId } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing } = await supabaseAdmin
    .from('activity_comments').select('id, author_id, is_deleted').eq('id', commentId).maybeSingle()
  if (!existing || existing.is_deleted) return NextResponse.json({ error: 'Comment not found.' }, { status: 404 })
  if (!isOwner(sessionUser) && existing.author_id !== sessionUser.id) {
    return NextResponse.json({ error: 'Only the comment author or the owner can delete it.' }, { status: 403 })
  }

  const { error } = await supabaseAdmin
    .from('activity_comments').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('id', commentId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'soft_delete',
    module: 'activities',
    tableName: 'activity_comments',
    recordId: commentId,
    restoreStatus: 'restorable',
  })

  return NextResponse.json({ success: true })
}

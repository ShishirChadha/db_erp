import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser } from '@/lib/auth/session'
import { ALLOWED_REACTIONS, canSeeActivity } from '@/lib/activities'

// ---------- POST: toggle a reaction (add if absent, remove if already reacted) ----------
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; commentId: string }> }) {
  const { commentId } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const emoji = String(body.emoji || '')
  if (!(ALLOWED_REACTIONS as readonly string[]).includes(emoji)) {
    return NextResponse.json({ error: 'Invalid reaction.' }, { status: 400 })
  }

  const { data: comment } = await supabaseAdmin
    .from('activity_comments').select('id, activity_id, is_deleted').eq('id', commentId).maybeSingle()
  if (!comment || comment.is_deleted) return NextResponse.json({ error: 'Comment not found.' }, { status: 404 })

  const { data: activity } = await supabaseAdmin
    .from('activities').select('created_by').eq('id', comment.activity_id).maybeSingle()
  if (!activity || !(await canSeeActivity(sessionUser, comment.activity_id, activity.created_by))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { data: existingReaction } = await supabaseAdmin
    .from('activity_comment_reactions')
    .select('id').eq('comment_id', commentId).eq('user_id', sessionUser.id).eq('emoji', emoji).maybeSingle()

  if (existingReaction) {
    const { error } = await supabaseAdmin.from('activity_comment_reactions').delete().eq('id', existingReaction.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, toggled: 'removed' })
  }

  const { error } = await supabaseAdmin
    .from('activity_comment_reactions').insert({ comment_id: commentId, user_id: sessionUser.id, emoji })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, toggled: 'added' })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser } from '@/lib/auth/session'
import { canSeeActivity } from '@/lib/activities'

async function loadItem(id: string, itemId: string) {
  const { data: activity } = await supabaseAdmin
    .from('activities').select('id, created_by').eq('id', id).eq('is_deleted', false).maybeSingle()
  if (!activity) return { activity: null, item: null }
  const { data: item } = await supabaseAdmin
    .from('activity_checklist_items').select('*').eq('id', itemId).eq('activity_id', id).maybeSingle()
  return { activity, item }
}

// ---------- PATCH: toggle done / edit text (same visibility boundary as adding one) ----------
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { activity, item } = await loadItem(id, itemId)
  if (!activity) return NextResponse.json({ error: 'Activity not found.' }, { status: 404 })
  if (!item) return NextResponse.json({ error: 'Checklist item not found.' }, { status: 404 })
  if (!(await canSeeActivity(sessionUser, id, activity.created_by))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await req.json()
  const updates: Record<string, unknown> = {}
  if (body.text !== undefined) {
    const text = String(body.text || '').trim()
    if (!text) return NextResponse.json({ error: 'Checklist item text cannot be empty.' }, { status: 400 })
    updates.text = text
  }
  if (body.is_done !== undefined) {
    updates.is_done = !!body.is_done
    updates.completed_at = body.is_done ? new Date().toISOString() : null
    updates.completed_by = body.is_done ? sessionUser.id : null
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No changes provided.' }, { status: 400 })

  const { data: updated, error } = await supabaseAdmin
    .from('activity_checklist_items').update(updates).eq('id', itemId).select('*').single()
  if (error || !updated) return NextResponse.json({ error: error?.message || 'Failed to update checklist item.' }, { status: 500 })

  return NextResponse.json({ success: true, item: updated })
}

// ---------- DELETE ----------
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { activity, item } = await loadItem(id, itemId)
  if (!activity) return NextResponse.json({ error: 'Activity not found.' }, { status: 404 })
  if (!item) return NextResponse.json({ error: 'Checklist item not found.' }, { status: 404 })
  if (!(await canSeeActivity(sessionUser, id, activity.created_by))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { error } = await supabaseAdmin.from('activity_checklist_items').delete().eq('id', itemId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

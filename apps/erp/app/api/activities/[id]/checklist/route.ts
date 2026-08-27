import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser } from '@/lib/auth/session'
import { canSeeActivity } from '@/lib/activities'

// ---------- POST: add a checklist item (anyone who can see the task -- same
// permission boundary as commenting, not owner-only) ----------
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: activity } = await supabaseAdmin
    .from('activities').select('id, created_by').eq('id', id).eq('is_deleted', false).maybeSingle()
  if (!activity) return NextResponse.json({ error: 'Activity not found.' }, { status: 404 })
  if (!(await canSeeActivity(sessionUser, id, activity.created_by))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await req.json()
  const text = String(body.text || '').trim()
  if (!text) return NextResponse.json({ error: 'Checklist item text is required.' }, { status: 400 })

  const { data: maxRow } = await supabaseAdmin
    .from('activity_checklist_items').select('position').eq('activity_id', id)
    .order('position', { ascending: false }).limit(1).maybeSingle()
  const nextPosition = (maxRow?.position ?? -1) + 1

  const { data: item, error } = await supabaseAdmin
    .from('activity_checklist_items')
    .insert({ activity_id: id, text, position: nextPosition, created_by: sessionUser.id })
    .select('*').single()
  if (error || !item) return NextResponse.json({ error: error?.message || 'Failed to add checklist item.' }, { status: 500 })

  return NextResponse.json({ success: true, item }, { status: 201 })
}

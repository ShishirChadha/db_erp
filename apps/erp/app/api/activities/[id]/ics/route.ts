import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser } from '@/lib/auth/session'
import { canSeeActivity } from '@/lib/activities'
import { buildVEvent, buildVCalendar } from '@/lib/ics'

// ---------- GET: download this task as a single-event .ics file ----------
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: activity } = await supabaseAdmin
    .from('activities').select('id, title, description, due_date, reminder_at, created_by')
    .eq('id', id).eq('is_deleted', false).maybeSingle()
  if (!activity) return NextResponse.json({ error: 'Activity not found.' }, { status: 404 })
  if (!(await canSeeActivity(sessionUser, id, activity.created_by))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  if (!activity.due_date) return NextResponse.json({ error: 'This task has no due date to export.' }, { status: 400 })

  const dueDate = new Date(activity.due_date)
  let reminderMinutesBefore: number | null = null
  if (activity.reminder_at) {
    const diffMs = dueDate.getTime() - new Date(activity.reminder_at).getTime()
    if (diffMs > 0) reminderMinutesBefore = Math.round(diffMs / 60000)
  }

  const vEvent = buildVEvent({
    uid: `activity-${activity.id}@db-erp`,
    title: activity.title,
    description: activity.description,
    start: dueDate,
    reminderMinutesBefore,
  })
  const ics = buildVCalendar([vEvent], activity.title)

  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${activity.id}.ics"`,
    },
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { buildOwnVisibilityFilter } from '@/lib/activities'
import { buildVEvent, buildVCalendar } from '@/lib/ics'

// ---------- GET: subscribable per-user calendar feed, public but token-gated ----------
// The token itself is the credential -- same "long random URL is the secret"
// idiom Google Calendar's own private iCal links use, since calendar apps
// poll this URL directly with no session/cookie/Bearer auth available to them.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('id, role, full_name, is_active')
    .eq('calendar_feed_token', token).maybeSingle()
  if (!profile || !profile.is_active) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  let query = supabaseAdmin
    .from('activities').select('id, title, description, due_date, reminder_at')
    .eq('is_deleted', false)
    .not('due_date', 'is', null)
    .not('status', 'in', '(done,cancelled)')

  if (profile.role !== 'owner') {
    const filter = await buildOwnVisibilityFilter(profile.id)
    query = query.or(filter)
  }

  const { data: activities, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const events = (activities || []).map((a) => {
    const dueDate = new Date(a.due_date as string)
    let reminderMinutesBefore: number | null = null
    if (a.reminder_at) {
      const diffMs = dueDate.getTime() - new Date(a.reminder_at).getTime()
      if (diffMs > 0) reminderMinutesBefore = Math.round(diffMs / 60000)
    }
    return buildVEvent({
      uid: `activity-${a.id}@db-erp`,
      title: a.title,
      description: a.description,
      start: dueDate,
      reminderMinutesBefore,
    })
  })

  const ics = buildVCalendar(events, `${profile.full_name || 'Activity Hub'} Tasks`)

  return new NextResponse(ics, {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
  })
}

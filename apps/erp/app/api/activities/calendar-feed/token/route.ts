import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser } from '@/lib/auth/session'

// ---------- GET: reveal the caller's own calendar feed URL ----------
// Every profile already has a calendar_feed_token (DEFAULT gen_random_uuid()
// on the column) so there's no lazy-create branch needed here.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile, error } = await supabaseAdmin
    .from('profiles').select('calendar_feed_token').eq('id', sessionUser.id).single()
  if (error || !profile) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 })

  const origin = new URL(req.url).origin
  return NextResponse.json({
    token: profile.calendar_feed_token,
    url: `${origin}/api/activities/calendar-feed/${profile.calendar_feed_token}`,
  })
}

// ---------- POST: rotate the caller's own feed token (invalidates the old URL) ----------
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const newToken = randomUUID()
  const { error } = await supabaseAdmin
    .from('profiles').update({ calendar_feed_token: newToken }).eq('id', sessionUser.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const origin = new URL(req.url).origin
  return NextResponse.json({
    token: newToken,
    url: `${origin}/api/activities/calendar-feed/${newToken}`,
  })
}

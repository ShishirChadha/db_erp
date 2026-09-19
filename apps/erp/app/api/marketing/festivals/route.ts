import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, canEditPage } from '@/lib/auth/session'

// ---------- GET: list the festival calendar ----------
// Read access matches the rest of the Marketing Studio (hasPageAccess), not owner-only
// -- this is a plain reference calendar of dates, nothing cost/vendor-bearing.
// Optional ?year=YYYY narrows to one calendar year (the Festival Calendar tab's
// year dropdown) -- omitted returns every seeded year so the client can also derive
// the full list of years to offer in that dropdown.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!hasPageAccess(sessionUser, 'marketing')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const year = searchParams.get('year')

  let query = supabaseAdmin.from('festival_calendar').select('*').eq('is_deleted', false).order('festival_date', { ascending: true })
  if (year && /^\d{4}$/.test(year)) {
    query = query.gte('festival_date', `${year}-01-01`).lte('festival_date', `${year}-12-31`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data || [])
}

// ---------- POST: add a festival calendar entry ----------
// Gated by the 'marketing' edit grant -- calendar upkeep (adding a missed festival or
// next year's dates) is ordinary marketing-content maintenance, not an owner-only action.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser || !canEditPage(sessionUser, 'marketing')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { name, festival_date, is_major } = body
  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!festival_date || Number.isNaN(Date.parse(festival_date))) {
    return NextResponse.json({ error: 'A valid festival_date is required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('festival_calendar')
    .insert({ name: name.trim(), festival_date, is_major: is_major !== false, created_by: sessionUser.id })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data, { status: 201 })
}

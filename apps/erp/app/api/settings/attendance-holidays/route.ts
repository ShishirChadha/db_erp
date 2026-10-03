import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// Shop-closure days.
//
// These live on festival_calendar, not a second holiday table: the two would be
// the same three columns (name, a year-specific date, a deleted flag) and the
// owner would have to type Diwali in twice. The only thing attendance needs
// that was not already there is "are we actually shut that day", which is the
// is_business_holiday flag -- false by default, because most rows here are
// marketing-content reference festivals the shop stays open on.
//
// Cross-module consequence worth knowing: deleting a festival row from the
// Marketing tab also removes it as a shop holiday. See
// docs/bible/modules/marketing.md.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'attendance')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  let query = supabaseAdmin
    .from('festival_calendar')
    .select('id, name, festival_date, is_major, is_business_holiday')
    .eq('is_deleted', false)
    .order('festival_date', { ascending: false })

  if (searchParams.get('closures_only') === 'true') query = query.eq('is_business_holiday', true)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  if (from) query = query.gte('festival_date', from)
  if (to) query = query.lte('festival_date', to)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

// Add a non-festival closure (stock-take, shop painting). is_major=false keeps
// it out of Marketing's headline festival list, which already groups by that.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || !body.festival_date) {
    return NextResponse.json({ error: 'name and festival_date are required.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('festival_calendar')
    .insert({
      name,
      festival_date: body.festival_date,
      is_major: body.is_major ?? false,
      is_business_holiday: body.is_business_holiday ?? true,
      created_by: sessionUser.id,
    })
    .select('id, name, festival_date, is_major, is_business_holiday')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create', module: 'attendance', tableName: 'festival_calendar',
    recordId: data.id, recordLabel: `${name} ${body.festival_date} (shop closure)`,
  })
  return NextResponse.json(data, { status: 201 })
}

// Toggle is_business_holiday on an existing festival row. Deliberately the ONLY
// field this route writes: the name/date/is_major of a festival belong to the
// Marketing tab, and this route must not become a second editor for them.
export async function PATCH(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  if (!body.id || typeof body.is_business_holiday !== 'boolean') {
    return NextResponse.json(
      { error: 'id and is_business_holiday (boolean) are required.' },
      { status: 400 },
    )
  }

  const { data, error } = await supabaseAdmin
    .from('festival_calendar')
    .update({ is_business_holiday: body.is_business_holiday })
    .eq('id', body.id)
    .select('id, name, festival_date, is_business_holiday')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Calendar entry not found.' }, { status: 404 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'attendance', tableName: 'festival_calendar',
    recordId: data.id,
    recordLabel: `${data.name} ${data.festival_date} shop closure ${body.is_business_holiday ? 'on' : 'off'}`,
  })
  return NextResponse.json({ success: true, holiday: data })
}

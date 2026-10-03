import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

const SELECT = `
  id, name, start_time, end_time, crosses_midnight, grace_minutes,
  half_day_min_minutes, full_day_min_minutes, weekly_off_days, is_active, created_at
`

// Session-only read: the punch widget shows the staff member their own shift
// times ("shift 09:30-18:30"), which needs no page grant.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('staff_shifts').select(SELECT).order('name', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required.' }, { status: 400 })
  if (!body.start_time || !body.end_time) {
    return NextResponse.json({ error: 'start_time and end_time are required.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('staff_shifts')
    .insert({
      name,
      start_time: body.start_time,
      end_time: body.end_time,
      crosses_midnight: body.crosses_midnight ?? false,
      grace_minutes: body.grace_minutes ?? 10,
      half_day_min_minutes: body.half_day_min_minutes ?? 240,
      full_day_min_minutes: body.full_day_min_minutes ?? 450,
      weekly_off_days: body.weekly_off_days ?? [7],
      is_active: body.is_active ?? true,
    })
    .select(SELECT)
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A shift with that name already exists.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create', module: 'attendance', tableName: 'staff_shifts',
    recordId: data.id, recordLabel: name,
  })
  return NextResponse.json(data, { status: 201 })
}

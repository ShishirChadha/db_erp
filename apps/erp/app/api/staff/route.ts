import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, isOwner } from '@/lib/auth/session'
import { parsePagination } from '@/lib/pagination'
import { withRetry } from '@/lib/db-retry'
import { logAuditEvent } from '@/lib/audit-log'
import { resolveVisibleStaffIds } from '@/lib/attendance-server'

// The profiles embed is disambiguated by FK name because `staff` has TWO
// foreign keys to profiles (profile_id and created_by) -- a bare
// profiles(...) embed is ambiguous and PostgREST rejects the whole query
// with a 500. Note PostgREST select strings cannot carry SQL comments.
const SELECT = `
  id, full_name, employee_code, profile_id, join_date, default_shift_id,
  weekly_off_days, phone, is_active, notes, legacy_staff_name, created_at,
  staff_shifts ( id, name, start_time, end_time, weekly_off_days ),
  profiles!staff_profile_id_fkey ( id, full_name, username, employee_id )
`

// The roster. A non-manager sees only their own row (the own-only clamp), which
// is what lets the punch widget and "my attendance" work without exposing
// colleagues.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'attendance')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const { staffIds } = await resolveVisibleStaffIds(sessionUser, searchParams.get('staff_id'))
  const pagination = parsePagination(searchParams)

  if (staffIds !== 'all' && staffIds.length === 0) {
    return pagination ? NextResponse.json({ data: [], total: 0 }) : NextResponse.json([])
  }

  let query = supabaseAdmin
    .from('staff')
    .select(SELECT, pagination ? { count: 'exact' } : undefined)
    .eq('is_deleted', false)

  if (staffIds !== 'all') query = query.in('id', staffIds)
  if (searchParams.get('active') === 'true') query = query.eq('is_active', true)

  const search = searchParams.get('search')
  if (search) query = query.ilike('full_name', `%${search}%`)

  query = query.order('full_name', { ascending: true })
  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data, error, count } = await withRetry(() => query)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (pagination) return NextResponse.json({ data: data || [], total: count ?? 0 })
  return NextResponse.json(data || [])
}

// Owner-only: adding someone to the roster is an administrative act, like
// creating a login. Note this deliberately does NOT write into
// custom_options.staff_names -- `staff` is additive and that list keeps its own
// free-text values (see docs/decisions.md).
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
  if (!fullName) return NextResponse.json({ error: 'full_name is required.' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('staff')
    .insert({
      full_name: fullName,
      employee_code: body.employee_code?.trim() || null,
      profile_id: body.profile_id || null,
      join_date: body.join_date || null,
      default_shift_id: body.default_shift_id || null,
      weekly_off_days: body.weekly_off_days ?? null,
      phone: body.phone?.trim() || null,
      legacy_staff_name: body.legacy_staff_name?.trim() || null,
      notes: body.notes?.trim() || null,
      is_active: body.is_active ?? true,
      created_by: sessionUser.id,
    })
    .select(SELECT)
    .single()

  if (error) {
    // staff_profile_id_key / staff_employee_code_key -- surfaced as readable
    // text rather than a raw constraint violation.
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'That login or employee code is already used by another staff member.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'attendance',
    tableName: 'staff',
    recordId: data.id,
    recordLabel: fullName,
  })

  return NextResponse.json(data, { status: 201 })
}

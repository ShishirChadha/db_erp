import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, isManagerOrAbove, canEditPage } from '@/lib/auth/session'
import { parsePagination } from '@/lib/pagination'
import { withRetry } from '@/lib/db-retry'
import { resolveVisibleStaffIds, istToday, ATTENDANCE_STATUSES } from '@/lib/attendance-server'
import { logAuditEvent } from '@/lib/audit-log'

// Sort allowlist. work_date is the default and descending, per the house rule
// that every list view's date column comes first and default-sorts newest-first.
const SORT_COLUMNS: Record<string, string> = {
  work_date: 'work_date',
  status: 'status',
  first_in_at: 'first_in_at',
  last_out_at: 'last_out_at',
  worked_minutes: 'worked_minutes',
  late_minutes: 'late_minutes',
}

const SELECT = `
  id, staff_id, work_date, shift_id, first_in_at, last_out_at, worked_minutes,
  punch_pair_count, late_minutes, is_late, early_exit_minutes, overtime_minutes,
  status, status_source, day_part, leave_request_id, note, override_reason,
  overridden_by, overridden_at, missing_out_notified_at, created_at, updated_at,
  staff ( id, full_name, employee_code )
`

// No cost_price / vendor_id / margin field exists anywhere in this module, so
// there is nothing to redact -- the "never .select() sensitive columns in the
// first place" preference rather than fetch-then-strip.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'attendance')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)

  // The own-only clamp. A non-manager is forced onto their own staff row
  // whatever they asked for; a staff_id naming someone else is IGNORED rather
  // than rejected, so the endpoint cannot be used as an existence oracle.
  const { staffIds } = await resolveVisibleStaffIds(sessionUser, searchParams.get('staff_id'))
  const applyScope = (q: any) => (staffIds === 'all' ? q : q.in('staff_id', staffIds))

  // An employee with no roster row sees an empty list, with the same shape and
  // status code a populated one would have.
  if (staffIds !== 'all' && staffIds.length === 0) {
    if (searchParams.get('counts') === 'true') {
      return NextResponse.json(Object.fromEntries([...ATTENDANCE_STATUSES, 'not_marked', 'late'].map(k => [k, 0])))
    }
    return parsePagination(searchParams)
      ? NextResponse.json({ data: [], total: 0 })
      : NextResponse.json([])
  }

  const date = searchParams.get('date')

  // ---------- stat cards ----------
  if (searchParams.get('counts') === 'true') {
    const day = date || istToday()
    const countOf = async (status: string) => {
      const { count } = await withRetry<any>(() => applyScope(
        supabaseAdmin.from('attendance_days')
          .select('id', { count: 'exact', head: true })
          .eq('work_date', day)
          .eq('status', status)
      ))
      return count || 0
    }
    const lateCount = async () => {
      const { count } = await withRetry<any>(() => applyScope(
        supabaseAdmin.from('attendance_days')
          .select('id', { count: 'exact', head: true })
          .eq('work_date', day)
          .eq('is_late', true)
      ))
      return count || 0
    }
    // "Not marked" is roster-minus-rows, not a status -- the nightly scan only
    // materializes rows after midnight, so today's unpunched staff have no row
    // at all and would otherwise be invisible on the live register.
    const rosterCount = async () => {
      const { count } = await withRetry<any>(() => applyScope(
        supabaseAdmin.from('staff')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true).eq('is_deleted', false)
      ))
      return count || 0
    }
    const markedCount = async () => {
      const { count } = await withRetry<any>(() => applyScope(
        supabaseAdmin.from('attendance_days')
          .select('id', { count: 'exact', head: true }).eq('work_date', day)
      ))
      return count || 0
    }

    const [statuses, late, roster, marked] = await Promise.all([
      Promise.all(ATTENDANCE_STATUSES.map(s => countOf(s))),
      lateCount(), rosterCount(), markedCount(),
    ])

    const out: Record<string, number> = {}
    ATTENDANCE_STATUSES.forEach((s, i) => { out[s] = statuses[i] })
    out.late = late
    out.not_marked = Math.max(0, roster - marked)
    return NextResponse.json(out)
  }

  // ---------- the day register ----------
  // Left-joins the roster rather than listing attendance_days, so a staff
  // member with no row yet shows as "Not marked" instead of vanishing.
  if (date) {
    const { data: roster } = await withRetry(() => applyScope(
      supabaseAdmin.from('staff')
        .select('id, full_name, employee_code, default_shift_id, weekly_off_days, staff_shifts ( id, name, start_time, end_time, weekly_off_days )')
        .eq('is_active', true).eq('is_deleted', false)
        .order('full_name', { ascending: true })
    ))

    const { data: days } = await withRetry(() => applyScope(
      supabaseAdmin.from('attendance_days').select(SELECT).eq('work_date', date)
    ))

    const byStaff = new Map((days || []).map((d: any) => [d.staff_id, d]))
    const rows = (roster || []).map((s: any) => ({
      staff: { id: s.id, full_name: s.full_name, employee_code: s.employee_code },
      shift: s.staff_shifts ?? null,
      weekly_off_days: s.weekly_off_days ?? s.staff_shifts?.weekly_off_days ?? [7],
      day: byStaff.get(s.id) ?? null,
    }))
    return NextResponse.json({ date, rows })
  }

  // ---------- plain range list ----------
  const sortKey = searchParams.get('sort') || 'work_date'
  const asc = searchParams.get('order') === 'asc'
  const pagination = parsePagination(searchParams)

  let query = applyScope(
    supabaseAdmin.from('attendance_days').select(SELECT, pagination ? { count: 'exact' } : undefined)
  )

  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const status = searchParams.get('status')
  if (from) query = query.gte('work_date', from)
  if (to) query = query.lte('work_date', to)
  if (status) query = query.eq('status', status)

  query = query
    .order(SORT_COLUMNS[sortKey] || 'work_date', { ascending: asc, nullsFirst: false })
    // Deterministic tiebreak: work_date is not unique per row.
    .order('staff_id', { ascending: true })

  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data, error, count } = await withRetry(() => query)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Omitting `page` keeps the old unbounded-array response, so non-paginated
  // callers never break (see parsePagination's contract).
  if (pagination) return NextResponse.json({ data: data || [], total: count ?? 0 })
  return NextResponse.json(data || [])
}

// Create an attendance_days row with a manual status override for a day that
// has no record yet (e.g. marking someone on leave when they never punched in
// and the nightly scan hasn't run yet). The PATCH handler on /[id] handles the
// case where the row already exists.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManagerOrAbove(sessionUser) || !canEditPage(sessionUser, 'attendance')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { staff_id, work_date, status, reason } = body
  if (!staff_id || !work_date || !status || !reason?.trim()) {
    return NextResponse.json({ error: 'staff_id, work_date, status, and reason are required.' }, { status: 400 })
  }
  if (!ATTENDANCE_STATUSES.includes(status)) {
    return NextResponse.json({ error: `status must be one of: ${ATTENDANCE_STATUSES.join(', ')}` }, { status: 400 })
  }

  // Guard against racing with the nightly scan or another tab.
  const { data: existing } = await supabaseAdmin
    .from('attendance_days')
    .select('id')
    .eq('staff_id', staff_id)
    .eq('work_date', work_date)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ error: 'A record already exists for this day — use the edit path.', existing_id: existing.id }, { status: 409 })
  }

  const { data: staffRow } = await supabaseAdmin
    .from('staff').select('full_name').eq('id', staff_id).maybeSingle()
  const staffName = (staffRow as any)?.full_name ?? 'staff'

  const { data: day, error } = await supabaseAdmin
    .from('attendance_days')
    .insert({
      staff_id,
      work_date,
      status,
      status_source: 'manual',
      override_reason: reason.trim(),
      overridden_by: sessionUser.id,
      overridden_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'attendance',
    tableName: 'attendance_days',
    recordId: day.id,
    recordLabel: `${staffName} ${work_date} created as ${status}`,
    reason: reason.trim(),
    metadata: { status, status_source: 'manual' },
  })

  return NextResponse.json({ success: true, day })
}

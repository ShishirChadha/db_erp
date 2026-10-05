import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, canEditPage, isManagerOrAbove } from '@/lib/auth/session'
import { parsePagination } from '@/lib/pagination'
import { withRetry } from '@/lib/db-retry'
import { logAuditEvent } from '@/lib/audit-log'
import { LEAD_SET_SOURCE_TYPES, DEFAULT_LEAD_STATUS, findDuplicatePhones } from '@/lib/leads'

const SELECT = `
  id, name, description, source_type, status, current_assignee_id, cloned_from_set_id,
  created_by, created_at, updated_at,
  current_assignee:profiles!lead_sets_current_assignee_id_fkey ( id, full_name )
`

// ---------- GET: list Sets ----------
// Owner/manager: every Set, optionally filtered by assignee/status. Employee:
// forced to their own current_assignee_id regardless of any query param --
// this is the API-layer half of the "own Set only" boundary (RLS is the other
// half, see backups/20261006_lead_sets.sql).
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'leads')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const pagination = parsePagination(searchParams)
  const statusFilter = searchParams.get('status')
  const assigneeFilter = searchParams.get('assignee_id')

  let query = supabaseAdmin
    .from('lead_sets')
    .select(SELECT, pagination ? { count: 'exact' } : undefined)
    .eq('is_deleted', false)

  if (isManagerOrAbove(sessionUser)) {
    if (assigneeFilter) query = query.eq('current_assignee_id', assigneeFilter)
  } else {
    query = query.eq('current_assignee_id', sessionUser.id)
  }
  if (statusFilter) query = query.in('status', statusFilter.split(','))

  // Date column first / descending default, per the app-wide list rule.
  query = query.order('created_at', { ascending: false })
  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data, error, count } = await withRetry(() => query)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Live counts per Set (never stored), same posture as rentals' overdue count.
  const setIds = (data || []).map((s: any) => s.id)
  const countsBySet = new Map<string, { total: number; worked: number; converted: number }>()
  if (setIds.length > 0) {
    const { data: leadRows } = await supabaseAdmin
      .from('leads')
      .select('set_id, status, activity_id')
      .eq('is_deleted', false)
      .in('set_id', setIds)
    for (const row of leadRows || []) {
      const c = countsBySet.get((row as any).set_id) || { total: 0, worked: 0, converted: 0 }
      c.total += 1
      if ((row as any).activity_id) c.worked += 1
      if ((row as any).status === 'Converted') c.converted += 1
      countsBySet.set((row as any).set_id, c)
    }
  }

  const rows = (data || []).map((s: any) => ({
    ...s,
    assignee_name: s.current_assignee?.full_name || null,
    counts: countsBySet.get(s.id) || { total: 0, worked: 0, converted: 0 },
  }))

  if (pagination) return NextResponse.json({ data: rows, total: count || 0 })
  return NextResponse.json(rows)
}

// ---------- POST: create a Set, from parsed CSV rows or a manual list ----------
// Any staff with canEditPage('leads') can self-serve import their own list --
// immediately real, auto-assigned to themselves, no owner approval gate,
// matching the "stock-in is immediately real" convention used elsewhere.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPage(sessionUser, 'leads')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })

  const { name, description, source_type, rows } = body
  if (!name || !String(name).trim()) return NextResponse.json({ error: 'Set name is required.' }, { status: 400 })
  const sourceType = source_type && LEAD_SET_SOURCE_TYPES.includes(source_type) ? source_type : 'upload'
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'At least one contact row is required.' }, { status: 400 })
  }

  const cleanRows = rows
    .map((r: any) => ({
      name: String(r.name || '').trim(),
      phone: r.phone ? String(r.phone).trim() : null,
      email: r.email ? String(r.email).trim() : null,
      address: r.address ? String(r.address).trim() : null,
      external_identifier: r.external_identifier ? String(r.external_identifier).trim() : null,
    }))
    .filter((r: any) => r.name)

  if (cleanRows.length === 0) return NextResponse.json({ error: 'No valid rows (a name is required on every row).' }, { status: 400 })

  const { data: set, error: setErr } = await supabaseAdmin
    .from('lead_sets')
    .insert({
      name: String(name).trim(),
      description: description ? String(description).trim() : null,
      source_type: sourceType,
      current_assignee_id: sessionUser.id,
      created_by: sessionUser.id,
    })
    .select('id, name')
    .single()
  if (setErr || !set) return NextResponse.json({ error: setErr?.message || 'Failed to create set.' }, { status: 500 })

  const { error: leadsErr } = await supabaseAdmin.from('leads').insert(
    cleanRows.map((r: any) => ({ ...r, set_id: set.id, status: DEFAULT_LEAD_STATUS, created_by: sessionUser.id }))
  )
  if (leadsErr) {
    await supabaseAdmin.from('lead_sets').delete().eq('id', set.id)
    return NextResponse.json({ error: leadsErr.message }, { status: 500 })
  }

  await supabaseAdmin.from('lead_set_assignment_history').insert({
    set_id: set.id, assignee_id: sessionUser.id, assigned_by: sessionUser.id,
  })

  const duplicates = await findDuplicatePhones(cleanRows.map((r: any) => r.phone).filter(Boolean))
  const duplicateWarnings = cleanRows
    .filter((r: any) => r.phone && duplicates.has(r.phone))
    .map((r: any) => ({ phone: r.phone, name: r.name, existing_in: duplicates.get(r.phone) }))

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'leads',
    tableName: 'lead_sets',
    recordId: set.id,
    recordLabel: set.name,
    metadata: { row_count: cleanRows.length, source_type: sourceType },
  })

  return NextResponse.json(
    { success: true, id: set.id, name: set.name, row_count: cleanRows.length, duplicate_warnings: duplicateWarnings },
    { status: 201 }
  )
}

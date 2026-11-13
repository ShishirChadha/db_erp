import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, isManagerOrAbove } from '@/lib/auth/session'
import { parsePagination } from '@/lib/pagination'
import { withRetry } from '@/lib/db-retry'
import { logAuditEvent } from '@/lib/audit-log'
import { notify } from '@/lib/notifications'
import { LEAD_SET_SOURCE_TYPES, DEFAULT_LEAD_STATUS, LEAD_FIELD_LABEL_KEYS, findDuplicatePhones, isLeadWorked } from '@/lib/leads'

const SELECT = `
  id, name, description, source_type, status, current_assignee_id, cloned_from_set_id, working_copy_of_set_id, field_labels,
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
      if (isLeadWorked(row as any)) c.worked += 1
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

// ---------- POST: create a Set, from parsed CSV rows, a manual list, or empty ----------
// Any staff with view access to 'leads' can self-serve import their own list
// -- immediately real, auto-assigned to themselves, no owner approval gate,
// matching the "stock-in is immediately real" convention used elsewhere.
// Gated on view access only, not the edit grant: importing becomes your own
// Set, which you then hold and can already edit/add on by virtue of holding
// it (see isCurrentHolderOrManager) -- the separate edit grant no longer
// does anything in this module (see roles-permissions bible chapter).
//
// `rows` may be empty/omitted -- an admin handing a brand-new, empty Set to a
// staff member to fill in themselves (no CSV exists yet) is a real case, not
// just the CSV-import one. `assignee_id` lets a manager/owner create it
// already assigned to someone else, instead of always self-assigning and
// needing a separate Reassign step after. `field_labels` lets the creator
// relabel Phone/Email/Address/Identifier for what this particular list
// actually needs (e.g. "Flat No." for a society list) -- missing/omitted
// keys fall back to the defaults, which is what "use default" means here.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'leads')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })

  const { name, description, source_type, rows, assignee_id, field_labels } = body
  if (!name || !String(name).trim()) return NextResponse.json({ error: 'Set name is required.' }, { status: 400 })
  const sourceType = source_type && LEAD_SET_SOURCE_TYPES.includes(source_type) ? source_type : 'upload'
  if (rows !== undefined && !Array.isArray(rows)) {
    return NextResponse.json({ error: 'rows must be an array (or omitted for an empty Set).' }, { status: 400 })
  }

  const cleanRows = (rows || [])
    .map((r: any) => ({
      name: String(r.name || '').trim(),
      phone: r.phone ? String(r.phone).trim() : null,
      email: r.email ? String(r.email).trim() : null,
      address: r.address ? String(r.address).trim() : null,
      external_identifier: r.external_identifier ? String(r.external_identifier).trim() : null,
    }))
    .filter((r: any) => r.name)

  if (Array.isArray(rows) && rows.length > 0 && cleanRows.length === 0) {
    return NextResponse.json({ error: 'No valid rows (a name is required on every row).' }, { status: 400 })
  }

  // Only a manager/owner may hand the new Set to someone else -- a plain
  // employee self-serving their own import always lands on themselves, same
  // as before.
  let assigneeId = sessionUser.id
  if (assignee_id && assignee_id !== sessionUser.id) {
    if (!isManagerOrAbove(sessionUser)) return NextResponse.json({ error: 'Only a manager or owner can assign a new Set to someone else.' }, { status: 403 })
    const { data: assignee } = await supabaseAdmin.from('profiles').select('id, is_active').eq('id', assignee_id).maybeSingle()
    if (!assignee || !assignee.is_active) return NextResponse.json({ error: 'The chosen staff member is not a valid active user.' }, { status: 400 })
    assigneeId = assignee_id
  }

  let cleanFieldLabels: Record<string, string> | null = null
  if (field_labels && typeof field_labels === 'object') {
    const picked: Record<string, string> = {}
    for (const key of LEAD_FIELD_LABEL_KEYS) {
      const v = field_labels[key]
      if (v && String(v).trim()) picked[key] = String(v).trim().slice(0, 40)
    }
    if (Object.keys(picked).length > 0) cleanFieldLabels = picked
  }

  const { data: set, error: setErr } = await supabaseAdmin
    .from('lead_sets')
    .insert({
      name: String(name).trim(),
      description: description ? String(description).trim() : null,
      source_type: sourceType,
      current_assignee_id: assigneeId,
      field_labels: cleanFieldLabels,
      created_by: sessionUser.id,
    })
    .select('id, name')
    .single()
  if (setErr || !set) return NextResponse.json({ error: setErr?.message || 'Failed to create set.' }, { status: 500 })

  if (cleanRows.length > 0) {
    const { error: leadsErr } = await supabaseAdmin.from('leads').insert(
      cleanRows.map((r: any) => ({ ...r, set_id: set.id, status: DEFAULT_LEAD_STATUS, created_by: sessionUser.id }))
    )
    if (leadsErr) {
      await supabaseAdmin.from('lead_sets').delete().eq('id', set.id)
      return NextResponse.json({ error: leadsErr.message }, { status: 500 })
    }
  }

  await supabaseAdmin.from('lead_set_assignment_history').insert({
    set_id: set.id, assignee_id: assigneeId, assigned_by: sessionUser.id,
  })

  if (assigneeId !== sessionUser.id) {
    await notify({
      recipientId: assigneeId, type: 'task_assigned', actorId: sessionUser.id,
      title: `New Lead Set "${set.name}" assigned to you`, link: `/dashboard/leads?set=${set.id}`,
    })
  }

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
    metadata: { row_count: cleanRows.length, source_type: sourceType, assignee_id: assigneeId },
  })

  return NextResponse.json(
    { success: true, id: set.id, name: set.name, row_count: cleanRows.length, duplicate_warnings: duplicateWarnings },
    { status: 201 }
  )
}

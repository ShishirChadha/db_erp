import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { parsePagination } from '@/lib/pagination'
import { withRetry } from '@/lib/db-retry'
import { getLeadSetOrNull, isCurrentHolderOrManager } from '@/lib/leads'

const SELECT = `
  id, set_id, name, phone, email, address, external_identifier, status,
  converted_customer_id, converted_at, activity_id, created_at, updated_at
`

const FOLLOWUP_FILTERS = ['overdue', 'due_today', 'upcoming', 'any', 'none'] as const

// ---------- GET: list leads within a Set, paginated ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'leads')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const setId = searchParams.get('set_id')
  if (!setId) return NextResponse.json({ error: 'set_id is required.' }, { status: 400 })

  const set = await getLeadSetOrNull(setId)
  if (!set) return NextResponse.json({ error: 'Set not found.' }, { status: 404 })
  if (!isCurrentHolderOrManager(sessionUser, set)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const pagination = parsePagination(searchParams)
  const search = searchParams.get('search')?.trim()
  const statusFilter = searchParams.get('status')
  const followupFilter = searchParams.get('followup')

  let query = supabaseAdmin
    .from('leads')
    .select(SELECT, pagination ? { count: 'exact' } : undefined)
    .eq('set_id', setId)
    .eq('is_deleted', false)

  if (statusFilter) query = query.in('status', statusFilter.split(','))
  if (search) query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%,external_identifier.ilike.%${search}%`)

  // Follow-up filters key off activities.due_date via leads.activity_id --
  // resolved as a separate lookup rather than a PostgREST embedded-resource
  // filter, so this stays a plain, predictable two-step query (same pattern
  // rentals' own customer-name search uses) instead of relying on inner-join
  // filter syntax on an embed.
  if (followupFilter && FOLLOWUP_FILTERS.includes(followupFilter as any)) {
    const today = new Date().toISOString().slice(0, 10)
    let activityQuery = supabaseAdmin.from('activities').select('id').eq('related_type', 'lead').eq('is_deleted', false)
    if (followupFilter === 'overdue') activityQuery = activityQuery.lt('due_date', today)
    else if (followupFilter === 'due_today') activityQuery = activityQuery.eq('due_date', today)
    else if (followupFilter === 'upcoming') activityQuery = activityQuery.gt('due_date', today)
    else if (followupFilter === 'any') activityQuery = activityQuery.not('due_date', 'is', null)
    else if (followupFilter === 'none') activityQuery = activityQuery.is('due_date', null)

    const { data: matchingActivities } = await activityQuery
    const activityIds = (matchingActivities || []).map((a) => a.id)

    if (followupFilter === 'none') {
      // "No follow-up set" also includes leads with no activity row at all,
      // not just leads whose activity has a null due_date.
      query = activityIds.length > 0 ? query.or(`activity_id.is.null,activity_id.in.(${activityIds.join(',')})`) : query.is('activity_id', null)
    } else {
      if (activityIds.length === 0) {
        if (pagination) return NextResponse.json({ data: [], total: 0 })
        return NextResponse.json([])
      }
      query = query.in('activity_id', activityIds)
    }
  }

  // Date column first / descending default, per the app-wide list rule.
  query = query.order('created_at', { ascending: false })
  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data, error, count } = await withRetry(() => query)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const rows = data || []
  const activityIds = rows.map((r: any) => r.activity_id).filter(Boolean)
  const dueDateMap = new Map<string, string | null>()
  const lastNoteMap = new Map<string, { body: string; created_at: string }>()

  if (activityIds.length > 0) {
    const [{ data: activityRows }, { data: commentRows }] = await Promise.all([
      supabaseAdmin.from('activities').select('id, due_date').in('id', activityIds),
      supabaseAdmin
        .from('activity_comments').select('activity_id, body, created_at')
        .in('activity_id', activityIds).eq('is_deleted', false)
        .order('created_at', { ascending: false }),
    ])
    for (const a of activityRows || []) dueDateMap.set((a as any).id, (a as any).due_date)
    // First row per activity_id wins, since comments are already ordered newest-first.
    for (const c of commentRows || []) {
      if (!lastNoteMap.has((c as any).activity_id)) lastNoteMap.set((c as any).activity_id, { body: (c as any).body, created_at: (c as any).created_at })
    }
  }

  const enriched = rows.map((r: any) => ({
    ...r,
    follow_up_date: r.activity_id ? (dueDateMap.get(r.activity_id) ?? null) : null,
    last_note: r.activity_id ? (lastNoteMap.get(r.activity_id)?.body ?? null) : null,
    last_note_at: r.activity_id ? (lastNoteMap.get(r.activity_id)?.created_at ?? null) : null,
  }))

  if (pagination) return NextResponse.json({ data: enriched, total: count || 0 })
  return NextResponse.json(enriched)
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { parsePagination } from '@/lib/pagination'
import { isFieldHiddenForRole } from '@/lib/auth/redact'

// Owner sees every user's audit trail; everyone else is hard-forced to their own
// rows regardless of any actor_id they pass -- never let a non-owner override this.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const module = searchParams.get('module')
  const actionType = searchParams.get('action_type')
  const tableName = searchParams.get('table_name')
  const dateFrom = searchParams.get('date_from')
  const dateTo = searchParams.get('date_to')
  const actorId = searchParams.get('actor_id')

  const pagination = parsePagination(searchParams)

  let query = supabaseAdmin
    .from('audit_log')
    .select(
      'id, actor_id, actor_email, actor_role, action_type, severity, module, table_name, record_id, record_label, field_correction_ids, snapshot, restore_status, restored_at, restored_by, reason, metadata, created_at',
      pagination ? { count: 'exact' } : undefined
    )
    .order('created_at', { ascending: false })

  if (isOwner(sessionUser)) {
    if (actorId) query = query.eq('actor_id', actorId)
  } else {
    query = query.eq('actor_id', sessionUser.id)
  }

  if (module) query = query.eq('module', module)
  if (actionType) query = query.eq('action_type', actionType)
  if (tableName) query = query.eq('table_name', tableName)
  if (dateFrom) query = query.gte('created_at', dateFrom)
  if (dateTo) query = query.lte('created_at', dateTo)
  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const rows = data || []

  // Hydrate field-diff detail for update-type rows. A hidden field (per
  // redaction_rules, shape='audit_log') is dropped entirely, not masked --
  // e.g. an employee never sees a cost_price diff line at all.
  const allCorrectionIds = rows.flatMap((r) => r.field_correction_ids || [])
  let correctionsById: Record<string, any> = {}
  if (allCorrectionIds.length > 0) {
    const { data: corrections } = await supabaseAdmin
      .from('field_corrections')
      .select('id, field_name, old_value, new_value, reason, changed_at')
      .in('id', allCorrectionIds)
    const visible: any[] = []
    for (const c of corrections || []) {
      const hidden = await isFieldHiddenForRole('audit_log', c.field_name, sessionUser.role)
      if (!hidden) visible.push(c)
    }
    correctionsById = Object.fromEntries(visible.map((c: any) => [c.id, c]))
  }

  const enriched = rows.map((r) => ({
    ...r,
    field_corrections: (r.field_correction_ids || [])
      .map((id: string) => correctionsById[id])
      .filter(Boolean),
  }))

  if (pagination) return NextResponse.json({ data: enriched, total: count ?? 0 })
  return NextResponse.json(enriched)
}

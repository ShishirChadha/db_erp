import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, canEditPage } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { LEAD_SET_STATUSES, getLeadSetOrNull, isCurrentHolderOrManager } from '@/lib/leads'

// ---------- GET: Set detail + live status counts + assignment history ----------
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'leads')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const set = await getLeadSetOrNull(id)
  if (!set) return NextResponse.json({ error: 'Set not found.' }, { status: 404 })
  if (!isCurrentHolderOrManager(sessionUser, set)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data: fullSet } = await supabaseAdmin
    .from('lead_sets')
    .select(`
      id, name, description, source_type, status, current_assignee_id, cloned_from_set_id,
      created_by, created_at, updated_at,
      current_assignee:profiles!lead_sets_current_assignee_id_fkey ( id, full_name )
    `)
    .eq('id', id)
    .single()

  const { data: leadRows } = await supabaseAdmin.from('leads').select('status, activity_id').eq('set_id', id).eq('is_deleted', false)
  const counts: Record<string, number> = {}
  let worked = 0
  for (const row of leadRows || []) {
    counts[(row as any).status] = (counts[(row as any).status] || 0) + 1
    if ((row as any).activity_id) worked += 1
  }

  const { data: history } = await supabaseAdmin
    .from('lead_set_assignment_history')
    .select(`
      id, assigned_at, unassigned_at, note,
      assignee:profiles!lead_set_assignment_history_assignee_id_fkey ( full_name ),
      assigned_by_profile:profiles!lead_set_assignment_history_assigned_by_fkey ( full_name )
    `)
    .eq('set_id', id)
    .order('assigned_at', { ascending: false })

  return NextResponse.json({
    ...fullSet,
    assignee_name: (fullSet as any)?.current_assignee?.full_name || null,
    counts: { total: (leadRows || []).length, worked, by_status: counts },
    history: (history || []).map((h: any) => ({
      id: h.id, assigned_at: h.assigned_at, unassigned_at: h.unassigned_at, note: h.note,
      assignee_name: h.assignee?.full_name || 'Unknown', assigned_by_name: h.assigned_by_profile?.full_name || 'Unknown',
    })),
  })
}

// ---------- PATCH: edit name/description/status ----------
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPage(sessionUser, 'leads')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const set = await getLeadSetOrNull(id)
  if (!set) return NextResponse.json({ error: 'Set not found.' }, { status: 404 })
  if (!isCurrentHolderOrManager(sessionUser, set)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })

  const updates: Record<string, any> = { updated_at: new Date().toISOString() }
  if (body.name !== undefined) {
    if (!String(body.name).trim()) return NextResponse.json({ error: 'Name cannot be empty.' }, { status: 400 })
    updates.name = String(body.name).trim()
  }
  if (body.description !== undefined) updates.description = body.description ? String(body.description).trim() : null
  if (body.status !== undefined) {
    if (!LEAD_SET_STATUSES.includes(body.status)) return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
    updates.status = body.status
  }

  const { error } = await supabaseAdmin.from('lead_sets').update(updates).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'leads', tableName: 'lead_sets', recordId: id, recordLabel: set.name,
  })

  return NextResponse.json({ success: true })
}

// ---------- DELETE: soft-delete a whole Set and its leads ----------
// A mistaken import (wrong columns mapped, wrong file) is the main real-world
// case -- same posture as the single-lead soft-delete, just scoped to every
// lead in the Set rather than one row. Same authorization as PATCH: the
// current holder may clean up their own Set, manager/owner may clean up any.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPage(sessionUser, 'leads')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const set = await getLeadSetOrNull(id)
  if (!set) return NextResponse.json({ error: 'Set not found.' }, { status: 404 })
  if (!isCurrentHolderOrManager(sessionUser, set)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const now = new Date().toISOString()
  const { error: leadsErr } = await supabaseAdmin.from('leads').update({ is_deleted: true, updated_at: now }).eq('set_id', id)
  if (leadsErr) return NextResponse.json({ error: leadsErr.message }, { status: 500 })

  const { error: setErr } = await supabaseAdmin.from('lead_sets').update({ is_deleted: true, updated_at: now }).eq('id', id)
  if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'soft_delete', module: 'leads', tableName: 'lead_sets', recordId: id, recordLabel: set.name,
  })

  return NextResponse.json({ success: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { notify } from '@/lib/notifications'
import { DEFAULT_LEAD_STATUS, getLeadSetOrNull } from '@/lib/leads'

// ---------- POST: fresh-copy clone ----------
// New Set, new leads rows copying only contact fields -- status reset,
// activity_id null, converted_customer_id null -- so the new holder sees
// what feels like a brand-new list, no history, by construction (same
// mechanism as any never-worked lead, not a special hide-rule). The
// original Set/leads/history stay fully intact and owner-visible.
//
// Owner-only: cloning starts a fresh campaign off an existing list, a more
// consequential decision than reassign (which keeps one Set's continuity).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const assigneeId = body?.assignee_id
  if (!assigneeId) return NextResponse.json({ error: 'assignee_id is required.' }, { status: 400 })

  const sourceSet = await getLeadSetOrNull(id)
  if (!sourceSet) return NextResponse.json({ error: 'Set not found.' }, { status: 404 })

  const { data: assignee } = await supabaseAdmin
    .from('profiles').select('id, is_active').eq('id', assigneeId).maybeSingle()
  if (!assignee || !assignee.is_active) {
    return NextResponse.json({ error: 'The chosen staff member is not a valid active user.' }, { status: 400 })
  }

  const newName = body?.name ? String(body.name).trim() : `${sourceSet.name} (fresh copy)`

  const { data: sourceLeads, error: leadsFetchErr } = await supabaseAdmin
    .from('leads').select('name, phone, email, address, external_identifier')
    .eq('set_id', id).eq('is_deleted', false)
  if (leadsFetchErr) return NextResponse.json({ error: leadsFetchErr.message }, { status: 500 })
  if (!sourceLeads || sourceLeads.length === 0) {
    return NextResponse.json({ error: 'This set has no leads to clone.' }, { status: 400 })
  }

  const { data: newSet, error: newSetErr } = await supabaseAdmin
    .from('lead_sets')
    .insert({
      name: newName,
      description: sourceSet.name !== newName ? `Fresh copy of "${sourceSet.name}"` : null,
      source_type: 'manual',
      cloned_from_set_id: id,
      current_assignee_id: assigneeId,
      created_by: sessionUser.id,
    })
    .select('id, name')
    .single()
  if (newSetErr || !newSet) return NextResponse.json({ error: newSetErr?.message || 'Failed to create the clone.' }, { status: 500 })

  const { error: insertErr } = await supabaseAdmin.from('leads').insert(
    sourceLeads.map((l: any) => ({
      set_id: newSet.id,
      name: l.name, phone: l.phone, email: l.email, address: l.address, external_identifier: l.external_identifier,
      status: DEFAULT_LEAD_STATUS,
      created_by: sessionUser.id,
    }))
  )
  if (insertErr) {
    await supabaseAdmin.from('lead_sets').delete().eq('id', newSet.id)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  await supabaseAdmin.from('lead_set_assignment_history').insert({
    set_id: newSet.id, assignee_id: assigneeId, assigned_by: sessionUser.id,
  })

  await notify({
    recipientId: assigneeId, type: 'task_assigned', actorId: sessionUser.id,
    title: `New Lead Set "${newSet.name}" assigned to you`, link: `/dashboard/leads?set=${newSet.id}`,
  })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create', module: 'leads', tableName: 'lead_sets', recordId: newSet.id, recordLabel: newSet.name,
    metadata: { action: 'clone', source_set_id: id, assignee_id: assigneeId, row_count: sourceLeads.length },
  })

  return NextResponse.json({ success: true, id: newSet.id, name: newSet.name }, { status: 201 })
}

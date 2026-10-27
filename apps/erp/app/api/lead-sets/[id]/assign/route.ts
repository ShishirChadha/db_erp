import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isManagerOrAbove } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { notify } from '@/lib/notifications'
import { DEFAULT_LEAD_STATUS, getLeadSetOrNull, snapshotLeadContact } from '@/lib/leads'

// ---------- POST: fork a working copy from a master Set ----------
// The master (id) is never touched -- it stays exactly as it is, owner-
// controlled, forever. A brand-new lead_sets row is created
// (working_copy_of_set_id = id) and every one of the master's current,
// non-deleted leads is copied into it with source_lead_id pointing back at
// its master row and source_snapshot capturing the contact fields as they
// stood right now -- that pairing is what later lets merge-preview show only
// the fields an employee actually touched, and what tells a brand-new
// referral (source_lead_id null) apart from an edited existing lead.
//
// Distinct from Clone: Clone (owner-only) makes a permanently disconnected
// fresh copy for a new campaign, by design never merges back. This fork is
// the ordinary "hand this list to someone to work" action and always stays
// mergeable. Also distinct from Reassign, which keeps moving the SAME
// in-progress working copy (with its own history) to a new holder -- this
// action is for handing out the master itself, and can be done more than
// once to more than one person in parallel.
//
// Manager-or-above, same tier as Reassign: deciding who gets a copy of a
// master list is the access-control lever the owner asked for.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManagerOrAbove(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const assigneeId = body?.assignee_id
  if (!assigneeId) return NextResponse.json({ error: 'assignee_id is required.' }, { status: 400 })

  const masterSet = await getLeadSetOrNull(id)
  if (!masterSet) return NextResponse.json({ error: 'Set not found.' }, { status: 404 })

  const { data: masterRow } = await supabaseAdmin.from('lead_sets').select('name, source_type').eq('id', id).single()
  if (!masterRow) return NextResponse.json({ error: 'Set not found.' }, { status: 404 })

  const { data: assignee } = await supabaseAdmin
    .from('profiles').select('id, full_name, is_active').eq('id', assigneeId).maybeSingle()
  if (!assignee || !assignee.is_active) {
    return NextResponse.json({ error: 'The chosen staff member is not a valid active user.' }, { status: 400 })
  }

  const { data: masterLeads, error: leadsFetchErr } = await supabaseAdmin
    .from('leads').select('id, name, phone, email, address, external_identifier')
    .eq('set_id', id).eq('is_deleted', false)
  if (leadsFetchErr) return NextResponse.json({ error: leadsFetchErr.message }, { status: 500 })
  if (!masterLeads || masterLeads.length === 0) {
    return NextResponse.json({ error: 'This set has no leads to assign.' }, { status: 400 })
  }

  const copyName = body?.name ? String(body.name).trim() : `${masterRow.name} — ${assignee.full_name || 'copy'}`

  const { data: workingCopy, error: newSetErr } = await supabaseAdmin
    .from('lead_sets')
    .insert({
      name: copyName,
      description: `Working copy of "${masterRow.name}"`,
      source_type: masterRow.source_type,
      working_copy_of_set_id: id,
      current_assignee_id: assigneeId,
      created_by: sessionUser.id,
    })
    .select('id, name')
    .single()
  if (newSetErr || !workingCopy) return NextResponse.json({ error: newSetErr?.message || 'Failed to create the working copy.' }, { status: 500 })

  const { error: insertErr } = await supabaseAdmin.from('leads').insert(
    masterLeads.map((l: any) => ({
      set_id: workingCopy.id,
      ...snapshotLeadContact(l),
      status: DEFAULT_LEAD_STATUS,
      source_lead_id: l.id,
      source_snapshot: snapshotLeadContact(l),
      merge_status: 'pending',
      created_by: sessionUser.id,
    }))
  )
  if (insertErr) {
    await supabaseAdmin.from('lead_sets').delete().eq('id', workingCopy.id)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  await supabaseAdmin.from('lead_set_assignment_history').insert({
    set_id: workingCopy.id, assignee_id: assigneeId, assigned_by: sessionUser.id,
  })

  await notify({
    recipientId: assigneeId, type: 'task_assigned', actorId: sessionUser.id,
    title: `New Lead Set "${workingCopy.name}" assigned to you`, link: `/dashboard/leads?set=${workingCopy.id}`,
  })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create', module: 'leads', tableName: 'lead_sets', recordId: workingCopy.id, recordLabel: workingCopy.name,
    metadata: { action: 'assign_working_copy', master_set_id: id, assignee_id: assigneeId, row_count: masterLeads.length },
  })

  return NextResponse.json({ success: true, id: workingCopy.id, name: workingCopy.name }, { status: 201 })
}

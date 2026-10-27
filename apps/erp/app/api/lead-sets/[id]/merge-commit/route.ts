import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isManagerOrAbove } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { DEFAULT_LEAD_STATUS, snapshotLeadContact } from '@/lib/leads'

interface Decision { lead_id: string; action: 'apply' | 'skip' | 'merge_into'; target_lead_id?: string }

// ---------- POST: commit owner-approved merge decisions ----------
// Only ever acts on leads belonging to this working copy with
// merge_status='pending' -- a decision naming any other lead_id is silently
// ignored rather than rejecting the whole batch, since the preview the owner
// reviewed could only ever have offered pending rows from this Set.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isManagerOrAbove(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data: workingCopy } = await supabaseAdmin
    .from('lead_sets').select('id, name, working_copy_of_set_id').eq('id', id).eq('is_deleted', false).maybeSingle()
  if (!workingCopy) return NextResponse.json({ error: 'Set not found.' }, { status: 404 })
  if (!workingCopy.working_copy_of_set_id) {
    return NextResponse.json({ error: 'This Set is a master, not a working copy -- nothing to merge back.' }, { status: 400 })
  }
  const masterSetId = workingCopy.working_copy_of_set_id

  const body = await req.json().catch(() => null)
  const decisions = Array.isArray(body?.decisions) ? (body.decisions as Decision[]) : []
  if (decisions.length === 0) return NextResponse.json({ error: 'No decisions provided.' }, { status: 400 })

  const leadIds = decisions.map((d) => d.lead_id)
  const { data: pendingLeads } = await supabaseAdmin
    .from('leads')
    .select('id, name, phone, email, address, external_identifier, source_lead_id')
    .eq('set_id', id).eq('is_deleted', false).eq('merge_status', 'pending').in('id', leadIds)
  const pendingById = new Map((pendingLeads || []).map((l: any) => [l.id, l]))

  let appliedEdits = 0, newLeadsInserted = 0, mergedAsDuplicate = 0, skipped = 0

  for (const decision of decisions) {
    const lead = pendingById.get(decision.lead_id)
    if (!lead) continue // not pending / not in this Set -- ignore

    if (decision.action === 'skip') {
      await supabaseAdmin.from('leads').update({ merge_status: 'skipped' }).eq('id', lead.id)
      skipped += 1
      continue
    }

    const contact = snapshotLeadContact(lead)

    if (lead.source_lead_id) {
      // Existing lead, edited in the working copy -- the employee's current
      // values win and are written onto the master row.
      await supabaseAdmin.from('leads').update({ ...contact, updated_at: new Date().toISOString() }).eq('id', lead.source_lead_id)
      await supabaseAdmin.from('leads').update({ source_snapshot: contact, merge_status: 'merged' }).eq('id', lead.id)
      appliedEdits += 1
    } else if (decision.action === 'merge_into' && decision.target_lead_id) {
      // Treat like customers/merge's pick-one-keep-one: the target lead is
      // kept, only its currently-blank fields are filled in from the
      // referral -- never overwritten where the target already has a value.
      const { data: target } = await supabaseAdmin
        .from('leads').select('name, phone, email, address, external_identifier').eq('id', decision.target_lead_id).maybeSingle()
      if (target) {
        const fill: Record<string, any> = {}
        for (const f of ['name', 'phone', 'email', 'address', 'external_identifier'] as const) {
          if (!target[f] && contact[f]) fill[f] = contact[f]
        }
        if (Object.keys(fill).length > 0) {
          await supabaseAdmin.from('leads').update({ ...fill, updated_at: new Date().toISOString() }).eq('id', decision.target_lead_id)
        }
      }
      await supabaseAdmin.from('leads').update({ source_lead_id: decision.target_lead_id, source_snapshot: contact, merge_status: 'merged' }).eq('id', lead.id)
      mergedAsDuplicate += 1
    } else {
      // Brand-new referral, no duplicate -- lands in the master Set itself.
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from('leads')
        .insert({ ...contact, set_id: masterSetId, status: DEFAULT_LEAD_STATUS, created_by: sessionUser.id })
        .select('id').single()
      if (!insertErr && inserted) {
        await supabaseAdmin.from('leads').update({ source_lead_id: inserted.id, source_snapshot: contact, merge_status: 'merged' }).eq('id', lead.id)
        newLeadsInserted += 1
      }
    }
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'leads', tableName: 'lead_sets', recordId: masterSetId, recordLabel: workingCopy.name,
    metadata: { action: 'merge_commit', working_copy_id: id, applied_edits: appliedEdits, new_leads_inserted: newLeadsInserted, merged_as_duplicate: mergedAsDuplicate, skipped },
  })

  return NextResponse.json({ success: true, applied_edits: appliedEdits, new_leads_inserted: newLeadsInserted, merged_as_duplicate: mergedAsDuplicate, skipped })
}

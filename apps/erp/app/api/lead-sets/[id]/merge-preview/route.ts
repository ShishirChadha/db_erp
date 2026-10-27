import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isManagerOrAbove } from '@/lib/auth/session'
import { LEAD_CONTACT_FIELDS, findLeadMatches, snapshotLeadContact, type LeadContactSnapshot } from '@/lib/leads'

function fieldsDiffer(a: LeadContactSnapshot | null, b: LeadContactSnapshot | null): boolean {
  if (!a || !b) return a !== b
  return LEAD_CONTACT_FIELDS.some((f) => (a[f] || '') !== (b[f] || ''))
}

// ---------- GET: preview what a working copy's merge would do ----------
// Manager-or-above only, matching every other data-quality-sensitive action
// in this module (reassign/assign/clone). Never writes anything -- purely
// computes the diff the owner reviews before committing via merge-commit.
//
// Only leads still merge_status='pending' are considered: a lead whose
// contact fields still match its source_snapshot has nothing to review yet
// (the employee hasn't touched it), so it's silently left out rather than
// padding the review list with hundreds of untouched rows.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { data: pendingLeads, error } = await supabaseAdmin
    .from('leads')
    .select('id, name, phone, email, address, external_identifier, source_lead_id, source_snapshot')
    .eq('set_id', id).eq('is_deleted', false).eq('merge_status', 'pending')
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const rows = pendingLeads || []
  const existingLeadIds = rows.filter((r: any) => r.source_lead_id).map((r: any) => r.source_lead_id)
  const masterByIdMap = new Map<string, LeadContactSnapshot>()
  if (existingLeadIds.length > 0) {
    const { data: masterRows } = await supabaseAdmin
      .from('leads').select('id, name, phone, email, address, external_identifier')
      .in('id', existingLeadIds)
    for (const m of masterRows || []) masterByIdMap.set((m as any).id, snapshotLeadContact(m))
  }

  const edits: any[] = []
  const newLeads: any[] = []

  for (const row of rows) {
    const working = snapshotLeadContact(row)
    const source = (row as any).source_snapshot as LeadContactSnapshot | null

    if ((row as any).source_lead_id) {
      if (!fieldsDiffer(working, source)) continue // untouched -- nothing to review yet
      const master = masterByIdMap.get((row as any).source_lead_id) || null
      edits.push({
        lead_id: row.id,
        source_lead_id: (row as any).source_lead_id,
        master,
        source,
        working,
        conflict: fieldsDiffer(master, source), // master itself moved since fork, independent of this edit
      })
    } else {
      const candidates = await findLeadMatches({ phone: working.phone, email: working.email, name: working.name }, row.id)
      newLeads.push({ lead_id: row.id, working, duplicate_candidates: candidates })
    }
  }

  return NextResponse.json({
    working_copy_name: workingCopy.name,
    master_set_id: workingCopy.working_copy_of_set_id,
    edits,
    new_leads: newLeads,
  })
}

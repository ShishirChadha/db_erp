// Filing state for a GST return period. Owner-only.
//
// "filed" here is a LOCAL state transition and nothing more -- this never files
// anything at the portal, and clearing it does not unfile there either. The
// value is the frozen `snapshot`: without it, an edit made after filing is
// undetectable, and an amendment has nothing to diff against.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

const RETURN_TYPES = ['gstr1', 'gstr3b', 'gstr1a', 'gstr9']
const STATUSES = ['draft', 'exported', 'filed']

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  let q = supabaseAdmin.from('gst_filings').select('*').order('period_start', { ascending: false })
  const entity = sp.get('entity')
  if (entity) q = q.eq('entity_key', entity)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { entity_key, return_type, period_start, period_end, status, arn, notes } = body
  if (!entity_key || !return_type || !period_start || !period_end) {
    return NextResponse.json(
      { error: 'entity_key, return_type, period_start and period_end are required' }, { status: 400 })
  }
  if (!RETURN_TYPES.includes(return_type)) {
    return NextResponse.json({ error: `return_type must be one of: ${RETURN_TYPES.join(', ')}` }, { status: 400 })
  }
  const nextStatus = status || 'draft'
  if (!STATUSES.includes(nextStatus)) {
    return NextResponse.json({ error: `status must be one of: ${STATUSES.join(', ')}` }, { status: 400 })
  }

  // Marking a period filed with blockers outstanding would record a figure the
  // ERP itself says is wrong, so it is refused rather than warned about.
  if (nextStatus === 'filed') {
    const { data: readiness, error: rErr } = await supabaseAdmin.rpc('gst_return_readiness', {
      p_entity_key: entity_key, p_from: period_start, p_to: period_end,
    })
    if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
    const blockers = (readiness as any)?.blockers ?? 0
    if (blockers > 0 && !body.force) {
      return NextResponse.json({
        error: `This period still has ${blockers} blocker(s). Clear them, or pass force:true to record the filing anyway.`,
        error_code: 'blockers_outstanding', blockers,
      }, { status: 409 })
    }
  }

  // Snapshot the figures AS FILED. Recomputing later would hide drift, which is
  // the one thing this row exists to make visible.
  let snapshot: any = body.snapshot ?? null
  if (!snapshot && nextStatus !== 'draft') {
    const [sections, hsn, docs, r3b] = await Promise.all([
      supabaseAdmin.rpc('gst_r1_sections', { p_entity_key: entity_key, p_from: period_start, p_to: period_end }),
      supabaseAdmin.rpc('gst_r1_hsn_summary', { p_entity_key: entity_key, p_from: period_start, p_to: period_end }),
      supabaseAdmin.rpc('gst_r1_docs_issued', { p_entity_key: entity_key, p_from: period_start, p_to: period_end }),
      supabaseAdmin.rpc('gst_r3b_summary', { p_entity_key: entity_key, p_from: period_start, p_to: period_end }),
    ])
    snapshot = {
      captured_at: new Date().toISOString(),
      sections: sections.data, hsn: hsn.data, docs: docs.data, r3b: r3b.data,
    }
  }

  const row = {
    entity_key, return_type, period_start, period_end,
    status: nextStatus,
    arn: arn || null,
    notes: notes || null,
    snapshot,
    filed_at: nextStatus === 'filed' ? new Date().toISOString() : null,
    filed_by: nextStatus === 'filed' ? sessionUser!.id : null,
    created_by: sessionUser!.id,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabaseAdmin
    .from('gst_filings')
    .upsert(row, { onConflict: 'entity_key,return_type,period_start' })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'update', module: 'gst', tableName: 'gst_filings',
    recordId: data.id, recordLabel: `${return_type} ${period_start}`,
    metadata: { status: nextStatus, arn: arn || null, entity_key },
  })

  return NextResponse.json(data, { status: 201 })
}

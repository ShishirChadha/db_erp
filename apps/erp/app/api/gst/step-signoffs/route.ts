// Owner sign-off on a guided-filing step that has only warnings / informational items
// (steps 1, 2, 3, 8). The fingerprint is computed in SQL (gst_period_steps) over exactly
// the items being signed off, so a new warning appearing later turns the step yellow again
// with no extra mechanism. A step with blockers can never be signed off.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const entityKey = String(body.entity_key || '').trim()
  const periodStart = String(body.period_start || '').trim()
  const periodEnd = String(body.period_end || '').trim()
  const step = Number(body.step)
  const note = String(body.note || '').trim()
  if (!entityKey || !periodStart || !periodEnd || !Number.isInteger(step)) {
    return NextResponse.json({ error: 'entity_key, period_start, period_end and step are required.' }, { status: 400 })
  }
  if (!note) return NextResponse.json({ error: 'A note is required to sign off a step.' }, { status: 400 })

  const { data: steps, error } = await supabaseAdmin.rpc('gst_period_steps', {
    p_entity_key: entityKey, p_from: periodStart, p_to: periodEnd,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const row = (steps as any[] | null)?.find((s) => s.step === step)
  if (!row) return NextResponse.json({ error: 'Unknown step for this entity/period.' }, { status: 404 })
  if (!row.signoff_applicable) {
    return NextResponse.json({ error: 'This step is not signed off -- it turns green on its own once its checks pass.' }, { status: 400 })
  }
  if (row.blockers > 0 || row.status === 'red') {
    return NextResponse.json({ error: 'This step has blockers. Fix them first; a blocker cannot be signed off.' }, { status: 409 })
  }

  const { data, error: upErr } = await supabaseAdmin
    .from('gst_step_signoffs')
    .upsert({
      entity_key: entityKey, period_start: periodStart, step, note,
      fingerprint: row.fingerprint, signed_by: sessionUser.id, signed_at: new Date().toISOString(),
    }, { onConflict: 'entity_key,period_start,step' })
    .select().single()
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create', module: 'gst', tableName: 'gst_step_signoffs',
    recordId: data.id, recordLabel: `step ${step} ${periodStart}`,
    metadata: { entity_key: entityKey, step, note },
  })
  return NextResponse.json(data, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const entityKey = sp.get('entity'), periodStart = sp.get('period_start'), step = Number(sp.get('step'))
  if (!entityKey || !periodStart || !Number.isInteger(step)) {
    return NextResponse.json({ error: 'entity, period_start and step are required.' }, { status: 400 })
  }
  const { error } = await supabaseAdmin.from('gst_step_signoffs').delete()
    .eq('entity_key', entityKey).eq('period_start', periodStart).eq('step', step)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'hard_delete', module: 'gst', tableName: 'gst_step_signoffs',
    recordLabel: `step ${step} ${periodStart}`, metadata: { entity_key: entityKey, step },
  })
  return NextResponse.json({ success: true })
}

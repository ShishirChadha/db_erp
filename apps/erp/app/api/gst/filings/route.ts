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

  // GSTR-1 and GSTR-3B follow the guided flow: "exported" IS the owner's single approval
  // (steps green, figures frozen with a content hash), and "filed" is only allowed against an
  // approval whose hash still matches the live data -- so what is filed (by hand today, by an
  // automated submit later) is exactly what was reviewed. There is deliberately no force flag.
  const guided = return_type === 'gstr1' || return_type === 'gstr3b'
  let snapshotHash: string | null = null
  let keepExisting: any = null
  if (guided && nextStatus !== 'draft') {
    const range = { p_entity_key: entity_key, p_from: period_start, p_to: period_end }
    const [{ data: steps, error: sErr }, { data: liveHash, error: hErr }] = await Promise.all([
      supabaseAdmin.rpc('gst_period_steps', range),
      supabaseAdmin.rpc(return_type === 'gstr1' ? 'gst_gstr1_fingerprint' : 'gst_gstr3b_fingerprint', range),
    ])
    if (sErr || hErr) return NextResponse.json({ error: (sErr || hErr)!.message }, { status: 500 })
    const st = (n: number) => (steps as any[] | null)?.find((x) => x.step === n)

    if (nextStatus === 'exported') {
      if (return_type === 'gstr1') {
        const notGreen = [1, 2, 3, 4, 5].map(st).filter((x) => x && x.status !== 'green')
        if (notGreen.length) {
          return NextResponse.json({
            error: `Steps ${notGreen.map((x) => x.step).join(', ')} are not green yet: ${notGreen.map((x) => `${x.title} (${x.reason ?? x.status})`).join('; ')}`,
            error_code: 'steps_not_green',
          }, { status: 409 })
        }
      } else {
        const { data: g1 } = await supabaseAdmin.from('gst_filings').select('status')
          .eq('entity_key', entity_key).eq('return_type', 'gstr1').eq('period_start', period_start).maybeSingle()
        if (g1?.status !== 'filed') {
          return NextResponse.json({ error: 'File GSTR-1 for this month first -- the portal builds 3B liability from the filed GSTR-1.', error_code: 'gstr1_not_filed' }, { status: 409 })
        }
        if (st(8)?.status !== 'green') {
          return NextResponse.json({ error: `Finish the purchases / GSTR-2B step first: ${st(8)?.reason ?? ''}`, error_code: 'steps_not_green' }, { status: 409 })
        }
        if (st(9)?.status === 'red') {
          return NextResponse.json({ error: st(9).reason, error_code: 'steps_not_green' }, { status: 409 })
        }
      }
      snapshotHash = liveHash as string
    } else if (nextStatus === 'filed') {
      const { data: existing } = await supabaseAdmin.from('gst_filings').select('*')
        .eq('entity_key', entity_key).eq('return_type', return_type).eq('period_start', period_start).maybeSingle()
      if (!existing || existing.status === 'draft') {
        return NextResponse.json({ error: 'Approve this return first. Filing is only recorded against an approved set of figures.', error_code: 'not_approved' }, { status: 409 })
      }
      if (existing.snapshot_hash && existing.snapshot_hash !== liveHash) {
        return NextResponse.json({ error: 'The figures changed after you approved them. Review and approve again before recording the filing.', error_code: 'stale_approval' }, { status: 409 })
      }
      if (!String(arn || '').trim()) {
        return NextResponse.json({ error: 'Enter the ARN the portal gave you -- it is the proof this was filed.', error_code: 'arn_required' }, { status: 400 })
      }
      keepExisting = existing
      snapshotHash = existing.snapshot_hash
    }
  } else if (nextStatus === 'filed') {
    // gstr1a / gstr9 keep the plain rule: nothing outstanding.
    const { data: readiness, error: rErr } = await supabaseAdmin.rpc('gst_return_readiness', {
      p_entity_key: entity_key, p_from: period_start, p_to: period_end,
    })
    if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
    const blockers = (readiness as any)?.blockers ?? 0
    if (blockers > 0) {
      return NextResponse.json({
        error: `This period still has ${blockers} blocker(s). Clear them first.`,
        error_code: 'blockers_outstanding', blockers,
      }, { status: 409 })
    }
  }

  // Snapshot the figures AS APPROVED/FILED. Recomputing later would hide drift, which is
  // the one thing this row exists to make visible. Filing keeps the approval's snapshot.
  let snapshot: any = keepExisting?.snapshot ?? body.snapshot ?? null
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
    snapshot_hash: snapshotHash,
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

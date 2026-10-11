// Acknowledges a doc_series_gap number as one that was raised and cancelled
// entirely outside the ERP (typically Zoho) before ever getting a row here --
// the resolution path a series gap otherwise has none of. Owner-only, same
// gate as every other GST write in this module.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const entity = sp.get('entity')
  if (!entity) return NextResponse.json({ error: 'entity is required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('gst_void_invoice_numbers')
    .select('*')
    .eq('entity_key', entity)
    .order('period_month', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const entityKey = (body.entity_key || '').trim()
  const seriesKey = (body.series_key || '').trim()
  const seq = Number(body.seq)
  const docType = body.doc_type === 'credit_note' ? 'credit_note' : 'sales'
  const reason = (body.reason || '').trim()

  if (!entityKey || !seriesKey || !Number.isFinite(seq)) {
    return NextResponse.json({ error: 'entity_key, series_key and seq are required.' }, { status: 400 })
  }
  if (!reason) {
    return NextResponse.json({ error: 'A reason is required to acknowledge a cancelled number.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin.rpc('gst_acknowledge_series_gap', {
    p_entity_key: entityKey, p_series_key: seriesKey, p_seq: seq, p_doc_type: docType,
    p_reason: reason, p_user: sessionUser.id,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'gst',
    tableName: 'gst_void_invoice_numbers',
    recordId: data?.id ?? null,
    recordLabel: `${seriesKey}${seq}`,
    metadata: { reason },
  })

  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { data: existing } = await supabaseAdmin.from('gst_void_invoice_numbers').select('series_key, seq').eq('id', id).maybeSingle()
  const { error } = await supabaseAdmin.from('gst_void_invoice_numbers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'hard_delete',
    module: 'gst',
    tableName: 'gst_void_invoice_numbers',
    recordId: id,
    recordLabel: existing ? `${existing.series_key}${existing.seq}` : id,
  })

  return NextResponse.json({ success: true })
}

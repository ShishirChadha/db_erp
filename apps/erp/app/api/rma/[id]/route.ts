import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner, hasPageAccess, canEditPage } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- GET: RMA event detail ----------
// Same non-owner scoping as GET /api/rma -- from_customer only, no vendor identity.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!hasPageAccess(sessionUser, 'rma')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const ownerCaller = isOwner(sessionUser)

  const { data, error } = await supabaseAdmin
    .from('asset_rma_events')
    .select(
      ownerCaller
        ? `id, asset_id, direction, reason, vendor_id, status, opened_at, closed_at, notes,
           asset_ledger ( asset_number, serial_number, status ),
           vendors ( company_name )`
        : `id, asset_id, direction, reason, status, opened_at, closed_at, notes,
           asset_ledger ( asset_number, serial_number, status )`
    )
    .eq('id', id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'RMA event not found' }, { status: 404 })
  if (!ownerCaller && (data as any).direction !== 'from_customer') {
    return NextResponse.json({ error: 'RMA event not found' }, { status: 404 })
  }
  return NextResponse.json(data)
}

// Outcomes that resolve a to_vendor RMA and what they do to the original unit.
// vendor_rejected: vendor wouldn't take it back -> unit stays in-house as faulty stock.
// refund_received / replacement_received: vendor resolved it -> original unit is written off.
const TO_VENDOR_OUTCOME_ASSET_STATUS: Record<string, string> = {
  vendor_rejected: 'faulty',
  refund_received: 'scrapped',
  replacement_received: 'scrapped',
}

// ---------- PATCH: update RMA status / close it ----------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const ownerCaller = isOwner(sessionUser)
  if (!ownerCaller && !canEditPage(sessionUser, 'rma')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  const user = { id: sessionUser.id, email: sessionUser.email }

  const { data: event } = await supabaseAdmin
    .from('asset_rma_events')
    .select('id, asset_id, direction, status')
    .eq('id', id)
    .single()

  if (!event) return NextResponse.json({ error: 'RMA event not found' }, { status: 404 })
  // Non-owner rma-grant is scoped to from_customer, matching GET/POST -- a to_vendor
  // event (vendor identity) is invisible to them, not just read-only.
  if (!ownerCaller && event.direction !== 'from_customer') {
    return NextResponse.json({ error: 'RMA event not found' }, { status: 404 })
  }
  if (event.status === 'closed') {
    return NextResponse.json({ error: 'This RMA event is already closed' }, { status: 400 })
  }

  const body = await req.json()
  const { status, notes } = body as { status: string; notes?: string }

  const validStatuses = ['initiated', 'shipped', 'vendor_accepted', 'vendor_rejected', 'replacement_received', 'refund_received', 'closed']
  if (!status || !validStatuses.includes(status)) {
    return NextResponse.json({ error: `status must be one of: ${validStatuses.join(', ')}` }, { status: 400 })
  }

  const isTerminal = ['vendor_rejected', 'refund_received', 'replacement_received', 'closed'].includes(status)
  const updates: Record<string, any> = { status }
  if (notes !== undefined) updates.notes = notes
  if (isTerminal) updates.closed_at = new Date().toISOString()

  const { error: updateErr } = await supabaseAdmin
    .from('asset_rma_events')
    .update(updates)
    .eq('id', id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  // Only to_vendor RMAs drive the asset's status here — a from_customer RMA already
  // moved the unit into the normal QC funnel when it was opened, and that flow (not
  // this close action) decides what happens to the unit next.
  if (event.direction === 'to_vendor' && TO_VENDOR_OUTCOME_ASSET_STATUS[status]) {
    await supabaseAdmin
      .from('asset_ledger')
      .update({ status: TO_VENDOR_OUTCOME_ASSET_STATUS[status] })
      .eq('id', event.asset_id)
  }

  await logAuditEvent({
    actor: { id: user.id, email: user.email, role: sessionUser.role },
    actionType: 'status_change',
    module: 'rma',
    tableName: 'asset_rma_events',
    recordId: id,
    recordLabel: status,
  })

  return NextResponse.json({ success: true, status })
}

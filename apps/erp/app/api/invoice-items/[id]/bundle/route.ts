// Owner-only: mark an invoice line as part of another line on the same invoice (a free or token-priced
// add-on sold in one bundle). GSTR-1 then files it under the principal's HSN and rate with no
// quantity of its own (v_gst_outward_lines). Refused for a filed or locked month. { principal_line_id: null } undoes it.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { logFieldCorrections } from '@/lib/field-corrections'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const principalId: string | null = body.principal_line_id ? String(body.principal_line_id) : null

  const { data: line } = await supabaseAdmin.from('invoice_items')
    .select('id, invoice_id, bundled_into_item_id').eq('id', id).maybeSingle()
  if (!line) return NextResponse.json({ error: 'Invoice line not found.' }, { status: 404 })
  const { data: inv } = await supabaseAdmin.from('invoices')
    .select('invoice_number, invoice_date, entity_key').eq('id', line.invoice_id).maybeSingle()
  if (!inv) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })

  if (principalId) {
    if (principalId === id) return NextResponse.json({ error: 'A line cannot be bundled into itself.' }, { status: 400 })
    const { data: principal } = await supabaseAdmin.from('invoice_items')
      .select('id, invoice_id, bundled_into_item_id').eq('id', principalId).maybeSingle()
    if (!principal || principal.invoice_id !== line.invoice_id) {
      return NextResponse.json({ error: 'The principal line must be on the same invoice.' }, { status: 400 })
    }
    if (principal.bundled_into_item_id) {
      return NextResponse.json({ error: 'That line is itself bundled into another line; pick the main item.' }, { status: 400 })
    }
    const { count } = await supabaseAdmin.from('invoice_items').select('id', { count: 'exact', head: true }).eq('bundled_into_item_id', id)
    if (count) return NextResponse.json({ error: 'Other lines are bundled into this one, so it cannot be bundled itself.' }, { status: 400 })
  }

  const month = String(inv.invoice_date).slice(0, 7) + '-01'
  const [{ data: locked }, { data: filed }] = await Promise.all([
    supabaseAdmin.rpc('is_period_locked', { p_entity_key: inv.entity_key, p_module: 'sales', p_txn_date: inv.invoice_date }),
    supabaseAdmin.from('gst_filings').select('id').eq('entity_key', inv.entity_key).eq('return_type', 'gstr1')
      .eq('status', 'filed').eq('period_start', month).limit(1),
  ])
  if (locked || (filed && filed.length)) {
    return NextResponse.json({ error: 'That month is filed or locked, so the invoice line is frozen.' }, { status: 409 })
  }

  const { error } = await supabaseAdmin.from('invoice_items').update({ bundled_into_item_id: principalId }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await logFieldCorrections('invoice_items', id, [{ field: 'bundled_into_item_id', oldValue: line.bundled_into_item_id, newValue: principalId }],
    sessionUser.id, `Bundle changed on ${inv.invoice_number}`)
  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'gst', tableName: 'invoice_items', recordId: id, recordLabel: inv.invoice_number,
    metadata: { bundled_into_before: line.bundled_into_item_id, bundled_into_after: principalId },
  })
  return NextResponse.json({ success: true })
}

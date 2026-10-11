// Owner-only: copy the customer record's current name + GSTIN onto an invoice's own snapshot.
// Backs the "Refresh from customer" button on the invoice_customer_gstin_stale check. Refuses a
// month that is filed or locked -- there the invoice copy is history and is frozen on purpose.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { invoice_id } = await req.json().catch(() => ({}))
  if (!invoice_id) return NextResponse.json({ error: 'invoice_id is required.' }, { status: 400 })

  const { data: inv } = await supabaseAdmin.from('invoices')
    .select('id, invoice_number, invoice_date, entity_key, customer_id, customer_name, customer_gst')
    .eq('id', invoice_id).maybeSingle()
  if (!inv || !inv.customer_id) return NextResponse.json({ error: 'Invoice or its customer not found.' }, { status: 404 })

  const month = String(inv.invoice_date).slice(0, 7) + '-01'
  const [{ data: locked }, { data: filed }] = await Promise.all([
    supabaseAdmin.rpc('is_period_locked', { p_entity_key: inv.entity_key, p_module: 'sales', p_txn_date: inv.invoice_date }),
    supabaseAdmin.from('gst_filings').select('id').eq('entity_key', inv.entity_key).eq('return_type', 'gstr1')
      .eq('status', 'filed').eq('period_start', month).limit(1),
  ])
  if (locked || (filed && filed.length)) {
    return NextResponse.json({ error: 'That month is filed or locked, so the invoice copy is frozen.' }, { status: 409 })
  }

  const { data: cust } = await supabaseAdmin.from('customers').select('customer_name, gst_number').eq('id', inv.customer_id).maybeSingle()
  const gst = String(cust?.gst_number ?? '').trim()
  const name = String(cust?.customer_name ?? '').trim()
  if (!cust || !gst) return NextResponse.json({ error: 'The customer record has no GSTIN to copy.' }, { status: 400 })

  const { error } = await supabaseAdmin.from('invoices')
    .update({ customer_gst: gst, ...(name ? { customer_name: name } : {}) }).eq('id', inv.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'gst', tableName: 'invoices', recordId: inv.id, recordLabel: inv.invoice_number,
    metadata: { refreshed_from_customer: true, before: { name: inv.customer_name, gst: inv.customer_gst }, after: { name, gst } },
  })
  return NextResponse.json({ success: true })
}

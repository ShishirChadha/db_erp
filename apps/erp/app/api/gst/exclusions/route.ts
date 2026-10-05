// Marking a sale as never-to-be-invoiced, and the owner's sign-off on that.
//
// Two different permissions on purpose. Setting the reason is operational
// knowledge -- whoever enters the sale knows it is a sample -- so it follows
// this project's "employee entry is immediately real" rule. Reviewing it is
// owner-only, because an exclusion takes value out of the GST base and should
// not pass unseen.
//
// Worth being clear what an exclusion does NOT do: a gift or free sample
// raises no output tax (no consideration), but s.17(5)(h) blocks the input
// credit on goods disposed of that way, so the credit claimed when the unit was
// bought has to be reversed. The GST page raises gift_itc_reversal_due for
// exactly this.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner, hasPageAccess } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

const REASONS = ['sample', 'gift', 'warranty_replacement', 'internal_use', 'other']

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  let q = supabaseAdmin
    .from('sales')
    .select('id, effective_sale_date, customer_name, asset_number, serial_number, sale_total, sale_gst, gst_exclusion_reason, gst_exclusion_note, gst_excluded_at, gst_exclusion_reviewed_at, payment_account')
    .not('gst_exclusion_reason', 'is', null)
    .eq('is_deleted', false)
    .order('effective_sale_date', { ascending: false })

  const from = sp.get('from'), to = sp.get('to')
  if (from) q = q.gte('effective_sale_date', from)
  if (to) q = q.lte('effective_sale_date', to)
  if (sp.get('unreviewed') === '1') q = q.is('gst_exclusion_reviewed_at', null)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// Set or clear the exclusion. Any role that can enter a sale can do this.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'new_entry') && !isOwner(sessionUser)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body?.sale_id) return NextResponse.json({ error: 'sale_id is required' }, { status: 400 })

  const reason = body.reason === null || body.reason === '' ? null : String(body.reason)
  if (reason && !REASONS.includes(reason)) {
    return NextResponse.json({ error: `reason must be one of: ${REASONS.join(', ')}` }, { status: 400 })
  }
  const note = String(body.note || '').trim()
  // 'other' without an explanation cannot be reviewed, so it is refused here
  // as well as in the database.
  if (reason === 'other' && !note) {
    return NextResponse.json({ error: "A note is required when the reason is 'other'." }, { status: 400 })
  }

  const { data: sale } = await supabaseAdmin
    .from('sales').select('id, invoice_id, invoice_number, customer_name, is_deleted')
    .eq('id', body.sale_id).single()
  if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
  if (sale.is_deleted) return NextResponse.json({ error: 'That sale is voided.' }, { status: 400 })

  // An invoiced sale has already been reported, so excluding it would remove a
  // supply the return already carries. That needs a credit note, not a flag.
  if (reason && sale.invoice_id) {
    return NextResponse.json({
      error: `This sale is already invoiced (${sale.invoice_number || sale.invoice_id}), so it is in a return already. Issue a credit note instead of excluding it.`,
      error_code: 'already_invoiced',
    }, { status: 409 })
  }

  const { data, error } = await supabaseAdmin
    .from('sales')
    .update({
      gst_exclusion_reason: reason,
      gst_exclusion_note: reason ? (note || null) : null,
      gst_excluded_by: reason ? sessionUser.id : null,
      gst_excluded_at: reason ? new Date().toISOString() : null,
      // Changing the reason invalidates any prior sign-off.
      gst_exclusion_reviewed_by: null,
      gst_exclusion_reviewed_at: null,
    })
    .eq('id', body.sale_id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'sales', tableName: 'sales',
    recordId: body.sale_id,
    recordLabel: `${sale.customer_name || 'Sale'} — GST exclusion ${reason ? 'set: ' + reason : 'cleared'}`,
    metadata: { reason, note: note || null },
  })

  return NextResponse.json(data)
}

// Owner sign-off.
export async function PATCH(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const ids: string[] = Array.isArray(body?.sale_ids) ? body.sale_ids : body?.sale_id ? [body.sale_id] : []
  if (ids.length === 0) return NextResponse.json({ error: 'sale_id or sale_ids is required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('sales')
    .update({
      gst_exclusion_reviewed_by: sessionUser.id,
      gst_exclusion_reviewed_at: new Date().toISOString(),
    })
    .in('id', ids)
    .not('gst_exclusion_reason', 'is', null)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'sales', tableName: 'sales',
    recordId: ids[0],
    recordLabel: `GST exclusions reviewed (${data?.length ?? 0})`,
    metadata: { count: data?.length ?? 0 },
  })

  return NextResponse.json({ reviewed: data?.length ?? 0 })
}

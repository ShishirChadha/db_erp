import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, canEditPage, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { isAgreementOverdue, BILLING_INTERVALS, PAYMENT_ACCOUNTS } from '@/lib/rentals'

const DETAIL_SELECT = `
  id, agreement_number, customer_id, status, start_date, expected_return_date,
  actual_closed_at, billing_interval, rent_amount, gst_percentage, payment_account,
  next_billing_date, billing_reminder_lead_days, last_billed_at,
  security_deposit_amount, deposit_payment_account, deposit_received_at,
  deposit_refunded_amount, deposit_refunded_at, deposit_deduction_reason,
  notes, created_at, created_by,
  customers ( customer_name, phone, email, gst_number, state_code ),
  rental_agreement_items (
    id, asset_id, item_status, handed_over_at, returned_at, return_condition_notes,
    buyout_sale_id,
    asset_ledger ( id, asset_number, serial_number, status, sku_id,
      sku_master!purchase_order_asset_mapping_sku_id_fkey ( full_sku_code, brand, model_name, category ) )
  )
`

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'rentals')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params

  const { data: agreement, error } = await supabaseAdmin
    .from('rental_agreements')
    .select(DETAIL_SELECT)
    .eq('id', id)
    .single()
  if (error || !agreement) return NextResponse.json({ error: 'Rental agreement not found' }, { status: 404 })

  // Every rent charge and every buyout for this agreement, as real sales rows --
  // this is the module's whole billing history, no separate ledger.
  const { data: charges } = await supabaseAdmin
    .from('sales')
    .select(`id, sale_date, rental_period_start, rental_period_end, sale_base_price,
      sale_gst, sale_total, amount_paid, payment_status, payment_account, finalized,
      invoice_id, invoice_number, asset_ledger_id, asset_description, is_deleted`)
    .eq('rental_agreement_id', id)
    .eq('is_deleted', false)
    .order('sale_date', { ascending: false })
    .order('created_at', { ascending: false })

  const rows = charges || []
  return NextResponse.json({
    ...(agreement as any),
    customer_name: (agreement as any).customers?.customer_name || null,
    is_overdue: isAgreementOverdue(agreement as any),
    charges: rows,
    // A buyout row carries asset_ledger_id; a rent charge never does. That single
    // fact is what separates rental revenue from unit revenue everywhere.
    total_rent_billed: rows.filter((c: any) => !c.asset_ledger_id).reduce((s: number, c: any) => s + Number(c.sale_total || 0), 0),
    total_rent_collected: rows.filter((c: any) => !c.asset_ledger_id).reduce((s: number, c: any) => s + Number(c.amount_paid || 0), 0),
  })
}

const EDITABLE_FIELDS = [
  'expected_return_date', 'billing_interval', 'rent_amount', 'gst_percentage',
  'payment_account', 'next_billing_date', 'billing_reminder_lead_days', 'notes', 'status',
]
// Deposit money fields are owner-only and are handled by the dedicated deposit route,
// never through this general edit path.
const OWNER_ONLY_FIELDS = ['security_deposit_amount', 'deposit_payment_account']

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'rentals')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })

  const updates: Record<string, any> = {}
  for (const f of EDITABLE_FIELDS) if (f in body) updates[f] = body[f]
  for (const f of OWNER_ONLY_FIELDS) {
    if (f in body) {
      if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Only an owner can change deposit fields.' }, { status: 403 })
      updates[f] = body[f]
    }
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  if (!canEditPage(sessionUser, 'rentals')) return NextResponse.json({ error: 'View-only access.' }, { status: 403 })

  if (updates.billing_interval && !BILLING_INTERVALS.includes(updates.billing_interval)) {
    return NextResponse.json({ error: 'Invalid billing interval.' }, { status: 400 })
  }
  if (updates.payment_account && !PAYMENT_ACCOUNTS.includes(updates.payment_account)) {
    return NextResponse.json({ error: 'Invalid payment account.' }, { status: 400 })
  }
  if ('rent_amount' in updates && !(Number(updates.rent_amount) > 0)) {
    return NextResponse.json({ error: 'Rent amount must be greater than zero.' }, { status: 400 })
  }
  if (updates.status && !['draft', 'active', 'closed', 'cancelled'].includes(updates.status)) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
  }

  // Changing the due date restarts the reminder cycle, matching how activities reset
  // due_soon/overdue markers on a due_date change -- otherwise a task fires once and
  // the agreement goes silent forever.
  if ('expected_return_date' in updates) updates.overdue_notified_at = null
  if ('next_billing_date' in updates) updates.billing_notified_at = null

  const { data: updated, error } = await supabaseAdmin
    .from('rental_agreements')
    .update(updates)
    .eq('id', id)
    .select('id, agreement_number')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'status' in updates ? 'status_change' : 'update',
    module: 'rentals',
    tableName: 'rental_agreements',
    recordId: id,
    recordLabel: updated.agreement_number,
  })

  return NextResponse.json({ success: true })
}

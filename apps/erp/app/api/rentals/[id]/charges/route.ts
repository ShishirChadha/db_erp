import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, canEditPage } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { createRentalCharge, addInterval, subtractDay } from '@/lib/rentals'

// Generates one billing cycle's charge as a real `sales` row.
//
// A human triggers this, never the cron: scan_rental_cycles raises a TASK when a
// cycle is due and a person clicks through, the same call scan_recurring_expenses
// makes for expenses. Money rows stay human-initiated.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPage(sessionUser, 'rentals')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const { data: agreement } = await supabaseAdmin
    .from('rental_agreements')
    .select(`id, agreement_number, customer_id, status, rent_amount, gst_percentage,
      payment_account, billing_interval, next_billing_date, start_date, is_deleted,
      rental_agreement_items ( id, item_status )`)
    .eq('id', id)
    .single()
  if (!agreement || agreement.is_deleted) {
    return NextResponse.json({ error: 'Rental agreement not found' }, { status: 404 })
  }
  if (agreement.status !== 'active') {
    return NextResponse.json({ error: `Cannot bill a ${agreement.status} agreement.` }, { status: 400 })
  }

  // Bill only what is actually still out: if a customer returned 1 of 3 laptops
  // mid-term, this cycle costs less. Rent is stored per-agreement, so scale it by
  // the share of units still on rent.
  const items = (agreement as any).rental_agreement_items || []
  const onRent = items.filter((i: any) => i.item_status === 'on_rent').length
  if (onRent === 0) {
    return NextResponse.json({ error: 'No units are still out on this agreement -- nothing to bill.' }, { status: 400 })
  }

  const periodStart = body.period_start || agreement.next_billing_date || agreement.start_date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) {
    return NextResponse.json({ error: 'Invalid billing period start.' }, { status: 400 })
  }
  const periodEnd = body.period_end ||
    (agreement.billing_interval === 'one_time'
      ? periodStart
      : subtractDay(addInterval(periodStart, agreement.billing_interval)))

  // Refuse to bill the same period twice -- the cron can raise the same task again
  // after a failure, and an accidental double-click here is a real duplicate invoice.
  const { data: existing } = await supabaseAdmin
    .from('sales')
    .select('id')
    .eq('rental_agreement_id', id)
    .eq('rental_period_start', periodStart)
    .is('asset_ledger_id', null)
    .eq('is_deleted', false)
    .maybeSingle()
  if (existing) {
    return NextResponse.json(
      { error: `This period (from ${periodStart}) has already been billed.`, error_code: 'already_billed' },
      { status: 409 }
    )
  }

  const perUnit = Number(agreement.rent_amount) / Math.max(items.length, 1)
  const defaultAmount = items.length === onRent
    ? Number(agreement.rent_amount)
    : Math.round(perUnit * onRent * 100) / 100

  const result = await createRentalCharge({
    agreement: agreement as any,
    periodStart,
    periodEnd,
    amount: body.amount != null ? Number(body.amount) : defaultAmount,
    saleDate: body.sale_date || null,
    soldBy: body.sold_by || null,
    unitCount: onRent,
    userId: sessionUser.id,
  })
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 })

  if (Number(body.amount_paid) > 0) {
    await supabaseAdmin.from('sale_payments').insert({
      sale_id: result.saleId,
      amount: Number(body.amount_paid),
      payment_account: agreement.payment_account,
      note: `Rent received (${agreement.agreement_number}, from ${periodStart})`,
      recorded_by: sessionUser.id,
    })
  }

  // Advance the cycle past the period just billed, and clear the reminder marker so
  // the next cycle gets a fresh notification.
  if (agreement.billing_interval !== 'one_time') {
    const nextDate = addInterval(periodStart, agreement.billing_interval)
    await supabaseAdmin
      .from('rental_agreements')
      .update({ next_billing_date: nextDate, last_billed_at: new Date().toISOString(), billing_notified_at: null })
      .eq('id', id)
  } else {
    await supabaseAdmin
      .from('rental_agreements')
      .update({ next_billing_date: null, last_billed_at: new Date().toISOString() })
      .eq('id', id)
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'rentals',
    tableName: 'sales',
    recordId: result.saleId,
    recordLabel: agreement.agreement_number,
    metadata: { rental_agreement_id: id, period_start: periodStart, period_end: periodEnd, units: onRent },
    reason: 'Rental cycle billed -- charge added to Sales Ledger',
  })

  return NextResponse.json({ success: true, sale_id: result.saleId, period_start: periodStart, period_end: periodEnd }, { status: 201 })
}

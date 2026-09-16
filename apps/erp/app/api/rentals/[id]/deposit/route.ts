import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { createRentalCharge } from '@/lib/rentals'

// Settles the security deposit: refund some/all of it, and optionally forfeit the rest.
//
// Owner-only, unlike the rest of this module -- this is money leaving the business,
// which is the same line the app already draws for correcting a sale payment.
//
// The deposit itself is a refundable LIABILITY and never becomes a sales row: it must
// not inflate revenue or attract GST while it is being held. A FORFEITED portion is
// different -- at that point it genuinely is income, so it is recorded here as a
// normal rental charge, which is what puts it into the Sales Ledger, GST and reports.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) {
    return NextResponse.json({ error: 'Only an owner can settle a security deposit.' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })

  const { data: agreement } = await supabaseAdmin
    .from('rental_agreements')
    .select(`id, agreement_number, customer_id, rent_amount, gst_percentage, payment_account,
      security_deposit_amount, deposit_refunded_amount, deposit_refunded_at, deposit_received_at, is_deleted`)
    .eq('id', id)
    .single()
  if (!agreement || agreement.is_deleted) {
    return NextResponse.json({ error: 'Rental agreement not found' }, { status: 404 })
  }

  const held = Number(agreement.security_deposit_amount || 0)
  if (held <= 0) return NextResponse.json({ error: 'No deposit was taken on this agreement.' }, { status: 400 })
  if (agreement.deposit_refunded_at) {
    return NextResponse.json({ error: 'This deposit has already been settled.' }, { status: 400 })
  }

  const refund = Number(body.refund_amount)
  if (!(refund >= 0)) return NextResponse.json({ error: 'Refund amount must be zero or more.' }, { status: 400 })
  if (refund > held + 0.5) {
    return NextResponse.json({ error: `Refund cannot exceed the deposit held (${held}).` }, { status: 400 })
  }

  const forfeited = Math.round((held - refund) * 100) / 100
  const reason = typeof body.deduction_reason === 'string' ? body.deduction_reason.trim() : ''
  if (forfeited > 0.5 && !reason) {
    return NextResponse.json({ error: 'A reason is required when any part of the deposit is withheld.' }, { status: 400 })
  }

  const { error: updErr } = await supabaseAdmin
    .from('rental_agreements')
    .update({
      deposit_refunded_amount: refund,
      deposit_refunded_at: new Date().toISOString(),
      deposit_deduction_reason: forfeited > 0.5 ? reason : null,
    })
    .eq('id', id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  let forfeitSaleId: string | null = null
  if (forfeited > 0.5 && body.record_forfeited_as_income !== false) {
    const today = new Date().toISOString().slice(0, 10)
    const result = await createRentalCharge({
      agreement: agreement as any,
      periodStart: today,
      periodEnd: today,
      amount: forfeited,
      saleDate: today,
      unitCount: 1,
      userId: sessionUser.id,
    })
    if (!result.error) forfeitSaleId = result.saleId || null
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'rentals',
    tableName: 'rental_agreements',
    recordId: id,
    recordLabel: agreement.agreement_number,
    metadata: { deposit_held: held, refunded: refund, forfeited, forfeit_sale_id: forfeitSaleId },
    reason: 'Security deposit settled',
  })

  return NextResponse.json({ success: true, refunded: refund, forfeited, forfeit_sale_id: forfeitSaleId })
}

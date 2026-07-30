import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'

// Append-only ledger of individual payment installments against a sale (docs/decisions.md,
// "sale_payments ledger"). sales.amount_paid/payment_status are trigger-derived from the
// sum of these rows -- never written directly here.

// ---------- GET: list installments for a sale ----------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, ['live_stock', 'new_entry', 'invoices'])) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { id } = await params
  const { data, error } = await supabaseAdmin
    .from('sale_payments')
    .select('id, amount, payment_account, note, recorded_by, recorded_at, profiles:recorded_by(full_name)')
    .eq('sale_id', id)
    .order('recorded_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const result = (data || []).map((row: any) => ({
    id: row.id,
    amount: row.amount,
    payment_account: row.payment_account,
    note: row.note,
    recorded_at: row.recorded_at,
    recorded_by_name: row.profiles?.full_name || null,
  }))
  return NextResponse.json(result)
}

// ---------- POST: record a new payment installment ----------
// Open to any role with sell-adjacent page access -- an employee taking a customer's
// second/third installment records it themselves, same "immediately real" principle as
// the sale itself. Owner corrections/reversals go through DELETE below, not this route.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, ['live_stock', 'new_entry'])) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const amount = Number(body.amount)

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Amount must be a positive number.' }, { status: 400 })
  }

  const { data: sale, error: saleErr } = await supabaseAdmin
    .from('sales')
    .select('id, sale_total, amount_paid, is_deleted')
    .eq('id', id)
    .single()
  if (saleErr || !sale || sale.is_deleted) {
    return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
  }

  const alreadyPaid = Number(sale.amount_paid) || 0
  const saleTotal = Number(sale.sale_total) || 0
  // Small rounding tolerance, not a hard equality check -- catches a genuine
  // typo (an extra digit) without fighting paise-level rounding differences.
  if (!body.confirm_overpayment && alreadyPaid + amount > saleTotal + 0.5) {
    return NextResponse.json({
      error: `This would bring total paid to ₹${(alreadyPaid + amount).toFixed(2)}, above the sale total of ₹${saleTotal.toFixed(2)}. Submit again to confirm this is correct.`,
      error_code: 'exceeds_sale_total',
    }, { status: 409 })
  }

  const { data: payment, error } = await supabaseAdmin
    .from('sale_payments')
    .insert({
      sale_id: id,
      amount,
      payment_account: body.payment_account || null,
      note: body.note || null,
      recorded_by: sessionUser.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: updatedSale } = await supabaseAdmin
    .from('sales')
    .select('amount_paid, payment_status')
    .eq('id', id)
    .single()

  return NextResponse.json({ payment, sale: updatedSale })
}

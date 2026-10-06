import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { allocatePaymentLegs } from '@db/shared'
import { logAuditEvent } from '@/lib/audit-log'

// "Mark delivered + record balance" -- the one action a COD web order needs
// once the parcel actually reaches the customer. Two things happen
// together, by design: fulfillment_status flips to 'delivered' (the event
// this schema had no representation for at all before 2026-10-06), and the
// cash balance the customer hands over gets ledgered as a real
// sale_payments row -- never written onto sales.amount_paid directly, same
// rule as everywhere else in this codebase (see order-to-sale.ts).
//
// Owner-only, matching /api/web-orders itself (revenue + customer PII, no
// partial view worth granting).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id: orderId } = await params
  const body = await req.json().catch(() => ({})) as { collect_balance?: boolean }
  const collectBalance = body.collect_balance !== false

  const { data: order, error: orderErr } = await supabaseAdmin
    .from('orders')
    .select('id, payment_method, status, fulfillment_status, total_amount, token_amount')
    .eq('id', orderId)
    .maybeSingle()
  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.payment_method !== 'cod') {
    return NextResponse.json({ error: 'This action is only for Cash on Delivery orders.' }, { status: 400 })
  }
  if (order.fulfillment_status === 'delivered') {
    return NextResponse.json({ error: 'Already marked delivered.' }, { status: 409 })
  }

  let collected = 0
  if (collectBalance) {
    // Every linked sale's REMAINING capacity, read live from the sales rows
    // themselves (sale_total - amount_paid, both trigger-maintained) rather
    // than assumed from order.token_amount -- this is what makes a second
    // independent allocatePaymentLegs call correct. Splitting the token and
    // the balance as two separate proportional-by-FULL-total calls would not
    // guarantee each sale's two shares sum to exactly its own total; capping
    // this call's weights at each sale's actual remaining capacity does.
    const { data: orderItems, error: itemsErr } = await supabaseAdmin
      .from('order_items')
      .select('erp_sale_id')
      .eq('order_id', orderId)
      .not('erp_sale_id', 'is', null)
    if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 })

    const saleIds = [...new Set((orderItems || []).map((i) => i.erp_sale_id as string))]
    if (saleIds.length === 0) {
      return NextResponse.json({ error: 'This order has no linked sales yet -- conversion may not have completed.' }, { status: 409 })
    }

    const { data: sales, error: salesErr } = await supabaseAdmin
      .from('sales')
      .select('id, sale_total, amount_paid')
      .in('id', saleIds)
    if (salesErr) return NextResponse.json({ error: salesErr.message }, { status: 500 })

    const remaining = (sales || []).map((s) => Math.max(0, Number(s.sale_total) - Number(s.amount_paid)))
    const totalRemaining = remaining.reduce((sum, r) => sum + r, 0)

    if (totalRemaining > 0) {
      const allocation = allocatePaymentLegs(
        [{ amount: totalRemaining, payment_account: 'Cash', note: 'COD balance on delivery' }],
        remaining
      )
      for (let i = 0; i < (sales || []).length; i++) {
        const share = allocation[i]?.[0]?.amount ?? 0
        if (share <= 0) continue
        const { error: payErr } = await supabaseAdmin.from('sale_payments').insert({
          sale_id: sales![i].id,
          amount: share,
          payment_account: 'Cash',
          note: `COD balance collected on delivery (order ${orderId})`,
          recorded_by: sessionUser!.id,
        })
        if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 })
        collected += share
      }
    }
  }

  // Re-check the sales themselves (post-insert) rather than assuming
  // collected >= totalRemaining covers it -- if collectBalance was false, or
  // a sale was already partially settled some other way, the order's own
  // payment status should reflect what's ACTUALLY true, not what this one
  // action intended to do.
  const { data: refreshedItems } = await supabaseAdmin
    .from('order_items')
    .select('erp_sale_id')
    .eq('order_id', orderId)
    .not('erp_sale_id', 'is', null)
  const refreshedSaleIds = [...new Set((refreshedItems || []).map((i) => i.erp_sale_id as string))]
  const { data: refreshedSales } = await supabaseAdmin
    .from('sales')
    .select('payment_status')
    .in('id', refreshedSaleIds.length > 0 ? refreshedSaleIds : ['00000000-0000-0000-0000-000000000000'])
  const fullySettled = (refreshedSales || []).length > 0 && (refreshedSales || []).every((s) => s.payment_status === 'paid')

  const orderUpdate: Record<string, unknown> = { fulfillment_status: 'delivered' }
  if (fullySettled && order.status !== 'paid') {
    orderUpdate.status = 'paid'
    orderUpdate.paid_at = new Date().toISOString()
  }
  const { error: updateErr } = await supabaseAdmin.from('orders').update(orderUpdate).eq('id', orderId)
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'update',
    module: 'sales',
    tableName: 'orders',
    recordId: orderId,
    metadata: { fulfillment_status: 'delivered', balance_collected: collected, order_status: orderUpdate.status ?? order.status },
  })

  return NextResponse.json({ success: true, collected, order_status: orderUpdate.status ?? order.status })
}

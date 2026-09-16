import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, canEditPage } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { resolveRentalGstPercent } from '@/lib/rentals'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Rent-to-own: the renter buys the unit they already have.
//
// This route deliberately does NOT go through lib/sales-cart.ts's
// processSingleSaleItem. That helper requires the unit to be in SELLABLE_STATUSES
// (an on-rent unit is not) and writes its own 'sale' stock_movements row -- and the
// unit was ALREADY decremented out of stock at handover. Routing a buyout through it
// would double-decrement sku_master.quantity_in_stock. The unit simply never comes
// back, so the handover's -1 stands as the sale's decrement and nothing is written
// here. Net effect across handover + buyout is -1, identical to an ordinary sale.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPage(sessionUser, 'rentals')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id, itemId } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })

  const price = Number(body.sale_base_price)
  if (!(price > 0)) return NextResponse.json({ error: 'Buyout price must be greater than zero.' }, { status: 400 })
  const saleDate = body.sale_date || new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) return NextResponse.json({ error: 'Invalid sale date.' }, { status: 400 })

  const { data: item } = await supabaseAdmin
    .from('rental_agreement_items')
    .select(`id, agreement_id, asset_id, item_status,
      rental_agreements ( id, agreement_number, customer_id, payment_account, gst_percentage ),
      asset_ledger ( id, asset_number, serial_number, sku_id, status )`)
    .eq('id', itemId)
    .eq('agreement_id', id)
    .single()
  if (!item) return NextResponse.json({ error: 'Rental unit not found on this agreement.' }, { status: 404 })
  if (item.item_status !== 'on_rent') {
    return NextResponse.json({ error: `This unit is already marked '${item.item_status}'.` }, { status: 400 })
  }

  const agreement = (item as any).rental_agreements
  const asset = (item as any).asset_ledger
  const paymentAccount = body.payment_account || agreement.payment_account
  if (!paymentAccount) return NextResponse.json({ error: 'A payment account is required.' }, { status: 400 })

  // Atomic claim from on_rent -> sold.
  const { data: sold, error: soldErr } = await supabaseAdmin
    .from('asset_ledger')
    .update({ status: 'sold', sold_at: new Date(`${saleDate}T12:00:00.000Z`).toISOString() })
    .eq('id', item.asset_id)
    .eq('status', 'on_rent')
    .select('id')
    .maybeSingle()
  if (soldErr) return NextResponse.json({ error: soldErr.message }, { status: 500 })
  if (!sold) return NextResponse.json({ error: 'This unit is no longer out on rent -- refresh and retry.' }, { status: 409 })

  const gstPct = await resolveRentalGstPercent(paymentAccount, body.gst_percentage ?? agreement.gst_percentage)
  const gstAmount = gstPct > 0 ? Math.round(price * gstPct) / 100 : 0
  const saleDateObj = new Date(`${saleDate}T12:00:00.000Z`)

  const { data: customer } = await supabaseAdmin
    .from('customers').select('customer_name').eq('id', agreement.customer_id).single()

  // Unlike a rent charge, a buyout DOES carry asset_ledger_id: it is a genuine unit
  // sale, so it must classify as line_kind='unit' in v_report_sale_lines and keep
  // real COGS. rental_agreement_id rides along purely for traceability.
  const { data: sale, error: saleErr } = await supabaseAdmin
    .from('sales')
    .insert({
      asset_ledger_id: item.asset_id,
      rental_agreement_id: agreement.id,
      customer_id: agreement.customer_id,
      customer_name: customer?.customer_name || null,
      sale_date: saleDate,
      sale_month: MONTHS[saleDateObj.getUTCMonth()],
      sale_year: saleDateObj.getUTCFullYear(),
      sale_type: gstPct > 0 ? 'GST' : 'Cash',
      sale_base_price: price,
      sale_gst: gstAmount,
      sale_total: price + gstAmount,
      payment_account: paymentAccount,
      sold_by: body.sold_by || null,
      asset_number: asset?.asset_number || null,
      serial_number: asset?.serial_number || null,
      notes: `Rent-to-own buyout from ${agreement.agreement_number}`,
      entered_by: sessionUser.id,
      finalized: false,
    })
    .select('id')
    .single()

  if (saleErr) {
    await supabaseAdmin.from('asset_ledger').update({ status: 'on_rent', sold_at: null }).eq('id', item.asset_id)
    return NextResponse.json({ error: saleErr.message }, { status: 500 })
  }

  const { error: itemErr } = await supabaseAdmin
    .from('rental_agreement_items')
    .update({ item_status: 'bought_out', returned_at: new Date().toISOString(), buyout_sale_id: sale.id })
    .eq('id', itemId)
  if (itemErr) {
    await supabaseAdmin.from('sales').delete().eq('id', sale.id)
    await supabaseAdmin.from('asset_ledger').update({ status: 'on_rent', sold_at: null }).eq('id', item.asset_id)
    return NextResponse.json({ error: itemErr.message }, { status: 500 })
  }

  // Money already in hand goes in as a payment leg -- sales.amount_paid/payment_status
  // are trigger-derived and a direct write here would be wiped by the next installment.
  if (Number(body.amount_paid) > 0) {
    await supabaseAdmin.from('sale_payments').insert({
      sale_id: sale.id,
      amount: Number(body.amount_paid),
      payment_account: paymentAccount,
      note: `Buyout payment (${agreement.agreement_number})`,
      recorded_by: sessionUser.id,
    })
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'rentals',
    tableName: 'sales',
    recordId: sale.id,
    recordLabel: agreement.agreement_number,
    metadata: { rental_agreement_id: agreement.id, asset_id: item.asset_id },
    reason: 'Rent-to-own buyout -- unit sold to the renter',
  })

  return NextResponse.json({ success: true, sale_id: sale.id })
}

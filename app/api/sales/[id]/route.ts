import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// ---------- GET: fetch one sale (owner-only -- the Sales ledger is owner-facing) ----------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data, error } = await supabaseAdmin.from('sales').select('*').eq('id', id).single()
  if (error || !data) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
  return NextResponse.json(data)
}

// ---------- PATCH: owner edits a sale after the fact ----------
// Anything can be corrected here -- customer, price/GST, payment status/amount,
// payment account, sold-by. This does NOT touch inventory/invoice state; if
// sale_base_price/gst_percentage change, sale_total is recomputed to stay consistent,
// but an already-generated invoice is NOT retroactively changed (matches the
// "the sale already happened" principle from Part 6 -- this is a bookkeeping correction,
// not a new sale).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data: existing } = await supabaseAdmin.from('sales').select('*').eq('id', id).single()
  if (!existing) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })

  const body = await req.json()
  const updates: Record<string, any> = {}

  if (body.customer_id !== undefined) {
    updates.customer_id = body.customer_id
    const { data: customer } = await supabaseAdmin.from('customers').select('customer_name').eq('id', body.customer_id).single()
    updates.customer_name = customer?.customer_name || null
  }

  const basePrice = body.sale_base_price ?? existing.sale_base_price
  const gstPct = body.gst_percentage ?? (existing.sale_gst && existing.sale_base_price ? (existing.sale_gst / existing.sale_base_price) * 100 : 18)
  if (body.sale_base_price !== undefined || body.gst_percentage !== undefined) {
    const gstAmount = Math.round(basePrice * gstPct) / 100
    updates.sale_base_price = basePrice
    updates.sale_gst = gstAmount
    updates.sale_total = basePrice + gstAmount
  }

  for (const key of ['sale_type', 'payment_status', 'amount_paid', 'payment_account', 'sold_by'] as const) {
    if (body[key] !== undefined) updates[key] = body[key]
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin.from('sales').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

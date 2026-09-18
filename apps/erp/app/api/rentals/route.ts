import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, canEditPage } from '@/lib/auth/session'
import { parsePagination } from '@/lib/pagination'
import { logAuditEvent } from '@/lib/audit-log'
import { withRetry } from '@/lib/db-retry'
import {
  generateRentalAgreementNumber, handOverUnit, addInterval, isAgreementOverdue,
  BILLING_INTERVALS, PAYMENT_ACCOUNTS,
} from '@/lib/rentals'

const SORT_COLUMNS: Record<string, string> = {
  start_date: 'start_date',
  agreement_number: 'agreement_number',
  expected_return_date: 'expected_return_date',
  rent_amount: 'rent_amount',
  next_billing_date: 'next_billing_date',
  status: 'status',
}

const SELECT = `
  id, agreement_number, customer_id, status, start_date, expected_return_date,
  actual_closed_at, billing_interval, rent_amount, gst_percentage, payment_account,
  next_billing_date, billing_reminder_lead_days, last_billed_at,
  security_deposit_amount, deposit_payment_account, deposit_received_at,
  deposit_refunded_amount, deposit_refunded_at, deposit_deduction_reason,
  notes, created_at, created_by,
  customers ( customer_name, phone ),
  rental_agreement_items ( id, item_status )
`

// ---------- GET: list ----------
// No cost_price / vendor_id / base_cost is selected anywhere in this module, so
// there is nothing to redact -- the "never .select() sensitive columns in the first
// place" preference rather than fetch-then-strip.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'rentals')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const today = new Date().toISOString().slice(0, 10)

  if (searchParams.get('counts') === 'true') {
    const countOf = async (build: (q: any) => any) => {
      const { count } = await withRetry<any>(() => build(
        supabaseAdmin.from('rental_agreements').select('id', { count: 'exact', head: true }).eq('is_deleted', false)
      ))
      return count || 0
    }
    const [total, active, closed, dueToBill] = await Promise.all([
      countOf((q: any) => q),
      countOf((q: any) => q.eq('status', 'active')),
      countOf((q: any) => q.eq('status', 'closed')),
      countOf((q: any) => q.eq('status', 'active').not('next_billing_date', 'is', null).lte('next_billing_date', today)),
    ])
    // Overdue can't be expressed as a single PostgREST count (it needs "an item is
    // still on_rent"), so it's derived from the same rows the list uses.
    const { data: activeRows } = await withRetry(() => supabaseAdmin
      .from('rental_agreements')
      .select('status, expected_return_date, rental_agreement_items ( item_status )')
      .eq('is_deleted', false)
      .eq('status', 'active'))
    const overdue = (activeRows || []).filter((r: any) => isAgreementOverdue(r)).length
    return NextResponse.json({ total, active, closed, due_to_bill: dueToBill, overdue })
  }

  const pagination = parsePagination(searchParams)
  const status = searchParams.get('status')
  const search = searchParams.get('search')?.trim()
  const sortKey = searchParams.get('sort') || 'start_date'
  const sortDir = searchParams.get('order') === 'asc'

  let query = supabaseAdmin
    .from('rental_agreements')
    .select(SELECT, pagination ? { count: 'exact' } : undefined)
    .eq('is_deleted', false)

  if (status) query = query.in('status', status.split(','))

  if (search) {
    const { data: matchedCustomers } = await withRetry(() => supabaseAdmin
      .from('customers')
      .select('id')
      .ilike('customer_name', `%${search}%`)
      .limit(200))
    const orParts = [`agreement_number.ilike.%${search}%`, `notes.ilike.%${search}%`]
    if (matchedCustomers?.length) orParts.push(`customer_id.in.(${matchedCustomers.map((c) => c.id).join(',')})`)
    query = query.or(orParts.join(','))
  }

  // Date column first and default-sorted descending, per the app-wide list rule;
  // created_at is the tiebreak since start_date is not unique per row.
  query = query
    .order(SORT_COLUMNS[sortKey] || 'start_date', { ascending: sortDir, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data, error, count } = await withRetry(() => query)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const rows = (data || []).map((r: any) => ({
    ...r,
    customer_name: r.customers?.customer_name || null,
    customer_phone: r.customers?.phone || null,
    units_on_rent: (r.rental_agreement_items || []).filter((i: any) => i.item_status === 'on_rent').length,
    units_total: (r.rental_agreement_items || []).length,
    is_overdue: isAgreementOverdue(r),
  }))

  if (pagination) return NextResponse.json({ data: rows, total: count || 0 })
  return NextResponse.json(rows)
}

// ---------- POST: open a rental agreement ----------
// Immediately real, same as every other operational entry in this app: the units
// leave sellable stock at creation time, there is no owner-approval gate.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPage(sessionUser, 'rentals')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })

  const {
    customer_id, asset_ids, start_date, expected_return_date, billing_interval,
    rent_amount, gst_percentage, payment_account, security_deposit_amount,
    deposit_payment_account, deposit_received, notes, billing_reminder_lead_days,
  } = body

  if (!customer_id) return NextResponse.json({ error: 'Customer is required.' }, { status: 400 })
  if (!Array.isArray(asset_ids) || asset_ids.length === 0) {
    return NextResponse.json({ error: 'Select at least one unit to rent out.' }, { status: 400 })
  }
  if (new Set(asset_ids).size !== asset_ids.length) {
    return NextResponse.json({ error: 'The same unit was selected more than once.' }, { status: 400 })
  }
  if (!BILLING_INTERVALS.includes(billing_interval)) {
    return NextResponse.json({ error: 'Invalid billing interval.' }, { status: 400 })
  }
  if (!PAYMENT_ACCOUNTS.includes(payment_account)) {
    return NextResponse.json({ error: 'Invalid payment account.' }, { status: 400 })
  }
  if (!(Number(rent_amount) > 0)) {
    return NextResponse.json({ error: 'Rent amount must be greater than zero.' }, { status: 400 })
  }
  for (const [label, value] of [['start date', start_date], ['expected return date', expected_return_date]] as const) {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return NextResponse.json({ error: `Invalid ${label}.` }, { status: 400 })
    }
  }

  const startDate = start_date || new Date().toISOString().slice(0, 10)
  if (expected_return_date && expected_return_date < startDate) {
    return NextResponse.json({ error: 'Expected return date cannot be before the start date.' }, { status: 400 })
  }

  let agreementNumber: string
  try {
    agreementNumber = await generateRentalAgreementNumber()
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to generate agreement number: ${err.message}` }, { status: 500 })
  }

  const { data: agreement, error: agreementErr } = await supabaseAdmin
    .from('rental_agreements')
    .insert({
      agreement_number: agreementNumber,
      customer_id,
      status: 'active',
      start_date: startDate,
      expected_return_date: expected_return_date || null,
      billing_interval,
      rent_amount: Number(rent_amount),
      gst_percentage: gst_percentage ?? 18,
      payment_account,
      // one_time agreements never enter the billing cycle, so they get no next date
      // and scan_rental_cycles skips them entirely.
      next_billing_date: billing_interval === 'one_time' ? null : startDate,
      billing_reminder_lead_days: billing_reminder_lead_days ?? 3,
      security_deposit_amount: Number(security_deposit_amount) || 0,
      deposit_payment_account: deposit_payment_account || null,
      deposit_received_at: deposit_received ? new Date().toISOString() : null,
      notes: notes || null,
      created_by: sessionUser.id,
    })
    .select('id, agreement_number')
    .single()

  if (agreementErr) return NextResponse.json({ error: agreementErr.message }, { status: 500 })

  // No DB transactions in this codebase -- hand over each unit in turn and unwind in
  // reverse on the first failure, the same convention POST /api/sales-entry uses.
  const handedOver: Array<{ assetId: string; priorStatus: string; skuId: string }> = []
  for (const assetId of asset_ids) {
    const result = await handOverUnit(assetId, agreement.agreement_number, sessionUser.id)
    if (result.error) {
      for (const done of handedOver.reverse()) {
        await supabaseAdmin.from('asset_ledger').update({ status: done.priorStatus }).eq('id', done.assetId)
        await supabaseAdmin.from('stock_movements').insert({
          sku_id: done.skuId, movement_type: 'adjustment', quantity_change: 1,
          notes: `Rental ${agreement.agreement_number} rolled back`, created_by: sessionUser.id,
        })
      }
      await supabaseAdmin.from('rental_agreement_items').delete().eq('agreement_id', agreement.id)
      await supabaseAdmin.from('rental_agreements').delete().eq('id', agreement.id)
      return NextResponse.json({ error: result.error }, { status: result.status || 400 })
    }

    const { error: itemErr } = await supabaseAdmin.from('rental_agreement_items').insert({
      agreement_id: agreement.id,
      asset_id: assetId,
      item_status: 'on_rent',
    })
    if (itemErr) {
      await supabaseAdmin.from('asset_ledger').update({ status: result.priorStatus! }).eq('id', assetId)
      await supabaseAdmin.from('stock_movements').insert({
        sku_id: result.skuId!, movement_type: 'adjustment', quantity_change: 1,
        notes: `Rental ${agreement.agreement_number} rolled back`, created_by: sessionUser.id,
      })
      for (const done of handedOver.reverse()) {
        await supabaseAdmin.from('asset_ledger').update({ status: done.priorStatus }).eq('id', done.assetId)
        await supabaseAdmin.from('stock_movements').insert({
          sku_id: done.skuId, movement_type: 'adjustment', quantity_change: 1,
          notes: `Rental ${agreement.agreement_number} rolled back`, created_by: sessionUser.id,
        })
      }
      await supabaseAdmin.from('rental_agreement_items').delete().eq('agreement_id', agreement.id)
      await supabaseAdmin.from('rental_agreements').delete().eq('id', agreement.id)
      return NextResponse.json({ error: itemErr.message }, { status: 500 })
    }

    handedOver.push({ assetId, priorStatus: result.priorStatus!, skuId: result.skuId! })
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'rentals',
    tableName: 'rental_agreements',
    recordId: agreement.id,
    recordLabel: agreement.agreement_number,
    metadata: { unit_count: asset_ids.length, billing_interval },
  })

  return NextResponse.json(
    { success: true, id: agreement.id, agreement_number: agreement.agreement_number },
    { status: 201 }
  )
}

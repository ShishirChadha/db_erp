import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { parsePagination } from '@/lib/pagination'
import { withRetry } from '@/lib/db-retry'

// Website orders, for the owner.
//
// Owner-only rather than page-key-gated, following /dashboard/monitoring's
// reasoning: the content here is revenue (orders.total_amount), customer PII
// (shipping_address holds name, phone and address) and payment identifiers,
// and there is no partial view of that worth granting to anyone else. The
// existing `website` key is NOT reused -- that is a SKU publish/photo
// capability, and widening it would silently hand revenue visibility to
// anyone given photo-upload rights.
//
// This closes a gap both docs/current-progress.md and docs/decisions.md
// recorded: until now a paid web order was indistinguishable from an in-store
// sale in the ERP except for sold_by='Website', and the "paid but stock may be
// gone" reconciliation case had no surface at all.

const SORT_COLUMNS: Record<string, string> = {
  created_at: 'created_at',
  paid_at: 'paid_at',
  total_amount: 'total_amount',
  status: 'status',
}

// orders.customer_id points at customer_profiles.id (= auth.users.id), NOT at
// customers.id -- so the display name is two hops out through the CRM link.
const SELECT = `
  id, customer_id, status, total_amount, discount_amount, shipping_address,
  razorpay_order_id, razorpay_payment_id, created_at, paid_at,
  cancel_reason, conversion_error, conversion_failed_at, applied_promotion_ids,
  order_items (
    id, sku_id, quantity, unit_price, title_snapshot, erp_sale_id,
    is_promotional_gift, selected_upgrades,
    web_reservations (
      id, asset_id, quantity, previous_asset_status,
      expires_at, released_at, release_reason, created_at
    )
  ),
  customer_profiles ( id, full_name, phone, created_at, customers ( id, customer_name ) )
`

// "Money was taken and the ERP never recorded the sale." Derived rather than
// stored, so it can never drift from the actual order_items.
function needsReconciliation(o: any): boolean {
  return o.status === 'paid' && (o.order_items || []).some((i: any) => !i.erp_sale_id)
}

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const queryErrors: string[] = []

  // ---------- stat cards ----------
  if (sp.get('counts') === 'true') {
    const countOf = async (build: (q: any) => any) => {
      const { count, error } = await withRetry<any>(() =>
        build(supabaseAdmin.from('orders').select('id', { count: 'exact', head: true }))
      )
      if (error) queryErrors.push(error.message)
      return count || 0
    }
    const [total, paid, pending, cancelled, expired] = await Promise.all([
      countOf((q: any) => q),
      countOf((q: any) => q.eq('status', 'paid')),
      countOf((q: any) => q.eq('status', 'pending_payment')),
      countOf((q: any) => q.eq('status', 'cancelled')),
      countOf((q: any) => q.eq('status', 'expired')),
    ])

    // Reconciliation can't be a PostgREST count -- it needs "an order_item
    // lacking erp_sale_id" -- so it's derived from the paid rows.
    const { data: paidRows, error: paidErr } = await withRetry(() =>
      supabaseAdmin.from('orders').select('id, status, order_items(erp_sale_id)').eq('status', 'paid')
    )
    if (paidErr) queryErrors.push(paidErr.message)
    const needs = (paidRows || []).filter(needsReconciliation).length

    return NextResponse.json({
      total, paid, pending_payment: pending, cancelled, expired,
      needs_reconciliation: needs,
      queryErrors,
    })
  }

  // ---------- list ----------
  const pagination = parsePagination(sp)
  const sortKey = sp.get('sort') || 'created_at'
  const asc = sp.get('dir') === 'asc'

  let query = supabaseAdmin.from('orders').select(SELECT, pagination ? { count: 'exact' } : undefined)

  const status = sp.get('status')
  if (status) query = query.eq('status', status)
  const from = sp.get('from')
  const to = sp.get('to')
  if (from) query = query.gte('created_at', from)
  if (to) query = query.lte('created_at', `${to}T23:59:59.999Z`)

  // Date column first and newest-first by default, per the house list rule.
  // orders has no updated_at, so created_at is also the tiebreak.
  query = query.order(SORT_COLUMNS[sortKey] || 'created_at', { ascending: asc, nullsFirst: false })
  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data, error, count } = await withRetry(() => query)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let rows = (data || []).map((o: any) => ({
    ...o,
    needs_reconciliation: needsReconciliation(o),
    customer_name: o.customer_profiles?.customers?.customer_name ?? o.customer_profiles?.full_name ?? null,
    customer_phone: o.customer_profiles?.phone ?? null,
  }))

  // Applied after the fetch because it is a derived predicate, not a column.
  // Note this filters within the page rather than across the whole table --
  // acceptable only because the reconciliation count in `counts` is computed
  // over every paid order, so the stat card is still accurate.
  if (sp.get('flag') === 'needs_reconciliation') {
    rows = rows.filter((o: any) => o.needs_reconciliation)
  }

  // Reported explicitly rather than letting a failure read as "no orders".
  if (pagination) return NextResponse.json({ data: rows, total: count ?? 0, queryErrors })
  return NextResponse.json(rows)
}

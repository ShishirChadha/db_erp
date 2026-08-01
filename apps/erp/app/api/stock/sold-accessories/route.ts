import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { parsePagination } from '@/lib/pagination'

// ---------- GET: sold accessories ----------
// Read-only list of standalone accessory sales (sales.accessory_id set, no asset_ledger
// row -- accessories are fungible sku_master rows, never per-unit tracked, see
// CLAUDE.md). Employee-visible counterpart to the "Sold Stock" tab on the Stock page,
// which only ever shows asset_ledger-backed unit sales because it's built entirely on
// that table. Same access gate as the rest of /api/stock -- deliberately NOT the
// owner-only Sales ledger (/api/sales), and read-only (no invoice/payment actions here).
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, ['live_stock', 'new_entry', 'invoices'])) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')
  const pagination = parsePagination(searchParams, 20)

  let query = supabaseAdmin
    .from('sales')
    .select(
      'id, sale_date, customer_name, accessory_id, accessory_quantity, sale_total, payment_status, amount_paid, payment_account, sold_by, finalized, invoice_number, created_at',
      pagination ? { count: 'exact' } : undefined
    )
    .not('accessory_id', 'is', null)
    .eq('is_deleted', false)
    .order('sale_date', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })

  if (search) {
    const { data: matchingSkus } = await supabaseAdmin
      .from('sku_master')
      .select('id')
      .or(`full_sku_code.ilike.%${search}%,sku_description.ilike.%${search}%,brand.ilike.%${search}%,model_name.ilike.%${search}%`)
    const skuIds = (matchingSkus || []).map((s) => s.id)
    const orClauses = [`customer_name.ilike.%${search}%`, `invoice_number.ilike.%${search}%`]
    if (skuIds.length > 0) orClauses.push(`accessory_id.in.(${skuIds.join(',')})`)
    query = query.or(orClauses.join(','))
  }

  // Month/Year filter on sale_date -- same year-anchors-month convention as /api/stock.
  const yearParam = searchParams.get('year')
  const year = yearParam ? parseInt(yearParam, 10) : NaN
  if (!Number.isNaN(year)) {
    const monthParam = searchParams.get('month')
    const month = monthParam ? parseInt(monthParam, 10) : null
    const from = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
    const toYear = month ? (month === 12 ? year + 1 : year) : year + 1
    const toMonth = month ? (month === 12 ? 1 : month + 1) : 1
    const to = `${toYear}-${String(toMonth).padStart(2, '0')}-01`
    query = query.gte('sale_date', from).lt('sale_date', to)
  }

  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data: sales, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // SKU info (name/code) via a separate lookup rather than an embedded join or
  // selecting base_cost -- employee-facing routes shouldn't select cost columns at
  // all (see lib/auth/redact.ts convention) rather than fetch-then-redact them.
  const skuIds = [...new Set((sales || []).map((s: any) => s.accessory_id).filter(Boolean))]
  const { data: skus } = skuIds.length
    ? await supabaseAdmin.from('sku_master').select('id, full_sku_code, sku_description, category').in('id', skuIds)
    : { data: [] as any[] }
  const skuById = new Map((skus || []).map((s: any) => [s.id, s]))

  const result = (sales || []).map((s: any) => {
    const sku = skuById.get(s.accessory_id)
    return {
      id: s.id,
      sale_date: s.sale_date,
      customer_name: s.customer_name,
      full_sku_code: sku?.full_sku_code || '',
      sku_description: sku?.sku_description || '',
      category: sku?.category || null,
      accessory_quantity: s.accessory_quantity,
      sale_total: s.sale_total,
      payment_status: s.payment_status,
      amount_paid: s.amount_paid,
      payment_account: s.payment_account,
      sold_by: s.sold_by,
      finalized: s.finalized,
      invoice_number: s.invoice_number,
      created_at: s.created_at,
    }
  })

  if (pagination) return NextResponse.json({ data: result, total: count ?? 0 })
  return NextResponse.json(result)
}

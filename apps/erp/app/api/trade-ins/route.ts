import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { parsePagination } from '@/lib/pagination'
import { createTradeIn } from '@/lib/trade-ins'
import { withRetry } from '@/lib/db-retry'

// Trade-ins: a customer's old laptop taken back as part-payment on a sale. See
// lib/trade-ins.ts for what happens to the unit, the sale and the cost.

// Whoever can record a payment on a sale can take a trade-in against it -- the
// person at the counter agreeing the value is the one entering it (same
// "immediately real" rule as the sale itself). Undo is owner-only ([id] DELETE).
const SELL_PAGES = ['live_stock', 'new_entry', 'sales']

const LIST_SELECT = `
  id, trade_in_number, trade_in_date, value, payment_account, was_our_unit, condition_notes,
  accessories_included, created_at, voided_at, void_reason, sale_id, entered_by,
  customers(customer_name, phone),
  asset:asset_ledger!trade_ins_asset_id_fkey(id, serial_number, asset_number, status,
    sku_master!purchase_order_asset_mapping_sku_id_fkey(sku_description)),
  sale:sales!trade_ins_sale_id_fkey(id, sale_date, sale_total, is_deleted, asset_ledger_id, accessory_id),
  entered:profiles!trade_ins_entered_by_fkey(full_name)
`

// ---------- GET: the trade-ins list (or one sale's trade-ins with ?sale_id=) ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const saleId = searchParams.get('sale_id')
  // One sale's trade-ins show on that sale (Sales Ledger) -- the same people who
  // already see its 'Trade-in' payment row. The full list is its own page.
  if (!hasPageAccess(sessionUser, saleId ? [...SELL_PAGES, 'trade_ins'] : 'trade_ins')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const pagination = parsePagination(searchParams)
  let query = supabaseAdmin.from('trade_ins').select(LIST_SELECT, pagination ? { count: 'exact' } : undefined)
    .order('trade_in_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (saleId) query = query.eq('sale_id', saleId)
  const q = searchParams.get('q')?.trim()
  if (q) query = query.ilike('trade_in_number', `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
  if (searchParams.get('include_void') !== 'true') query = query.is('voided_at', null)
  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data, error, count } = await withRetry(() => query)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // What the trade-in was settled against: the new unit sold on that sale.
  const rows = (data || []) as any[]
  const saleAssetIds = [...new Set(rows.map((r) => r.sale?.asset_ledger_id).filter(Boolean))]
  const saleUnits = new Map<string, { serial_number: string | null; description: string | null }>()
  if (saleAssetIds.length) {
    const { data: units } = await supabaseAdmin.from('asset_ledger')
      .select('id, serial_number, sku_master!purchase_order_asset_mapping_sku_id_fkey(sku_description)').in('id', saleAssetIds)
    for (const u of (units || []) as any[]) saleUnits.set(u.id, { serial_number: u.serial_number, description: u.sku_master?.sku_description ?? null })
  }
  const result = rows.map((r) => ({
    ...r,
    sale: r.sale ? { ...r.sale, unit: r.sale.asset_ledger_id ? saleUnits.get(r.sale.asset_ledger_id) ?? null : null } : null,
  }))
  if (pagination) return NextResponse.json({ data: result, total: count ?? 0 })
  return NextResponse.json(result)
}

// ---------- POST: take a trade-in against a sale ----------
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, SELL_PAGES)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body?.sale_id) return NextResponse.json({ error: 'sale_id is required.' }, { status: 400 })

  const result = await createTradeIn(body, { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role })
  if (!result.ok) return NextResponse.json({ error: result.error, error_code: result.error_code }, { status: result.status })
  return NextResponse.json({ success: true, id: result.id, trade_in_number: result.trade_in_number }, { status: 201 })
}

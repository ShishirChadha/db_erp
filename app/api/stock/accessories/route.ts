import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, isOwner } from '@/lib/auth/session'
import { parsePagination } from '@/lib/pagination'
import { NON_SERIALIZED_CATEGORIES } from '@/lib/sku-categories'
import { getLastVendorsBySku } from '@/lib/purchase-utils'

// ---------- GET: current (in-stock) accessories ----------
// Counterpart to /api/stock/sold-accessories, for the main Stock page's new
// "Accessories" tab -- accessories have no asset_ledger row, so they're otherwise
// entirely invisible from that page. Cost + last vendor are owner-only (never
// selected for other roles, per lib/auth/redact.ts's convention), everything else
// (name, category, brand, qty, selling price) is visible to anyone with stock access,
// same as the rest of /api/stock.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, ['live_stock', 'new_entry', 'invoices'])) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')
  const pagination = parsePagination(searchParams, 20)
  const owner = isOwner(sessionUser)

  const baseColumns = 'id, full_sku_code, sku_description, category, brand, model_name, quantity_in_stock, selling_price_default'
  let query = supabaseAdmin
    .from('sku_master')
    .select(owner ? `${baseColumns}, base_cost` : baseColumns, pagination ? { count: 'exact' } : undefined)
    .in('category', NON_SERIALIZED_CATEGORIES)
    .eq('status', 'active')
    .gt('quantity_in_stock', 0)
    .order('full_sku_code')

  if (search) {
    query = query.or(`full_sku_code.ilike.%${search}%,sku_description.ilike.%${search}%,brand.ilike.%${search}%,model_name.ilike.%${search}%`)
  }
  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data: skus, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // "Needs PO" backlog + last vendor are owner-only, cheap to derive alongside since
  // this list is already small (in-stock accessories only, paginated).
  let backlogBySkuId = new Map<string, number>()
  let lastVendorBySkuId = new Map<string, string>()
  if (owner && skus && skus.length > 0) {
    const skuIds = skus.map((s: any) => s.id)

    const { data: unattached } = await supabaseAdmin
      .from('stock_movements')
      .select('sku_id, quantity_change')
      .in('sku_id', skuIds)
      .eq('movement_type', 'receipt')
      .is('po_id', null)
    for (const m of unattached || []) {
      backlogBySkuId.set(m.sku_id, (backlogBySkuId.get(m.sku_id) || 0) + m.quantity_change)
    }

    lastVendorBySkuId = await getLastVendorsBySku(skuIds)
  }

  const result = (skus || []).map((s: any) => ({
    ...s,
    needs_po_qty: owner ? (backlogBySkuId.get(s.id) || 0) : undefined,
    last_vendor: owner ? (lastVendorBySkuId.get(s.id) || null) : undefined,
  }))

  if (pagination) return NextResponse.json({ data: result, total: count ?? 0 })
  return NextResponse.json(result)
}

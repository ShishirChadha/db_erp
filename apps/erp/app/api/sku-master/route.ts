import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { resolveOrCreateSku } from '@/lib/sku-resolver'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { redactForRole, redactManyForRole } from '@/lib/auth/redact'
import { parsePagination } from '@/lib/pagination'
import { logAuditEvent } from '@/lib/audit-log'
import { isSerializedCategory } from '@/lib/sku-categories'

// Used by SKU Master, PO wizard's inline SKU search (owner-only page), Sell's
// Fix-SKU/Change-SKU picker, and the Accessories page/Sell's accessory picker (which
// query this filtered to the non-serialized categories -- see `category` param) --
// gate on any of the page keys that legitimately read from this catalog.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, ['sku_master', 'new_entry', 'accessories'])) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')
  const latestForModel = searchParams.get('latest_for_model')
  const category = searchParams.get('category') // comma-separated, optional
  const excludeCategory = searchParams.get('exclude_category') // comma-separated, optional
  const id = searchParams.get('id')
  const statusFilter = searchParams.get('status') // optional -- 'all' to include archived/discontinued, defaults to 'active' only
  const publishedFilter = searchParams.get('is_published') // 'true' | 'false', optional
  const stockFilter = searchParams.get('stock_filter') // 'out_of_stock' | 'low_stock', optional
  const wantCounts = searchParams.get('counts') === 'true'

  // Shared by both the counts request and the main list -- search/category are
  // filter *context* every tab respects, unlike status/is_published/stock_filter
  // which are what the tabs themselves switch between.
  const applySharedFilters = (q: any) => {
    if (search) q = q.or(`full_sku_code.ilike.%${search}%,sku_description.ilike.%${search}%`)
    if (category) {
      const categories = category.split(',').map((c: string) => c.trim()).filter(Boolean)
      q = categories.length > 1 ? q.in('category', categories) : q.eq('category', categories[0])
    }
    if (excludeCategory) {
      const categories = excludeCategory.split(',').map((c: string) => c.trim()).filter(Boolean)
      if (categories.length > 0) q = q.not('category', 'in', `(${categories.join(',')})`)
    }
    return q
  }

  // quantity_in_stock vs reorder_level is a column-to-column comparison, which
  // PostgREST's query-string filters can't express directly -- fetch the thin
  // id/quantity/reorder_level slice (no cost/spec data) and filter in JS instead.
  const getLowStockIds = async () => {
    let q = supabaseAdmin.from('sku_master').select('id, quantity_in_stock, reorder_level').eq('status', 'active')
    q = applySharedFilters(q)
    const { data } = await q
    return (data || [])
      .filter((r) => (r.quantity_in_stock ?? 0) > 0 && (r.quantity_in_stock ?? 0) <= (r.reorder_level ?? 0))
      .map((r) => r.id)
  }

  if (wantCounts) {
    const countQuery = (build: (q: any) => any) => build(applySharedFilters(supabaseAdmin.from('sku_master').select('id', { count: 'exact', head: true })))
    const [all, published, unpublished, discontinued, archived, lowStockIds] = await Promise.all([
      countQuery((q) => q.eq('status', 'active')),
      countQuery((q) => q.eq('status', 'active').eq('is_published', true)),
      countQuery((q) => q.eq('status', 'active').or('is_published.eq.false,is_published.is.null')),
      countQuery((q) => q.eq('status', 'discontinued')),
      countQuery((q) => q.eq('status', 'archived')),
      getLowStockIds(),
    ])
    const outOfStock = await countQuery((q) => q.eq('status', 'active').lte('quantity_in_stock', 0))
    return NextResponse.json({
      all: all.count ?? 0,
      published: published.count ?? 0,
      unpublished: unpublished.count ?? 0,
      out_of_stock: outOfStock.count ?? 0,
      low_stock: lowStockIds.length,
      discontinued: discontinued.count ?? 0,
      archived: archived.count ?? 0,
    })
  }

  // Used by New Entry's Stock Intake form to prefill CPU/RAM/SSD/etc. from whatever
  // spec combination was last recorded for this exact brand+model, so a repeatedly
  // purchased model doesn't need every field re-picked by hand each time -- still
  // fully editable afterward, this is just a starting point.
  if (latestForModel) {
    let latestQuery = supabaseAdmin
      .from('sku_master')
      .select('specifications')
      .eq('status', 'active')
      .eq('model_name', latestForModel)
      .order('created_at', { ascending: false })
      .limit(1)
    if (category) latestQuery = latestQuery.eq('category', category)

    const { data: latest, error: latestErr } = await latestQuery
    if (latestErr) return NextResponse.json({ error: latestErr.message }, { status: 400 })
    return NextResponse.json(latest?.[0]?.specifications || null)
  }

  const pagination = parsePagination(searchParams)
  let query = supabaseAdmin
    .from('sku_master')
    .select('*', pagination ? { count: 'exact' } : undefined)
    .order('full_sku_code')
  if (statusFilter && statusFilter !== 'all') {
    query = query.eq('status', statusFilter)
  } else if (!statusFilter) {
    query = query.eq('status', 'active')
  }

  if (search) {
    query = query.or(`full_sku_code.ilike.%${search}%,sku_description.ilike.%${search}%`)
  }
  if (category) {
    const categories = category.split(',').map((c) => c.trim()).filter(Boolean)
    query = categories.length > 1 ? query.in('category', categories) : query.eq('category', categories[0])
  }
  if (excludeCategory) {
    // Used by the PO wizard's SKU picker to hide fungible/quantity-only categories --
    // POST /api/purchase-orders/[id]/submit mints one asset_ledger row per unit of
    // quantity for every line item regardless of category, which is only correct for
    // serialized items. Accessory purchasing goes through the dedicated deferred-PO
    // flow (/api/purchase-orders/from-accessory-stock) instead.
    const categories = excludeCategory.split(',').map((c) => c.trim()).filter(Boolean)
    if (categories.length > 0) query = query.not('category', 'in', `(${categories.join(',')})`)
  }
  if (publishedFilter === 'true') {
    query = query.eq('is_published', true)
  } else if (publishedFilter === 'false') {
    query = query.or('is_published.eq.false,is_published.is.null')
  }
  if (stockFilter === 'out_of_stock') {
    query = query.lte('quantity_in_stock', 0)
  } else if (stockFilter === 'low_stock') {
    const lowStockIds = await getLowStockIds()
    query = query.in('id', lowStockIds.length > 0 ? lowStockIds : ['00000000-0000-0000-0000-000000000000'])
  }
  if (id) {
    query = query.eq('id', id)
  }
  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data, error, count } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  const redacted = await redactManyForRole(data || [], 'sku_master', sessionUser.role)

  // Sold count -- only computed for the paginated SKU Master list (the picker/search
  // callers of this same route don't display it and shouldn't pay for the extra
  // queries). Serialized categories (laptops/desktops/monitors/tablets) track sales
  // per-unit via asset_ledger.status='sold'; fungible categories (accessories) have
  // no asset_ledger rows at all and are tracked via stock_movements movement_type='sale'.
  if (pagination && data && data.length > 0) {
    const serializedIds = data.filter((r) => isSerializedCategory(r.category)).map((r) => r.id)
    const fungibleIds = data.filter((r) => !isSerializedCategory(r.category)).map((r) => r.id)

    const [soldAssets, saleMovements] = await Promise.all([
      serializedIds.length > 0
        ? supabaseAdmin.from('asset_ledger').select('sku_id').in('sku_id', serializedIds).eq('status', 'sold')
        : Promise.resolve({ data: [] as { sku_id: string }[] }),
      fungibleIds.length > 0
        ? supabaseAdmin.from('stock_movements').select('sku_id, quantity_change').in('sku_id', fungibleIds).eq('movement_type', 'sale')
        : Promise.resolve({ data: [] as { sku_id: string; quantity_change: number }[] }),
    ])

    const soldCountBySkuId = new Map<string, number>()
    for (const row of soldAssets.data || []) {
      soldCountBySkuId.set(row.sku_id, (soldCountBySkuId.get(row.sku_id) || 0) + 1)
    }
    for (const row of saleMovements.data || []) {
      soldCountBySkuId.set(row.sku_id, (soldCountBySkuId.get(row.sku_id) || 0) + Math.max(0, -row.quantity_change))
    }
    for (const row of redacted) {
      row.sold_count = soldCountBySkuId.get(row.id) || 0
    }
  }

  if (pagination) return NextResponse.json({ data: redacted, total: count ?? 0 })
  return NextResponse.json(redacted)
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, ['sku_master', 'new_entry'])) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const {
    category,
    item_type,
    brand,
    model_name,
    specifications,
    selling_price_default,
    reorder_level = 5,
  } = body
  // base_cost is owner-only data -- an employee-submitted value is silently ignored
  // rather than trusted from the request body.
  const base_cost = sessionUser.role === 'owner' ? body.base_cost : undefined

  let result
  try {
    result = await resolveOrCreateSku({
      category,
      item_type,
      brand,
      model_name,
      specifications: specifications || {},
      base_cost,
      selling_price_default,
      reorder_level,
      sku_description: body.sku_description,
      hsn_code: body.hsn_code,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }

  const sku = await redactForRole(result.sku, 'sku_master', sessionUser.role)
  if (!result.created) {
    return NextResponse.json(
      { sku, message: 'Exact match found, returning existing variant' },
      { status: 200 }
    )
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'sku_master',
    tableName: 'sku_master',
    recordId: result.sku.id,
    recordLabel: result.sku.full_sku_code,
  })

  return NextResponse.json(
    { sku, message: 'New variant created', possible_duplicates: result.possibleDuplicates },
    { status: 201 }
  )
}
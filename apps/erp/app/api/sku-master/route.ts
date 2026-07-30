import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { resolveOrCreateSku } from '@/lib/sku-resolver'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { redactForRole, redactManyForRole } from '@/lib/auth/redact'
import { parsePagination } from '@/lib/pagination'

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
  if (id) {
    query = query.eq('id', id)
  }
  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data, error, count } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  const redacted = redactManyForRole(data || [], 'sku_master', sessionUser.role)
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

  const sku = redactForRole(result.sku, 'sku_master', sessionUser.role)
  if (!result.created) {
    return NextResponse.json(
      { sku, message: 'Exact match found, returning existing variant' },
      { status: 200 }
    )
  }
  return NextResponse.json(
    { sku, message: 'New variant created', possible_duplicates: result.possibleDuplicates },
    { status: 201 }
  )
}
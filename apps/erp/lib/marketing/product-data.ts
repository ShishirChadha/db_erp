import { supabaseAdmin } from '@/lib/supabase/service'
import { buildConfigSummary, isSerializedCategory } from '@db/shared'
import { cpuSortKey, compareCpuSortKey } from './cpu-sort'

// Grounding data source for the marketing content generator. Deliberately reads from
// the `public_products` VIEW -- the exact same anon-safe view the storefront itself
// queries -- rather than `sku_master` directly. base_cost/vendor_id/margin columns
// are structurally not selectable through this view, so a generated post cannot leak
// them no matter what the prompt asks for. The consequence (only *published* SKUs can
// be promoted) is intentional: promoting an unpublished SKU would send traffic to a
// dead link. See CLAUDE.md's "E-commerce website" section for the view's own guarantees.

export interface MarketingProduct {
  id: string
  web_slug: string
  full_sku_code: string
  category: string
  item_type: string
  brand: string | null
  model_name: string | null
  specifications: Record<string, any> | null
  web_title: string | null
  web_description: string | null
  web_highlights: string[] | null
  web_condition_grade: string | null
  web_price: number
  market_price: number | null
  availability_bucket: 'in_stock' | 'low_stock' | 'sold_out'
  primary_image_path: string | null
  published_at: string | null
  config_summary: string
  display_title: string
  percent_off: number | null
  // Only set by findInStockProducts's grouping -- total quantity behind this one
  // broadcast line, when several otherwise-identical sku_master rows (same brand/
  // model/specifications) were collapsed into it. Undefined everywhere else.
  available_count?: number
  // Category-driven spec line for whatsapp-template.ts's non-laptop/desktop bullet
  // (Monitor, Accessory, RAM, etc.) -- see buildMarketingConfigDiff below. Excludes
  // screen_size/model_year too, since templateTitle() already folds those into the
  // header generically for whichever category actually has those exact field names
  // (e.g. Tablet's screen_size), not just laptops.
  config_diff: string
}

const PRODUCT_COLUMNS =
  'id, web_slug, full_sku_code, category, item_type, brand, model_name, specifications, web_title, web_description, web_highlights, web_condition_grade, web_price, market_price, availability_bucket, primary_image_path, published_at'

// A marketing-local variant of packages/shared's buildConfigDiff -- same per-field
// walk over a category's real field_schema, but also excludes 'item_name' (ACC/OTHER's
// identifying-name field, folded into whatsapp-template.ts's templateTitle() the same
// way brand/model already are) so it doesn't get duplicated into the spec bullet below
// its own header. Kept local rather than changing the shared helper, which several other
// pages (Stock, SKU Master, sibling-configs, the storefront) rely on with today's
// brand/model-only exclusion.
const MARKETING_DIFF_EXCLUDED_FIELDS = new Set(['brand', 'model', 'item_name', 'screen_size', 'model_year'])

function buildMarketingConfigDiff(
  category: string | null | undefined,
  specifications: Record<string, any> | null | undefined,
  templates: { category: string; field_schema: any }[]
): string {
  const specs = specifications || {}
  const template = templates.find((t) => t.category === category)
  if (!template) return ''
  const schema = typeof template.field_schema === 'string' ? JSON.parse(template.field_schema) : template.field_schema
  const fields: { name: string; label?: string }[] = schema?.fields || []

  const parts: string[] = []
  for (const field of fields) {
    if (MARKETING_DIFF_EXCLUDED_FIELDS.has(field.name)) continue
    const value = specs[field.name]
    if (value === undefined || value === null || value === '') continue
    if (typeof value === 'boolean') {
      if (value) parts.push(field.label || field.name)
      continue
    }
    parts.push(field.name === 'screen_size' ? `${value}"` : String(value))
  }
  return parts.join(' / ')
}

async function decorate(rows: any[]): Promise<MarketingProduct[]> {
  if (rows.length === 0) return []
  const categories = [...new Set(rows.map((r) => r.category))]
  const { data: templates } = await supabaseAdmin
    .from('sku_category_templates')
    .select('category, field_schema')
    .in('category', categories)

  return rows.map((r) => {
    const configSummary = buildConfigSummary(r.category, r.specifications, templates || [])
    const configDiff = buildMarketingConfigDiff(r.category, r.specifications, templates || [])
    const displayTitle = r.web_title || configSummary || [r.brand, r.model_name].filter(Boolean).join(' ')
    const percentOff =
      r.market_price && r.market_price > r.web_price
        ? Math.round(((r.market_price - r.web_price) / r.market_price) * 100)
        : null
    return { ...r, config_summary: configSummary, config_diff: configDiff, display_title: displayTitle, percent_off: percentOff }
  })
}

export async function getPublishedProductById(id: string): Promise<MarketingProduct | null> {
  const { data, error } = await supabaseAdmin.from('public_products').select(PRODUCT_COLUMNS).eq('id', id).maybeSingle()
  if (error || !data) return null
  return (await decorate([data]))[0]
}

export interface ProductFilter {
  category?: string
  brand?: string // matches sku_master.brand directly, not specifications.brand -- guaranteed
                  // present for every category, unlike a jsonb spec key that varies by template
  spec?: Record<string, string> // e.g. { cpu: 'i5', ram: '8' } -- combined with brand/category via AND, same as this function's other filters
  priceMax?: number
  priceMin?: number
  inStockOnly?: boolean
  limit?: number
  // findInStockProducts only: restrict to exactly these SKU ids (e.g. "generate a
  // broadcast for just the items I hand-picked in Today's Picks"), combined via AND
  // with every other filter above.
  skuIds?: string[]
  // findInStockProducts only: case-insensitive substring match against brand, model
  // name, full SKU code, or specifications.item_name -- the free-text product search
  // used by the Single Product tab's picker.
  search?: string
}

// Filtered in application code rather than via PostgREST query-string filters on the
// view -- the published catalogue is small (low hundreds of rows) and this avoids
// re-deriving the spec-field ILIKE-clause-building logic from /api/stock and
// /api/sku-master a third time for a single-digit-ms cost. If the catalogue grows
// large enough for this to matter, push `spec`/price filters into the query the same
// way getSpecFieldNames() does for those two routes.
export async function findPublishedProducts(filter: ProductFilter): Promise<MarketingProduct[]> {
  let query = supabaseAdmin.from('public_products').select(PRODUCT_COLUMNS).order('published_at', { ascending: false })
  if (filter.category) query = query.eq('category', filter.category)
  const { data, error } = await query
  if (error) throw new Error(error.message)

  let rows = data || []
  if (filter.brand) {
    rows = rows.filter((r) => (r.brand || '').toLowerCase() === filter.brand!.toLowerCase())
  }
  if (filter.spec) {
    for (const [field, value] of Object.entries(filter.spec)) {
      rows = rows.filter((r) => String(r.specifications?.[field] ?? '').toLowerCase() === value.toLowerCase())
    }
  }
  if (filter.priceMax != null) rows = rows.filter((r) => (r.web_price ?? 0) <= filter.priceMax!)
  if (filter.priceMin != null) rows = rows.filter((r) => (r.web_price ?? 0) >= filter.priceMin!)
  if (filter.inStockOnly) rows = rows.filter((r) => r.availability_bucket !== 'sold_out')
  if (filter.limit) rows = rows.slice(0, filter.limit)

  return decorate(rows)
}

const SKU_MASTER_SAFE_COLUMNS =
  'id, full_sku_code, category, item_type, brand, model_name, specifications, web_slug, web_title, web_description, web_highlights, web_condition_grade, quantity_in_stock, selling_price_default, published_at'

// Mirrors StockView.tsx's own CURRENT_STATUSES exactly -- the definition of "not sold /
// still current" that Live Stock's default tab and stat cards use. Duplicated here
// (rather than imported) since it's a UI-layer constant in a client component; kept in
// sync manually -- if that list changes, this one should too.
const LIVE_STOCK_CURRENT_STATUSES = ['draft', 'reserved', 'received', 'in_stock', 'qc_pending', 'qc_passed', 'ready_for_sale', 'faulty', 'rma_sent', 'rma_returned']

// Every in-stock SKU for a category, published or not -- used only by the WhatsApp
// Product List broadcast (mode=product_list), never by single_product/blog. That
// broadcast promotes real current inventory to an existing contact list rather than
// driving traffic to the website (the template carries no product links -- see
// whatsapp-template.ts), so gating it to *published* SKUs the way findPublishedProducts
// does hid most of what's actually in stock -- an owner-reported gap: with category=LAP
// and no other filter, only 6 of 71 in-stock laptop SKUs were published, so "all
// laptops in stock" showed almost nothing.
//
// Deliberately selects an explicit safe column list from sku_master directly rather
// than select('*') -- cost_price/vendor_id/margin are simply never fetched, the same
// "don't select a column a role shouldn't see" convention CLAUDE.md asks for, rather
// than fetch-then-redact (and correct regardless of who's calling: canEditPage('marketing')
// can be granted to an employee, and this module has no separate cost gate of its own).
export async function findInStockProducts(filter: ProductFilter): Promise<MarketingProduct[]> {
  let query = supabaseAdmin.from('sku_master').select(SKU_MASTER_SAFE_COLUMNS).eq('status', 'active')
  if (filter.category) query = query.eq('category', filter.category)
  const { data, error } = await query
  if (error) throw new Error(error.message)

  let rows = data || []
  if (filter.skuIds) {
    const idSet = new Set(filter.skuIds)
    rows = rows.filter((r) => idSet.has(r.id))
  }
  if (filter.brand) {
    rows = rows.filter((r) => (r.brand || '').toLowerCase() === filter.brand!.toLowerCase())
  }
  if (filter.spec) {
    for (const [field, value] of Object.entries(filter.spec)) {
      rows = rows.filter((r) => String(r.specifications?.[field] ?? '').toLowerCase() === value.toLowerCase())
    }
  }
  if (filter.search) {
    const q = filter.search.toLowerCase()
    rows = rows.filter((r) =>
      (r.brand || '').toLowerCase().includes(q) ||
      (r.model_name || '').toLowerCase().includes(q) ||
      (r.full_sku_code || '').toLowerCase().includes(q) ||
      String(r.specifications?.item_name ?? '').toLowerCase().includes(q)
    )
  }

  // "In stock" here must mean what the owner's own Live Stock page shows, not the
  // sku_master.quantity_in_stock cache -- that cache sums units from every source
  // (legacy_purchase, purchase_order, employee_intake), but Live Stock deliberately
  // shows only source='employee_intake' units (see CLAUDE.md / StockView.tsx's
  // sourceMode split). Real example that surfaced this: "Apple 1466 13.3\"" showed in a
  // broadcast with quantity_in_stock=2, but both of its units were legacy_purchase, so
  // it never appeared on Live Stock -- genuinely in stock, just the wrong page to check
  // it against. Non-serialized (fungible/ACC) categories have no such split -- Live
  // Stock's own Accessories tab already reads quantity_in_stock directly with no source
  // filter -- so only serialized rows get overridden here.
  const serializedIds = new Set(rows.filter((r) => isSerializedCategory(r.category)).map((r) => r.id))
  const liveQtyBySkuId = new Map<string, number>()
  if (serializedIds.size > 0) {
    const idList = [...serializedIds].join(',')
    const { data: units } = await supabaseAdmin
      .from('asset_ledger')
      .select('sku_id, current_sku_id')
      .eq('source', 'employee_intake')
      .in('status', LIVE_STOCK_CURRENT_STATUSES)
      .or(`sku_id.in.(${idList}),current_sku_id.in.(${idList})`)
    for (const u of units || []) {
      // A unit's *current* SKU (after any spec correction) is current_sku_id when set,
      // else its original sku_id -- the same precedence /api/stock's own row display uses.
      const effectiveId = u.current_sku_id || u.sku_id
      if (!serializedIds.has(effectiveId)) continue
      liveQtyBySkuId.set(effectiveId, (liveQtyBySkuId.get(effectiveId) || 0) + 1)
    }
  }
  rows = rows.map((r) => ({
    ...r,
    quantity_in_stock: serializedIds.has(r.id) ? (liveQtyBySkuId.get(r.id) || 0) : (r.quantity_in_stock ?? 0),
  }))

  if (filter.inStockOnly !== false) rows = rows.filter((r) => (r.quantity_in_stock ?? 0) > 0)

  // Collapse otherwise-identical rows (same brand/model/specifications) into one
  // broadcast line carrying the summed quantity -- real inventory here has several
  // sku_master rows for what reads as the exact same laptop (separate purchase
  // batches / data entry), which without this reads as literal repeated blocks in a
  // WhatsApp list (an owner-reported duplicate-entries complaint), and grouping also
  // directly shortens a long list the same way the owner asked for.
  const groups = new Map<string, { rep: (typeof rows)[number]; qty: number }>()
  for (const r of rows) {
    // Empty-string/null/undefined values are treated as "field not set" -- real data has
    // both a bare-absent key and a present-but-empty key (e.g. model_year) for what is
    // otherwise the same config, which without this normalization produced two separate
    // groups (and two identical-looking broadcast blocks) for what's really one config.
    const specKey = Object.entries(r.specifications || {})
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(',')
    const key = `${(r.brand || '').toLowerCase()}|${(r.model_name || '').toLowerCase()}|${specKey}`
    const existing = groups.get(key)
    if (existing) existing.qty += r.quantity_in_stock ?? 0
    else groups.set(key, { rep: r, qty: r.quantity_in_stock ?? 0 })
  }
  let grouped = Array.from(groups.values())

  // Brand, then CPU tier + generation (i3 ascending, then i5, then i7, then i9 -- same
  // ranking whatsapp-template.ts's buildProductListWhatsAppMessage uses for the
  // generated message itself, via the shared cpu-sort.ts), then model -- so Today's
  // Picks' browse grid is already in the same order the broadcast it produces will be,
  // and is deterministic (unlike findPublishedProducts' published_at ordering, which
  // this query has no equivalent signal for since most rows here were never published).
  grouped.sort((a, b) => {
    const brandCmp = (a.rep.brand || '').localeCompare(b.rep.brand || '')
    if (brandCmp) return brandCmp
    const cpuCmp = compareCpuSortKey(cpuSortKey(a.rep.specifications), cpuSortKey(b.rep.specifications))
    if (cpuCmp) return cpuCmp
    return (a.rep.model_name || '').localeCompare(b.rep.model_name || '')
  })

  if (filter.limit) grouped = grouped.slice(0, filter.limit)

  // Real primary photo per SKU (Today's Picks needs an actual thumbnail to browse/pick
  // from, not just a "has a photo" boolean) -- reads product_images directly rather than
  // the public_product_images view, since that view is publish-gated (confirmed: an
  // unpublished SKU's real photos return zero rows through it) and this function
  // deliberately isn't publish-gated.
  const primaryPhotoBySkuId = await getPrimaryImagePathsBySkuIds(grouped.map(({ rep }) => rep.id))

  const normalized = grouped.map(({ rep: r, qty }) => ({
    ...r,
    web_slug: r.web_slug || '',
    market_price: null,
    // Unpublished SKUs have no web_price -- fall back to the same selling price an
    // employee already sees elsewhere in the ERP (CLAUDE.md: selling price is never
    // redacted by role), so price-sorted views of this data (if any) still work.
    web_price: r.selling_price_default ?? 0,
    availability_bucket: (qty > 0 ? 'in_stock' : 'sold_out') as MarketingProduct['availability_bucket'],
    primary_image_path: primaryPhotoBySkuId.get(r.id) || null,
    available_count: qty,
  }))
  return decorate(normalized)
}

// Batch version of getProductImagePaths' "primary photo" -- one query for many SKUs
// instead of N, used by findInStockProducts (Today's Picks/Product List browsing) and
// the multi-item collage endpoint. Not publish-gated (reads product_images directly).
export async function getPrimaryImagePathsBySkuIds(skuIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (skuIds.length === 0) return result
  const { data } = await supabaseAdmin
    .from('product_images')
    .select('sku_id, storage_path, is_primary, sort_order')
    .in('sku_id', skuIds)
    .order('is_primary', { ascending: false })
    .order('sort_order', { ascending: true })
  for (const row of data || []) {
    if (!result.has(row.sku_id)) result.set(row.sku_id, row.storage_path)
  }
  return result
}

// Single-SKU counterpart to findInStockProducts -- for the Single Product tab and
// Today's Picks' per-item "Generate WhatsApp" action, which need to fetch and generate
// content for one specific, currently-in-stock item regardless of website-publish
// status (WhatsApp's own template carries no product link, so publishing isn't a
// prerequisite the way it is for Instagram/Facebook/Google Business Profile -- see
// generate/route.ts). Returns null if the SKU isn't genuinely in current (live) stock.
export async function getInStockProductById(id: string): Promise<MarketingProduct | null> {
  const results = await findInStockProducts({ skuIds: [id] })
  return results[0] || null
}

export interface RepresentativeUnit {
  battery_health_percent: number | null
  warranty_duration_months: number | null
  warranty_type: string | null
}

// One real sellable unit's per-unit facts (battery health, warranty) for a serialized
// SKU -- these live on asset_ledger, not sku_master, so a WhatsApp template promoting
// "this SKU" needs a representative unit to pull them from. Most-recently-QC'd unit is
// used as the representative; returns nulls (never fabricated) when no unit has this
// data captured yet -- true for every unit in the DB as of 2026-09, since QC doesn't
// currently record battery_health_percent/warranty_duration_months anywhere.
export async function getRepresentativeUnit(skuId: string): Promise<RepresentativeUnit | null> {
  const { data } = await supabaseAdmin
    .from('public_product_units')
    .select('battery_health_percent, warranty_duration_months, warranty_type')
    .eq('sku_id', skuId)
    .order('qc_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data || null
}

// Up to `limit` photo storage paths for a SKU (primary first, then sort_order) -- reads
// the product_images table directly rather than the public_product_images view: that
// view is publish-gated (confirmed empty for an unpublished SKU's real photos), but
// card rendering now needs to work for any current-stock item, not just published ones
// (see findInStockProducts / getInStockProductById above).
export async function getProductImagePaths(skuId: string, limit = 4): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('product_images')
    .select('storage_path')
    .eq('sku_id', skuId)
    .order('is_primary', { ascending: false })
    .order('sort_order', { ascending: true })
    .limit(limit)
  return (data || []).map((r) => r.storage_path as string)
}

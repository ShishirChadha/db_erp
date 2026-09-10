import { supabaseAdmin } from '@/lib/supabase/service'
import { buildConfigSummary } from '@db/shared'

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
}

const PRODUCT_COLUMNS =
  'id, web_slug, full_sku_code, category, item_type, brand, model_name, specifications, web_title, web_description, web_highlights, web_condition_grade, web_price, market_price, availability_bucket, primary_image_path, published_at'

async function decorate(rows: any[]): Promise<MarketingProduct[]> {
  if (rows.length === 0) return []
  const categories = [...new Set(rows.map((r) => r.category))]
  const { data: templates } = await supabaseAdmin
    .from('sku_category_templates')
    .select('category, field_schema')
    .in('category', categories)

  return rows.map((r) => {
    const configSummary = buildConfigSummary(r.category, r.specifications, templates || [])
    const displayTitle = r.web_title || configSummary || [r.brand, r.model_name].filter(Boolean).join(' ')
    const percentOff =
      r.market_price && r.market_price > r.web_price
        ? Math.round(((r.market_price - r.web_price) / r.market_price) * 100)
        : null
    return { ...r, config_summary: configSummary, display_title: displayTitle, percent_off: percentOff }
  })
}

export async function getPublishedProductById(id: string): Promise<MarketingProduct | null> {
  const { data, error } = await supabaseAdmin.from('public_products').select(PRODUCT_COLUMNS).eq('id', id).maybeSingle()
  if (error || !data) return null
  return (await decorate([data]))[0]
}

export interface ProductFilter {
  category?: string
  spec?: Record<string, string> // e.g. { cpu: 'i5', ram: '8' }
  priceMax?: number
  priceMin?: number
  inStockOnly?: boolean
  limit?: number
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

// Every published product, undecorated by any filter -- the raw material the
// suggestion engine (lib/marketing/suggest.ts) buckets into today's-picks priorities.
export async function getAllPublishedProducts(): Promise<MarketingProduct[]> {
  const { data, error } = await supabaseAdmin.from('public_products').select(PRODUCT_COLUMNS).order('published_at', { ascending: false })
  if (error) throw new Error(error.message)
  return decorate(data || [])
}

// Latest real stock-receipt date per SKU -- "when did this SKU last enter stock,"
// not "when was it published." Same effective-date resolution
// (`purchase_date || created_at`) as /api/sku-master's purchasedFrom/purchasedTo
// filter (app/api/sku-master/route.ts) -- one canonical definition of "receipt date"
// reused here for the Today's Picks New Arrivals ranking, rather than a second one.
// Naturally dedupes to one date per SKU (MAX across all its receipts), so a batch of
// several identical units received on one PO collapses to a single entry, matching
// how the rest of the ERP already treats a SKU as the unit of "an item."
export async function getLatestReceiptDatesBySkuId(): Promise<Map<string, string>> {
  const { data: movements } = await supabaseAdmin
    .from('stock_movements')
    .select('sku_id, purchase_date, created_at')
    .eq('movement_type', 'receipt')
  const latest = new Map<string, string>()
  for (const m of movements || []) {
    // Full created_at timestamp (not date-sliced) so two receipts landing on the same
    // calendar day still rank deterministically by actual time -- unlike
    // /api/sku-master's purchasedFrom/purchasedTo range filter (date-granularity is
    // correct there, since it's bucketing into date ranges, not ranking). purchase_date
    // is itself a date-only column, so it naturally sorts before a same-day timestamped
    // created_at fallback, which is an acceptable, stable tie-break rule.
    const effectiveDate: string = m.purchase_date || m.created_at || ''
    if (!effectiveDate) continue
    const current = latest.get(m.sku_id)
    if (!current || effectiveDate > current) latest.set(m.sku_id, effectiveDate)
  }
  return latest
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

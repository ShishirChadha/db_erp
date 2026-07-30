import { createServerSupabaseClient } from '@db/db/server'

export interface PublicProduct {
  id: string
  web_slug: string | null
  full_sku_code: string
  category: string
  item_type: string
  brand: string | null
  model_name: string | null
  specifications: Record<string, unknown> | null
  web_title: string | null
  web_description: string | null
  web_highlights: string[] | null
  web_condition_grade: string | null
  web_price: number
  market_price: number | null
  hsn_code: string | null
  published_at: string
  availability_bucket: 'in_stock' | 'low_stock' | 'sold_out'
  primary_image_path: string | null
}

export interface PublicProductImage {
  id: string
  storage_path: string
  alt_text: string | null
  sort_order: number
  is_primary: boolean
}

export interface CategoryTemplate {
  category: string
  display_name: string
  field_schema: any
}

const PRODUCT_COLUMNS =
  'id, web_slug, full_sku_code, category, item_type, brand, model_name, specifications, web_title, web_description, web_highlights, web_condition_grade, web_price, market_price, hsn_code, published_at, availability_bucket, primary_image_path'

export async function getPublishedProducts(opts: {
  category?: string | string[]
  search?: string
  limit?: number
  excludeId?: string
} = {}): Promise<PublicProduct[]> {
  const supabase = await createServerSupabaseClient()
  let query = supabase
    .from('public_products')
    .select(PRODUCT_COLUMNS)
    .order('published_at', { ascending: false })

  if (Array.isArray(opts.category)) {
    if (opts.category.length > 0) query = query.in('category', opts.category)
  } else if (opts.category) {
    query = query.eq('category', opts.category)
  }
  if (opts.search) {
    const term = opts.search.replace(/[%_]/g, '')
    query = query.or(
      `web_title.ilike.%${term}%,brand.ilike.%${term}%,model_name.ilike.%${term}%,full_sku_code.ilike.%${term}%`
    )
  }
  if (opts.excludeId) query = query.neq('id', opts.excludeId)
  if (opts.limit) query = query.limit(opts.limit)

  const { data } = await query
  return (data ?? []) as unknown as PublicProduct[]
}

export async function getSiblingConfigurations(opts: {
  category: string
  brand: string
  modelName: string
  excludeId: string
}): Promise<PublicProduct[]> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('public_products')
    .select(PRODUCT_COLUMNS)
    .eq('category', opts.category)
    .eq('brand', opts.brand)
    .eq('model_name', opts.modelName)
    .neq('id', opts.excludeId)
    .order('web_price', { ascending: true })
  return (data ?? []) as unknown as PublicProduct[]
}

export async function getProductBySlug(slug: string): Promise<PublicProduct | null> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('public_products')
    .select(PRODUCT_COLUMNS)
    .eq('web_slug', slug)
    .maybeSingle()
  return (data as unknown as PublicProduct) ?? null
}

export async function getProductImages(skuId: string): Promise<PublicProductImage[]> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('public_product_images')
    .select('id, storage_path, alt_text, sort_order, is_primary')
    .eq('sku_id', skuId)
    .order('is_primary', { ascending: false })
    .order('sort_order', { ascending: true })
  return (data ?? []) as PublicProductImage[]
}

export async function getCategories(): Promise<CategoryTemplate[]> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.from('public_categories').select('category, display_name, field_schema')
  return (data ?? []) as CategoryTemplate[]
}

export interface BlogPost {
  id: string
  slug: string
  title: string
  excerpt: string | null
  body: string
  published_at: string | null
}

export async function getPublishedBlogPosts(): Promise<BlogPost[]> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('blog_posts')
    .select('id, slug, title, excerpt, body, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
  return (data ?? []) as BlogPost[]
}

export async function getBlogPostBySlug(slug: string): Promise<BlogPost | null> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('blog_posts')
    .select('id, slug, title, excerpt, body, published_at')
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle()
  return (data as BlogPost) ?? null
}

export interface ProductUnit {
  sku_id: string
  serial_number: string | null
  qc_grade: string | null
  qc_at: string | null
  battery_health_percent: number | null
  estimated_backup_hours: number | null
  screen_condition: string | null
  keyboard_condition: string | null
  body_condition: string | null
  included_accessories: string | null
  warranty_type: string | null
  warranty_duration_months: number | null
}

export async function getProductUnits(skuId: string): Promise<ProductUnit[]> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('public_product_units')
    .select(
      'sku_id, serial_number, qc_grade, qc_at, battery_health_percent, estimated_backup_hours, screen_condition, keyboard_condition, body_condition, included_accessories, warranty_type, warranty_duration_months'
    )
    .eq('sku_id', skuId)
  return (data ?? []) as ProductUnit[]
}

export interface TestReportItem {
  check_item: string
  result: 'pass' | 'fail' | 'na'
}

export async function getAssetTestReport(skuId: string, serialNumber: string): Promise<TestReportItem[]> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('public_asset_test_report')
    .select('check_item, result')
    .eq('sku_id', skuId)
    .eq('serial_number', serialNumber)
  return (data ?? []) as TestReportItem[]
}

export interface UpgradeOption {
  category: string
  field_name: 'ram' | 'ssd' | 'warranty_months'
  from_value: string
  to_value: string
  price_delta: number
}

// Only returns rules whose from_value matches the SKU's actual current spec
// (or, for warranty, the single unit's actual current warranty_duration_months)
// -- a unit whose spec has no configured path simply gets no upgrade option
// for that field, by design (explicit pairwise paths only, no chaining).
export async function getUpgradeOptions(opts: {
  category: string
  currentRam?: string | null
  currentSsd?: string | null
  currentWarrantyMonths?: number | null
}): Promise<UpgradeOption[]> {
  const supabase = await createServerSupabaseClient()
  const fromValues: string[] = []
  if (opts.currentRam) fromValues.push(opts.currentRam)
  if (opts.currentSsd) fromValues.push(opts.currentSsd)
  if (opts.currentWarrantyMonths != null) fromValues.push(String(opts.currentWarrantyMonths))
  if (fromValues.length === 0) return []

  const { data } = await supabase
    .from('public_upgrade_options')
    .select('category, field_name, from_value, to_value, price_delta')
    .eq('category', opts.category)
    .in('from_value', fromValues)

  return ((data ?? []) as UpgradeOption[]).filter((o) => {
    if (o.field_name === 'ram') return o.from_value === opts.currentRam
    if (o.field_name === 'ssd') return o.from_value === opts.currentSsd
    if (o.field_name === 'warranty_months') return o.from_value === String(opts.currentWarrantyMonths)
    return false
  })
}

// Owner-configured category->category mapping for "Complete your setup" --
// replaces a hardcoded category='ACC' pull. Not a "customers also bought"
// behavioral claim (this system doesn't have the sales volume for that to be
// honest yet), just an explicit merchandising rule the owner sets.
export async function getCrossSellCategories(sourceCategory: string): Promise<string[]> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('public_cross_sell_rules')
    .select('suggested_category')
    .eq('source_category', sourceCategory)
    .order('sort_order')
  return (data ?? []).map((r) => r.suggested_category)
}

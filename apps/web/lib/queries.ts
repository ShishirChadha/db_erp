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
  category?: string
  search?: string
  limit?: number
  excludeId?: string
} = {}): Promise<PublicProduct[]> {
  const supabase = await createServerSupabaseClient()
  let query = supabase
    .from('public_products')
    .select(PRODUCT_COLUMNS)
    .order('published_at', { ascending: false })

  if (opts.category) query = query.eq('category', opts.category)
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
}

export async function getProductUnits(skuId: string): Promise<ProductUnit[]> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('public_product_units')
    .select('sku_id, serial_number, qc_grade, qc_at')
    .eq('sku_id', skuId)
  return (data ?? []) as ProductUnit[]
}

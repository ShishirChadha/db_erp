import { NextRequest, NextResponse } from 'next/server'
import { createPublicSupabaseClient } from '@db/db/public'
import { productDisplayTitle } from '@/lib/product-title'

export const dynamic = 'force-dynamic'

const PRODUCT_LIMIT = 6
const SECONDARY_LIMIT = 4

// Replaces HeaderSearch.tsx's old client-direct Supabase query. Moved
// server-side so one request can feed all three tiers of the wide suggestion
// panel (products -> blog -> related/accessories) instead of the browser
// doing three separate round trips, and so the %/_ escaping below actually
// happens (the old code stripped them instead).
function escapeIlike(term: string): string {
  return term.replace(/[%_\\]/g, (c) => `\\${c}`)
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  if (q.length < 2) {
    return NextResponse.json({ products: [], blogPosts: [], related: [] })
  }

  const supabase = createPublicSupabaseClient()
  const term = escapeIlike(q)

  const { data: products } = await supabase
    .from('public_products')
    .select('id, web_slug, web_title, brand, model_name, category, web_price, primary_image_path, availability_bucket')
    .or(`web_title.ilike.%${term}%,brand.ilike.%${term}%,model_name.ilike.%${term}%,full_sku_code.ilike.%${term}%`)
    .order('published_at', { ascending: false })
    .limit(PRODUCT_LIMIT)

  const productRows = (products ?? []).map((p) => ({ ...p, display_title: productDisplayTitle(p) }))

  // Owner's tiering (2026-10-06): a strong product match doesn't need a
  // second column at all. Only when there's room does the panel fill in
  // with something else to look at.
  let blogPosts: { slug: string; title: string; excerpt: string | null }[] = []
  let related: typeof productRows = []

  if (productRows.length < 3) {
    const { data: posts } = await supabase
      .from('blog_posts')
      .select('slug, title, excerpt')
      .eq('status', 'published')
      .or(`title.ilike.%${term}%,excerpt.ilike.%${term}%`)
      .order('published_at', { ascending: false })
      .limit(SECONDARY_LIMIT)
    blogPosts = posts ?? []

    if (blogPosts.length === 0) {
      // Fall back to "similar products" -- same cross-sell categories used
      // on the product detail page's "Complete your setup", reused here
      // rather than inventing a second mechanism. If the search term didn't
      // resolve to any specific product, fall back to whatever's published
      // and in stock so the panel is never empty for an empty reason.
      const categories = Array.from(new Set(productRows.map((p) => p.category))).filter(Boolean)
      let relatedQuery = supabase
        .from('public_products')
        .select('id, web_slug, web_title, brand, model_name, category, web_price, primary_image_path, availability_bucket')
        .neq('availability_bucket', 'sold_out')
        .order('published_at', { ascending: false })
        .limit(SECONDARY_LIMIT)
      if (categories.length > 0) relatedQuery = relatedQuery.in('category', categories)
      if (productRows.length > 0) relatedQuery = relatedQuery.not('id', 'in', `(${productRows.map((p) => p.id).join(',')})`)

      const { data: relatedRows } = await relatedQuery
      related = (relatedRows ?? []).map((p) => ({ ...p, display_title: productDisplayTitle(p) }))
    }
  }

  return NextResponse.json({ products: productRows, blogPosts, related })
}

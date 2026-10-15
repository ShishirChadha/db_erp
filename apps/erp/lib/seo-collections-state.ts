import { supabaseAdmin } from '@/lib/supabase/service'
import { wordCount } from '@/lib/seo-admin'
import { filterProducts, filtersFromJson, type FilterableProduct } from '@db/shared'

// Every collection with its LIVE match counts and indexing-gate result, computed
// with the same matching code the storefront uses (@db/shared) so the ERP and the
// public page cannot disagree. Shared by the Collections screen and Suggestions.

export const CATEGORY_SLUG: Record<string, string> = { LAP: 'laptops', DES: 'desktops' }

export interface CollectionState {
  id: string
  category: string
  slug: string
  name: string
  kind: string
  status: string
  filter: Record<string, any>
  min_products: number
  min_intro_words: number
  matching: number
  available: number
  intro_words: number
  gate: { published: boolean; enough_products: boolean; enough_text: boolean }
  indexable: boolean
  url: string
  [k: string]: any
}

export async function loadCollectionsWithState(): Promise<CollectionState[]> {
  const { data: rows, error } = await supabaseAdmin.from('seo_collections').select('*').order('updated_at', { ascending: false })
  if (error) throw new Error(error.message)

  const categories = [...new Set((rows ?? []).map((r) => r.category))]
  const productsByCategory = new Map<string, FilterableProduct[]>()
  for (const category of categories) {
    const { data } = await supabaseAdmin
      .from('public_products')
      .select('brand, specifications, web_price, availability_bucket, warranty_label')
      .eq('category', category)
      .range(0, 999)
    productsByCategory.set(category, (data ?? []) as FilterableProduct[])
  }

  return (rows ?? []).map((r) => {
    const matched = filterProducts(productsByCategory.get(r.category) ?? [], filtersFromJson(r.filter))
    const available = matched.filter((p) => p.availability_bucket !== 'sold_out').length
    const words = wordCount(r.intro_md)
    const gate = {
      published: r.status === 'published',
      enough_products: available >= r.min_products,
      enough_text: words >= r.min_intro_words,
    }
    return {
      ...r,
      matching: matched.length,
      available,
      intro_words: words,
      gate,
      indexable: gate.published && gate.enough_products && gate.enough_text,
      url: `/${CATEGORY_SLUG[r.category]}/${r.slug}`,
    }
  })
}

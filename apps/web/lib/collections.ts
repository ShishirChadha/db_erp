import { cache } from 'react'
import { filterProducts, filtersFromJson } from '@db/shared'
import { createPublicSupabaseClient } from '@db/db/public'
import { getPublishedProducts, type PublicProduct } from '@/lib/queries'
import { categoryToSlug, slugToCategory } from '@/lib/categories'

// Owner-curated collection pages (ERP: Settings -> Website SEO -> Collections),
// e.g. /laptops/dell or /laptops/under-20000. The ERP stores a filter and the
// copy; this file decides, on every render, whether the page is allowed to be
// indexed. The thresholds are the owner's own settings per collection -- they
// are quality heuristics, not anything Google publishes.

export interface PublicCollection {
  category: string
  slug: string
  kind: 'brand' | 'budget' | 'spec' | 'use_case'
  name: string
  h1: string | null
  meta_title: string | null
  meta_description: string | null
  intro_md: string | null
  faq: { q: string; a: string }[]
  filter: unknown
  min_products: number
  min_intro_words: number
  updated_at: string
}

export const COLLECTION_CATEGORIES = new Set(['LAP', 'DES'])

export const getPublishedCollections = cache(async (): Promise<PublicCollection[]> => {
  try {
    const supabase = createPublicSupabaseClient()
    const { data } = await supabase
      .from('public_seo_collections')
      .select('category, slug, kind, name, h1, meta_title, meta_description, intro_md, faq, filter, min_products, min_intro_words, updated_at')
    return (data ?? []) as unknown as PublicCollection[]
  } catch {
    return []
  }
})

export function introWordCount(text: string | null | undefined): number {
  return (text ?? '').trim().split(/\s+/).filter(Boolean).length
}

export interface CollectionState {
  matching: PublicProduct[]
  available: PublicProduct[]
  words: number
  enoughProducts: boolean
  enoughText: boolean
  indexable: boolean
}

export function evaluateCollection(c: PublicCollection, categoryProducts: PublicProduct[]): CollectionState {
  const matching = filterProducts(categoryProducts, filtersFromJson(c.filter))
  const available = matching.filter((p) => p.availability_bucket !== 'sold_out')
  const words = introWordCount(c.intro_md)
  const enoughProducts = available.length >= c.min_products
  const enoughText = words >= c.min_intro_words
  return { matching, available, words, enoughProducts, enoughText, indexable: enoughProducts && enoughText }
}

export function collectionPath(c: Pick<PublicCollection, 'category' | 'slug'>): string {
  return `/${categoryToSlug(c.category)}/${c.slug}`
}

export const getCollection = cache(async (categorySlug: string, slug: string) => {
  const category = slugToCategory(categorySlug)
  if (!category || !COLLECTION_CATEGORIES.has(category)) return null
  const collection = (await getPublishedCollections()).find((c) => c.category === category && c.slug === slug)
  if (!collection) return null
  const products = await getPublishedProducts({ category })
  return { collection, category, products, state: evaluateCollection(collection, products) }
})

// Collections that currently pass their gate -- the only ones that get
// sitemap entries and "shop by" links.
export const getIndexableCollections = cache(async (): Promise<PublicCollection[]> => {
  const all = await getPublishedCollections()
  const out: PublicCollection[] = []
  for (const category of new Set(all.map((c) => c.category))) {
    const products = await getPublishedProducts({ category })
    for (const c of all.filter((x) => x.category === category)) {
      if (evaluateCollection(c, products).indexable) out.push(c)
    }
  }
  return out
})

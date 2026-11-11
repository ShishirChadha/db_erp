import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@db/db/admin'

// Pages are cached for an hour (catalogue) or a day (content), and refreshed on
// demand when the data behind them changes -- previously every page rebuilt
// once a minute on any visit, crawlers included, which used up Vercel's free
// ISR-write allowance (docs/decisions.md, 2026-11-11). revalidatePath only
// marks a page stale; it is rebuilt on its next visit, so this writes nothing
// to the cache itself.
//
// A product change also touches the home page and the category/collection
// listings that may show it. Those are invalidated by route pattern rather
// than by working out which category the SKU is in -- only the ones somebody
// visits are rebuilt.
export function revalidateProductSlugs(slugs: string[]) {
  for (const slug of new Set(slugs.filter(Boolean))) revalidatePath(`/product/${slug}`)
  revalidatePath('/')
  revalidatePath('/[categorySlug]', 'page')
  revalidatePath('/[categorySlug]/[collection]', 'page')
}

export async function revalidateProductSkus(skuIds: string[]) {
  if (skuIds.length === 0) return
  const { data } = await supabaseAdmin.from('sku_master').select('web_slug').in('id', skuIds)
  revalidateProductSlugs((data || []).map((r) => r.web_slug as string))
}

export function revalidateWholeSite() {
  revalidatePath('/', 'layout')
}

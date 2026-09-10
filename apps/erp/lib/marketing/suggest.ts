import { getAllPublishedProducts, type MarketingProduct } from './product-data'

// "What should today's WhatsApp send be?" -- a priority-ranked suggestion engine over
// the real published catalogue, per the owner's own stated priority order: P1 new
// arrivals, P2 high-end/MacBooks, P3 aging stock, P4 unique/rare configurations.
// Deliberately deterministic (no AI) -- this is a ranking over real facts (publish
// date, price, brand, config rarity), not something that benefits from generation.

export type SuggestionPriority = 'p1_new_arrivals' | 'p2_high_end' | 'p3_aging_stock' | 'p4_unique_config'

export interface SuggestionBucket {
  priority: SuggestionPriority
  label: string
  reason: string
  products: MarketingProduct[]
}

const NEW_ARRIVAL_DAYS = 7
const HIGH_END_PRICE_PERCENTILE = 0.75 // top quartile by price counts as "high-end"

function daysAgo(iso: string | null): number | null {
  if (!iso) return null
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24)
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return Infinity
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return sorted[idx]
}

export async function getTodaysPicks(limit = 6): Promise<SuggestionBucket[]> {
  const all = await getAllPublishedProducts()
  const inStock = all.filter((p) => p.availability_bucket !== 'sold_out')

  // P1 -- new arrivals: published within the last week, still in stock, newest first.
  const p1 = inStock
    .filter((p) => { const d = daysAgo(p.published_at); return d != null && d <= NEW_ARRIVAL_DAYS })
    .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''))
    .slice(0, limit)

  // P2 -- high-end / MacBooks: Apple brand, or top-quartile price among laptops/desktops.
  const lapDesPrices = inStock.filter((p) => p.category === 'LAP' || p.category === 'DES').map((p) => p.web_price)
  const highEndThreshold = percentile(lapDesPrices, HIGH_END_PRICE_PERCENTILE)
  const p2 = inStock
    .filter((p) => /apple/i.test(p.brand || '') || ((p.category === 'LAP' || p.category === 'DES') && p.web_price >= highEndThreshold))
    .sort((a, b) => b.web_price - a.web_price)
    .slice(0, limit)

  // P3 -- aging stock: still in stock, published longest ago (been listed and hasn't moved).
  const p3 = inStock
    .filter((p) => p.published_at)
    .sort((a, b) => (a.published_at || '').localeCompare(b.published_at || ''))
    .slice(0, limit)

  // P4 -- unique configuration: this exact category+brand+model+spec combination
  // appears only once across the whole published catalogue -- a genuine one-off worth
  // calling out, as opposed to one of several near-identical listings of the same model.
  const signatureCounts = new Map<string, number>()
  for (const p of inStock) {
    const sig = `${p.category}|${p.brand}|${p.model_name}|${p.config_summary}`
    signatureCounts.set(sig, (signatureCounts.get(sig) || 0) + 1)
  }
  const p4 = inStock
    .filter((p) => signatureCounts.get(`${p.category}|${p.brand}|${p.model_name}|${p.config_summary}`) === 1)
    .sort((a, b) => b.web_price - a.web_price)
    .slice(0, limit)

  return [
    { priority: 'p1_new_arrivals', label: 'New Arrivals', reason: `Published in the last ${NEW_ARRIVAL_DAYS} days`, products: p1 },
    { priority: 'p2_high_end', label: 'High-End / MacBooks', reason: 'Apple, or top-quartile priced laptop/desktop', products: p2 },
    { priority: 'p3_aging_stock', label: 'Aging Stock', reason: 'Listed the longest without selling', products: p3 },
    { priority: 'p4_unique_config', label: 'Unique Configurations', reason: 'A one-off spec combination -- not a repeat listing', products: p4 },
  ]
}

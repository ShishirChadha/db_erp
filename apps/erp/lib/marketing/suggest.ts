import { getAllPublishedProducts, getLatestReceiptDatesBySkuId, type MarketingProduct } from './product-data'

// "What should today's WhatsApp send be?" -- a priority-ranked suggestion engine over
// the real published catalogue, per the owner's own stated priority order: P1 new
// arrivals, P2 high-end/MacBooks, P3 aging stock, P4 unique/rare configurations.
// Deliberately deterministic (no AI) -- this is a ranking over real facts (stock
// receipt date, price, brand, config rarity), not something that benefits from
// generation.

export type SuggestionPriority = 'p1_new_arrivals' | 'p2_high_end' | 'p3_aging_stock' | 'p4_unique_config'

export interface SuggestionBucket {
  priority: SuggestionPriority
  label: string
  reason: string
  products: MarketingProduct[]
}

const NEW_ARRIVALS_LIMIT = 8
const NEW_TAG_DAYS = 7 // just a "New" badge threshold, not a filter -- P1 never goes empty
const HIGH_END_PRICE_PERCENTILE = 0.75 // top quartile by price counts as "high-end"

function percentile(values: number[], p: number): number {
  if (values.length === 0) return Infinity
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return sorted[idx]
}

export async function getTodaysPicks(limit = 6): Promise<SuggestionBucket[]> {
  const [all, receiptDates] = await Promise.all([getAllPublishedProducts(), getLatestReceiptDatesBySkuId()])
  const inStock = all.filter((p) => p.availability_bucket !== 'sold_out')

  // P1 -- new arrivals: ranked by when the SKU last actually received stock (not
  // publish date), one entry per SKU by construction -- a batch of several identical
  // units on one PO is a single receipt-date entry, matching how the rest of the ERP
  // already treats a SKU as the unit of "an item." Never empty as long as some
  // published, in-stock SKU has ever received stock -- no hard recency cutoff.
  const p1 = inStock
    .filter((p) => receiptDates.has(p.id))
    .sort((a, b) => (receiptDates.get(b.id) || '').localeCompare(receiptDates.get(a.id) || ''))
    .slice(0, NEW_ARRIVALS_LIMIT)
    .map((p) => ({ ...p, received_at: receiptDates.get(p.id) || null }))

  // P2 -- high-end / MacBooks: Apple brand, or top-quartile price among laptops/desktops.
  const lapDesPrices = inStock.filter((p) => p.category === 'LAP' || p.category === 'DES').map((p) => p.web_price)
  const highEndThreshold = percentile(lapDesPrices, HIGH_END_PRICE_PERCENTILE)
  const p2 = inStock
    .filter((p) => /apple/i.test(p.brand || '') || ((p.category === 'LAP' || p.category === 'DES') && p.web_price >= highEndThreshold))
    .sort((a, b) => b.web_price - a.web_price)
    .slice(0, limit)

  // P3 -- aging stock: still in stock, received longest ago (been sitting the longest
  // without moving) -- same receipt-date source as P1, sorted the opposite direction.
  const p3 = inStock
    .filter((p) => receiptDates.has(p.id))
    .sort((a, b) => (receiptDates.get(a.id) || '').localeCompare(receiptDates.get(b.id) || ''))
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
    { priority: 'p1_new_arrivals', label: 'New Arrivals', reason: `Most recently received into stock (${NEW_TAG_DAYS}-day "New" tag)`, products: p1 },
    { priority: 'p2_high_end', label: 'High-End / MacBooks', reason: 'Apple, or top-quartile priced laptop/desktop', products: p2 },
    { priority: 'p3_aging_stock', label: 'Aging Stock', reason: 'Received the longest ago and still unsold', products: p3 },
    { priority: 'p4_unique_config', label: 'Unique Configurations', reason: 'A one-off spec combination -- not a repeat listing', products: p4 },
  ]
}

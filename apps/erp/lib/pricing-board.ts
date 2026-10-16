import { supabaseAdmin } from '@/lib/supabase/service'
import { SELLABLE_STATUSES } from '@/lib/sales-entry'
import { DEFAULT_RULES, isUndercut, suggestForAging, suggestFromCompetitor, type PricingRules, type Suggestion } from '@/lib/pricing'
import { isExactVariant, modelMatch, parseTitle, skuConfig, MODEL_THRESHOLD, type Config } from '@/lib/competitor-prices/parse'

export const BOARD_CATEGORIES = ['LAP', 'DES']
const DAY_MS = 86_400_000

export interface VariantView {
  listing_key: string
  variant_label: string
  ram_gb: number | null
  ssd_gb: number | null
  warranty_months: number | null
  condition: string | null
  price: number
  in_stock: boolean
  /** same RAM and SSD as ours, and warranty at least 6 months: a like-for-like price */
  exact: boolean
}

export interface ProductMatch {
  competitor_id: string
  competitor: string
  product_key: string
  title: string
  url: string | null
  score: number
  /** owner pressed "This model" */
  forced: boolean
  /** owner pressed "Not this model" */
  hidden: boolean
  variants: VariantView[]
}

export interface PriceRef {
  competitor: string
  price: number
  variant_label: string
  warranty_months: number | null
  url: string | null
  title: string
}

export interface BoardRow {
  id: string
  full_sku_code: string
  category: string
  brand: string | null
  model_name: string | null
  sku_description: string | null
  specifications: Record<string, unknown> | null
  is_published: boolean
  price: number | null
  prices_differ: boolean
  market_price: number | null
  cost: number | null
  available: number
  oldest_age_days: number | null
  /** cheapest in-stock like-for-like variant (same RAM + SSD): drives Undercut and suggestions */
  exact_min: PriceRef | null
  /** cheapest in-stock variant of the same model, any RAM/SSD: reference only */
  model_low: PriceRef | null
  matched_products: number
  undercut: boolean
  suggestion: (Suggestion & { source: 'competitor' | 'aging' }) | null
}

interface IndexedProduct {
  competitor_id: string
  competitor: string
  product_key: string
  title: string
  url: string | null
  brand: string | null
  tokens: string[]
  cpu: string | null
  generation: number | null
  variants: { listing_key: string; variant_label: string; ram_gb: number | null; ssd_gb: number | null; warranty_months: number | null; condition: string | null; price: number; in_stock: boolean; url: string | null }[]
}

export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

export async function loadRules(): Promise<PricingRules> {
  const { data } = await supabaseAdmin.from('pricing_settings').select('*').eq('id', true).maybeSingle()
  if (!data) return DEFAULT_RULES
  return {
    min_margin_pct: Number(data.min_margin_pct),
    aging_days: Number(data.aging_days),
    undercut_tolerance: Number(data.undercut_tolerance),
    beat_by: Number(data.beat_by),
    rounding: data.rounding,
    aging_drop_pct: Number(data.aging_drop_pct),
  }
}

export interface CompetitorInfo {
  id: string
  label: string
  base_url: string
  price_source: string | null
  price_enabled: boolean
  last_price_check_at: string | null
  last_price_check_note: string | null
  listings: number
}

async function loadMarketData() {
  const [competitorsRes, listings, links] = await Promise.all([
    supabaseAdmin.from('seo_competitors').select('id, label, base_url, price_source, price_enabled, last_price_check_at, last_price_check_note').eq('is_self', false).order('label'),
    fetchAll<any>((a, b) => supabaseAdmin.from('competitor_listings')
      .select('competitor_id, product_key, listing_key, title, url, brand, cpu, generation, ram_gb, ssd_gb, warranty_months, condition, variant_label, price, in_stock')
      .range(a, b)),
    fetchAll<any>((a, b) => supabaseAdmin.from('competitor_price_links').select('sku_id, competitor_id, listing_key, status').like('listing_key', 'product:%').range(a, b)),
  ])
  const competitors = (competitorsRes.data || []) as any[]
  const active = new Map(competitors.filter((c) => c.price_enabled).map((c) => [c.id as string, c.label as string]))

  const products = new Map<string, IndexedProduct>()
  const counts = new Map<string, number>()
  for (const l of listings) {
    counts.set(l.competitor_id, (counts.get(l.competitor_id) || 0) + 1)
    if (!active.has(l.competitor_id) || !l.product_key) continue
    const key = `${l.competitor_id}|${l.product_key}`
    let p = products.get(key)
    if (!p) {
      p = {
        competitor_id: l.competitor_id, competitor: active.get(l.competitor_id)!, product_key: l.product_key, title: l.title, url: l.url,
        brand: l.brand, tokens: parseTitle(l.title).modelTokens, cpu: l.cpu, generation: l.generation != null ? Number(l.generation) : null, variants: [],
      }
      products.set(key, p)
    }
    p.variants.push({
      listing_key: l.listing_key, variant_label: l.variant_label || 'Standard', ram_gb: l.ram_gb, ssd_gb: l.ssd_gb,
      warranty_months: l.warranty_months, condition: l.condition, price: Number(l.price), in_stock: !!l.in_stock, url: l.url,
    })
  }
  const linkMap = new Map<string, string>() // sku|competitor|product:<key> -> status
  for (const l of links) linkMap.set(`${l.sku_id}|${l.competitor_id}|${l.listing_key}`, l.status)
  return { competitors, counts, products: [...products.values()], linkMap }
}

/** Competitor products that are the same model as `ours`, with every variant, exact ones flagged. */
export function matchProducts(skuId: string, ours: Config, products: IndexedProduct[], linkMap: Map<string, string>): ProductMatch[] {
  const out: ProductMatch[] = []
  for (const p of products) {
    const status = linkMap.get(`${skuId}|${p.competitor_id}|product:${p.product_key}`)
    const score = modelMatch(ours, { brand: p.brand, modelTokens: p.tokens, cpu: p.cpu, generation: p.generation, ramGb: null, ssdGb: null }).score
    const forced = status === 'confirmed'
    const hidden = status === 'rejected'
    if (!forced && !hidden && score < MODEL_THRESHOLD) continue
    out.push({
      competitor_id: p.competitor_id, competitor: p.competitor, product_key: p.product_key, title: p.title, url: p.url, score, forced, hidden,
      variants: p.variants
        .map((v) => ({
          listing_key: v.listing_key, variant_label: v.variant_label, ram_gb: v.ram_gb, ssd_gb: v.ssd_gb, warranty_months: v.warranty_months,
          condition: v.condition, price: v.price, in_stock: v.in_stock,
          exact: isExactVariant(ours, { ramGb: v.ram_gb, ssdGb: v.ssd_gb, warrantyMonths: v.warranty_months }),
        }))
        .sort((a, b) => Number(b.exact) - Number(a.exact) || a.price - b.price),
    })
  }
  return out
}

function cheapest(matches: ProductMatch[], pred: (v: VariantView) => boolean): PriceRef | null {
  let best: PriceRef | null = null
  for (const m of matches) {
    if (m.hidden) continue
    for (const v of m.variants) {
      if (!v.in_stock || !pred(v)) continue
      if (!best || v.price < best.price) best = { competitor: m.competitor, price: v.price, variant_label: v.variant_label, warranty_months: v.warranty_months, url: m.url, title: m.title }
    }
  }
  return best
}

export function summarize(matches: ProductMatch[]) {
  return { exact_min: cheapest(matches, (v) => v.exact), model_low: cheapest(matches, () => true) }
}

export async function loadBoard(): Promise<{
  rules: PricingRules
  rows: BoardRow[]
  competitors: CompetitorInfo[]
  last_batch: { batch_id: string; changed_at: string; count: number } | null
}> {
  const rules = await loadRules()

  const [skus, units, market, lastChanges] = await Promise.all([
    fetchAll<any>((a, b) => supabaseAdmin.from('sku_master')
      .select('id, full_sku_code, category, brand, model_name, sku_description, specifications, is_published, web_price, selling_price_default, market_price, base_cost, quantity_in_stock')
      .in('category', BOARD_CATEGORIES).eq('status', 'active').range(a, b)),
    fetchAll<any>((a, b) => supabaseAdmin.from('asset_ledger')
      .select('sku_id, current_sku_id, cost_price, received_at, created_at')
      .in('status', SELLABLE_STATUSES).is('deleted_at', null).range(a, b)),
    loadMarketData(),
    supabaseAdmin.from('sku_price_changes').select('batch_id, changed_at, reason, undone_at').order('changed_at', { ascending: false }).limit(300),
  ])

  const unitBySku = new Map<string, { n: number; costSum: number; costN: number; oldest: number }>()
  for (const u of units) {
    const id = u.current_sku_id || u.sku_id
    const e = unitBySku.get(id) || { n: 0, costSum: 0, costN: 0, oldest: Infinity }
    e.n++
    if (u.cost_price != null && Number(u.cost_price) > 0) { e.costSum += Number(u.cost_price); e.costN++ }
    const t = new Date(u.received_at || u.created_at).getTime()
    if (Number.isFinite(t) && t < e.oldest) e.oldest = t
    unitBySku.set(id, e)
  }

  const now = Date.now()
  const rows: BoardRow[] = []
  for (const s of skus) {
    const unit = unitBySku.get(s.id)
    if (!s.is_published && !unit) continue

    const price = s.web_price != null ? Number(s.web_price) : s.selling_price_default != null ? Number(s.selling_price_default) : null
    const cost = unit && unit.costN ? Math.round(unit.costSum / unit.costN) : s.base_cost != null && Number(s.base_cost) > 0 ? Number(s.base_cost) : null
    const ageDays = unit && Number.isFinite(unit.oldest) ? Math.floor((now - unit.oldest) / DAY_MS) : null

    const matches = matchProducts(s.id, skuConfig(s), market.products, market.linkMap).filter((m) => !m.hidden)
    const { exact_min, model_low } = summarize(matches)
    const undercut = isUndercut(price, exact_min?.price ?? null, rules.undercut_tolerance)

    let suggestion: BoardRow['suggestion'] = null
    if (undercut && exact_min) {
      const sg = suggestFromCompetitor(price, cost, { label: exact_min.competitor, price: exact_min.price, warrantyMonths: exact_min.warranty_months }, rules)
      if (sg) suggestion = { ...sg, source: 'competitor' }
    }
    if (!suggestion && ageDays != null) {
      const sg = suggestForAging(price, cost, ageDays, rules)
      if (sg) suggestion = { ...sg, source: 'aging' }
    }

    rows.push({
      id: s.id, full_sku_code: s.full_sku_code, category: s.category, brand: s.brand, model_name: s.model_name,
      sku_description: s.sku_description, specifications: s.specifications, is_published: !!s.is_published,
      price, prices_differ: s.web_price != null && s.selling_price_default != null && Number(s.web_price) !== Number(s.selling_price_default),
      market_price: s.market_price != null ? Number(s.market_price) : null, cost,
      available: unit?.n ?? 0, oldest_age_days: ageDays, exact_min, model_low, matched_products: matches.length, undercut, suggestion,
    })
  }

  let last_batch: { batch_id: string; changed_at: string; count: number } | null = null
  const changes = lastChanges.data || []
  const first = changes.find((c: any) => c.reason !== 'undo' && !c.undone_at)
  if (first) {
    last_batch = { batch_id: first.batch_id, changed_at: first.changed_at, count: changes.filter((c: any) => c.batch_id === first.batch_id && !c.undone_at).length }
  }

  return {
    rules,
    rows,
    competitors: market.competitors.map((c: any) => ({ ...c, listings: market.counts.get(c.id) || 0 })),
    last_batch,
  }
}

/** Everything competitors sell that is the same model as one SKU, for the detail pane. */
export async function loadMarket(skuId: string) {
  const [{ data: sku }, market] = await Promise.all([
    supabaseAdmin.from('sku_master').select('id, full_sku_code, brand, model_name, specifications, web_price, selling_price_default').eq('id', skuId).maybeSingle(),
    loadMarketData(),
  ])
  if (!sku) return null
  const cfg = skuConfig(sku)
  const price = sku.web_price != null ? Number(sku.web_price) : sku.selling_price_default != null ? Number(sku.selling_price_default) : null
  const matches = matchProducts(sku.id, cfg, market.products, market.linkMap)
  const visible = matches.filter((m) => !m.hidden)
  const { exact_min, model_low } = summarize(visible)
  const inStock = visible.flatMap((m) => m.variants.filter((v) => v.in_stock).map((v) => v.price))
  return {
    price,
    ours: { ram_gb: cfg.ramGb, ssd_gb: cfg.ssdGb },
    exact_min, model_low,
    range: inStock.length ? { min: Math.min(...inStock), max: Math.max(...inStock) } : null,
    competitor_count: new Set(visible.map((m) => m.competitor_id)).size,
    variant_count: visible.reduce((n, m) => n + m.variants.length, 0),
    products: matches.sort((a, b) => a.competitor.localeCompare(b.competitor) || b.score - a.score),
    competitors: market.competitors.map((c: any) => ({ id: c.id, label: c.label, price_enabled: c.price_enabled, last_price_check_at: c.last_price_check_at, listings: market.counts.get(c.id) || 0 })),
  }
}

/** Average cost of sellable units per SKU (fallback: sku_master.base_cost). Owner-only data. */
export async function loadCostMap(skuIds: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>()
  if (skuIds.length === 0) return out
  const idList = skuIds.join(',')
  const [skus, units] = await Promise.all([
    fetchAll<any>((a, b) => supabaseAdmin.from('sku_master').select('id, base_cost').in('id', skuIds).range(a, b)),
    fetchAll<any>((a, b) => supabaseAdmin.from('asset_ledger').select('sku_id, current_sku_id, cost_price')
      .or(`sku_id.in.(${idList}),current_sku_id.in.(${idList})`).in('status', SELLABLE_STATUSES).is('deleted_at', null).range(a, b)),
  ])
  const sums = new Map<string, { s: number; n: number }>()
  for (const u of units) {
    const id = u.current_sku_id || u.sku_id
    if (u.cost_price == null || Number(u.cost_price) <= 0) continue
    const e = sums.get(id) || { s: 0, n: 0 }
    e.s += Number(u.cost_price); e.n++
    sums.set(id, e)
  }
  for (const s of skus) {
    const e = sums.get(s.id)
    out.set(s.id, e && e.n ? Math.round(e.s / e.n) : s.base_cost != null && Number(s.base_cost) > 0 ? Number(s.base_cost) : null)
  }
  return out
}

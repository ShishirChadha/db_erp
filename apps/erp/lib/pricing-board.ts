import { supabaseAdmin } from '@/lib/supabase/service'
import { SELLABLE_STATUSES } from '@/lib/sales-entry'
import { DEFAULT_RULES, isUndercut, suggestForAging, suggestFromCompetitor, type PricingRules, type Suggestion } from '@/lib/pricing'
import { matchScore, skuConfig, parseTitle, SIMILAR_THRESHOLD, SUGGEST_THRESHOLD } from '@/lib/competitor-prices/parse'

export const BOARD_CATEGORIES = ['LAP', 'DES']
const DAY_MS = 86_400_000

export interface CompetitorMatch {
  competitor_id: string
  competitor: string
  listing_key: string
  title: string
  url: string | null
  price: number
  in_stock: boolean
  warranty_months: number | null
  score: number
  /** confirmed = owner confirmed; suggested = exact config match; similar = same model, different RAM/SSD */
  kind: 'confirmed' | 'suggested' | 'similar'
  notes: string[]
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
  matches: CompetitorMatch[]
  comparable_min: CompetitorMatch | null
  undercut: boolean
  suggestion: (Suggestion & { source: 'competitor' | 'aging' }) | null
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

export async function loadBoard(): Promise<{
  rules: PricingRules
  rows: BoardRow[]
  competitors: { id: string; label: string; base_url: string; last_checked: string | null; listings: number }[]
  last_batch: { batch_id: string; changed_at: string; count: number } | null
}> {
  const rules = await loadRules()

  const [skus, units, competitors, listings, links, lastChanges] = await Promise.all([
    fetchAll<any>((a, b) => supabaseAdmin.from('sku_master')
      .select('id, full_sku_code, category, brand, model_name, sku_description, specifications, is_published, web_price, selling_price_default, market_price, base_cost, quantity_in_stock')
      .in('category', BOARD_CATEGORIES).eq('status', 'active').range(a, b)),
    fetchAll<any>((a, b) => supabaseAdmin.from('asset_ledger')
      .select('sku_id, current_sku_id, cost_price, received_at, created_at')
      .in('status', SELLABLE_STATUSES).is('deleted_at', null).range(a, b)),
    supabaseAdmin.from('seo_competitors').select('id, label, base_url').eq('is_self', false).order('label'),
    fetchAll<any>((a, b) => supabaseAdmin.from('competitor_listings').select('*').range(a, b)),
    fetchAll<any>((a, b) => supabaseAdmin.from('competitor_price_links').select('sku_id, competitor_id, listing_key, status').range(a, b)),
    supabaseAdmin.from('sku_price_changes').select('batch_id, changed_at, reason, undone_at').order('changed_at', { ascending: false }).limit(300),
  ])

  // per-SKU unit facts (a unit's SKU may be overridden by current_sku_id)
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

  const compList = competitors.data || []
  const compLabel = new Map(compList.map((c: any) => [c.id, c.label as string]))
  const linkMap = new Map<string, string>() // sku|competitor|listing -> status
  for (const l of links) linkMap.set(`${l.sku_id}|${l.competitor_id}|${l.listing_key}`, l.status)

  // Parse each competitor listing's model tokens once.
  const parsed = listings.map((l: any) => ({ l, tokens: parseTitle(l.title).modelTokens }))

  const now = Date.now()
  const rows: BoardRow[] = []
  for (const s of skus) {
    const unit = unitBySku.get(s.id)
    if (!s.is_published && !unit) continue // not for sale and nothing in stock: not a repricing candidate

    const price = s.web_price != null ? Number(s.web_price) : s.selling_price_default != null ? Number(s.selling_price_default) : null
    const cost = unit && unit.costN ? Math.round(unit.costSum / unit.costN) : s.base_cost != null && Number(s.base_cost) > 0 ? Number(s.base_cost) : null
    const ageDays = unit && Number.isFinite(unit.oldest) ? Math.floor((now - unit.oldest) / DAY_MS) : null

    const ours = skuConfig(s)
    const matches: CompetitorMatch[] = []
    for (const { l, tokens } of parsed) {
      const status = linkMap.get(`${s.id}|${l.competitor_id}|${l.listing_key}`)
      if (status === 'rejected') continue
      const m = matchScore(ours, { brand: l.brand, modelTokens: tokens, cpu: l.cpu, generation: l.generation, ramGb: l.ram_gb, ssdGb: l.ssd_gb })
      const confirmed = status === 'confirmed'
      if (!confirmed && m.score < SIMILAR_THRESHOLD) continue
      const kind: CompetitorMatch['kind'] = confirmed ? 'confirmed' : m.exact && m.score >= SUGGEST_THRESHOLD ? 'suggested' : 'similar'
      matches.push({
        competitor_id: l.competitor_id, competitor: compLabel.get(l.competitor_id) || 'Competitor',
        listing_key: l.listing_key, title: l.title, url: l.url, price: Number(l.price), in_stock: !!l.in_stock,
        warranty_months: l.warranty_months, score: m.score, kind, notes: m.reasons,
      })
    }
    // keep the three best per competitor: confirmed first, then closest score, then cheapest
    const rank = { confirmed: 0, suggested: 1, similar: 2 }
    matches.sort((a, b) => rank[a.kind] - rank[b.kind] || b.score - a.score || a.price - b.price)
    const perComp = new Map<string, number>()
    const kept = matches.filter((m) => {
      const n = perComp.get(m.competitor_id) || 0
      perComp.set(m.competitor_id, n + 1)
      return n < 3
    })

    // Comparable = confirmed or exact-config matches that are in stock. Similar ones never trigger alerts.
    const comparable = kept.filter((m) => m.in_stock && (m.kind === 'confirmed' || m.kind === 'suggested')).sort((a, b) => a.price - b.price)[0] || null
    const undercut = isUndercut(price, comparable?.price ?? null, rules.undercut_tolerance)

    let suggestion: BoardRow['suggestion'] = null
    if (undercut && comparable) {
      const sg = suggestFromCompetitor(price, cost, { label: comparable.competitor, price: comparable.price, warrantyMonths: comparable.warranty_months }, rules)
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
      available: unit?.n ?? 0, oldest_age_days: ageDays, matches: kept, comparable_min: comparable, undercut, suggestion,
    })
  }

  const lastChecked = new Map<string, string>()
  const listingCount = new Map<string, number>()
  for (const l of listings) {
    listingCount.set(l.competitor_id, (listingCount.get(l.competitor_id) || 0) + 1)
    if (!lastChecked.get(l.competitor_id) || l.fetched_at > (lastChecked.get(l.competitor_id) as string)) lastChecked.set(l.competitor_id, l.fetched_at)
  }

  // Most recent batch that can still be undone (a batch of undo rows is not itself undoable).
  let last_batch: { batch_id: string; changed_at: string; count: number } | null = null
  const changes = lastChanges.data || []
  const first = changes.find((c: any) => c.reason !== 'undo' && !c.undone_at)
  if (first) {
    last_batch = { batch_id: first.batch_id, changed_at: first.changed_at, count: changes.filter((c: any) => c.batch_id === first.batch_id && !c.undone_at).length }
  }

  return {
    rules,
    rows,
    competitors: compList.map((c: any) => ({ id: c.id, label: c.label, base_url: c.base_url, last_checked: lastChecked.get(c.id) || null, listings: listingCount.get(c.id) || 0 })),
    last_batch,
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

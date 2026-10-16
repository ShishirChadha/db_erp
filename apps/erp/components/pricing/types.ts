import type { PricingRules } from '@/lib/pricing'

export type { PricingRules }

export interface PriceRef {
  competitor: string
  price: number
  variant_label: string
  warranty_months: number | null
  url: string | null
  title: string
}

export interface VariantView {
  listing_key: string
  variant_label: string
  ram_gb: number | null
  ssd_gb: number | null
  warranty_months: number | null
  condition: string | null
  price: number
  in_stock: boolean
  exact: boolean
}

export interface ProductMatch {
  competitor_id: string
  competitor: string
  product_key: string
  title: string
  url: string | null
  score: number
  forced: boolean
  hidden: boolean
  variants: VariantView[]
}

export interface MarketData {
  price: number | null
  ours: { ram_gb: number | null; ssd_gb: number | null }
  exact_min: PriceRef | null
  model_low: PriceRef | null
  range: { min: number; max: number } | null
  competitor_count: number
  variant_count: number
  products: ProductMatch[]
  competitors: { id: string; label: string; price_enabled: boolean; last_price_check_at: string | null; listings: number }[]
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
  exact_min: PriceRef | null
  model_low: PriceRef | null
  matched_products: number
  undercut: boolean
  suggestion: { price: number; reason: string; limitedByMargin: boolean; source: 'competitor' | 'aging' } | null
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

export interface BoardData {
  rules: PricingRules
  rows: BoardRow[]
  competitors: CompetitorInfo[]
  last_batch: { batch_id: string; changed_at: string; count: number } | null
}

export const inr = (n: number | null | undefined) => (n == null ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`)

export function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

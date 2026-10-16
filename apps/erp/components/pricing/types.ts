import type { PricingRules } from '@/lib/pricing'

export type { PricingRules }

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
  suggestion: { price: number; reason: string; limitedByMargin: boolean; source: 'competitor' | 'aging' } | null
}

export interface BoardData {
  rules: PricingRules
  rows: BoardRow[]
  competitors: { id: string; label: string; base_url: string; last_checked: string | null; listings: number }[]
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

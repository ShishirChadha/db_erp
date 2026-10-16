// lib/pricing.ts
// Pure margin-calculator math for the Price Cockpit (app/dashboard/pricing) -- no
// margin/markup helper existed anywhere in the codebase before this. Kept deliberately
// framework-free (no Supabase, no auth) so it's trivially unit-testable and reusable
// anywhere a cost->price or price->margin conversion is needed.
//
// Two ways resellers reason about the same number, both surfaced side by side in the
// cockpit so there's never ambiguity about which "margin" is meant:
//   - markup   = profit as a % of COST      ("I add 20% on top of what I paid")
//   - margin   = profit as a % of PRICE     ("20% of what I sell it for is profit")
// The two are only equal at 0%; a 25% markup is a 20% margin, not a 25% margin.

export function priceFromMarkup(cost: number, markupPct: number): number {
  return round2(cost * (1 + markupPct / 100))
}

export function markupFromPrice(cost: number, price: number): number {
  if (cost <= 0) return 0
  return round2(((price - cost) / cost) * 100)
}

export function marginFromPrice(cost: number, price: number): number {
  if (price <= 0) return 0
  return round2(((price - cost) / price) * 100)
}

export function profit(cost: number, price: number): number {
  return round2(price - cost)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ---------------------------------------------------------------------------
// Price Board helpers (website price == default selling price, one number).
// Still pure: nothing here touches Supabase, so the same code is unit-tested
// and used by both the API (validation / suggestions) and the board UI.
// ---------------------------------------------------------------------------

export type RoundingStyle = 'none' | 'ten' | 'hundred' | '99' | '999'

export interface PricingRules {
  min_margin_pct: number
  aging_days: number
  undercut_tolerance: number
  beat_by: number
  rounding: RoundingStyle
  aging_drop_pct: number
}

export const DEFAULT_RULES: PricingRules = {
  min_margin_pct: 10,
  aging_days: 45,
  undercut_tolerance: 0,
  beat_by: 500,
  rounding: 'hundred',
  aging_drop_pct: 5,
}

export const MAX_PRICE = 1_000_000

export function roundPrice(n: number, style: RoundingStyle): number {
  if (!Number.isFinite(n)) return n
  let out: number
  switch (style) {
    case 'ten': out = Math.round(n / 10) * 10; break
    case 'hundred': out = Math.round(n / 100) * 100; break
    case '99': out = Math.round((n + 1) / 100) * 100 - 1; break
    case '999': out = Math.round((n + 1) / 1000) * 1000 - 1; break
    default: out = Math.round(n)
  }
  return out > 0 ? out : Math.max(1, Math.round(n))
}

/** Lowest price that still keeps `minMarginPct` margin on price. Rounded UP to a whole rupee. */
export function minPriceForMargin(cost: number, minMarginPct: number): number {
  if (cost <= 0) return 0
  return Math.ceil(cost / (1 - minMarginPct / 100))
}

/** Round up to the rounding style but never below `floor`. */
function roundNotBelow(n: number, style: RoundingStyle, floor: number): number {
  let r = roundPrice(n, style)
  let guard = 0
  while (r < floor && guard++ < 5) r = roundPrice(r + (style === '999' ? 1000 : 100), style)
  return Math.max(r, Math.ceil(floor))
}

export type BulkOp =
  | { type: 'set'; value: number }
  | { type: 'add'; value: number }
  | { type: 'pct'; value: number }
  | { type: 'match_competitor'; value: number }
  | { type: 'margin'; value: number }

export interface BulkInput {
  current: number | null
  cost: number | null
  competitorMin: number | null
}

/** New price for one row, or null when the operation cannot apply (e.g. no competitor price). */
export function applyBulk(op: BulkOp, row: BulkInput, rounding: RoundingStyle): number | null {
  let raw: number | null = null
  switch (op.type) {
    case 'set': raw = op.value; break
    case 'add': raw = row.current != null ? row.current + op.value : null; break
    case 'pct': raw = row.current != null ? row.current * (1 + op.value / 100) : null; break
    case 'match_competitor': raw = row.competitorMin != null ? row.competitorMin - op.value : null; break
    case 'margin':
      raw = row.cost != null && row.cost > 0 && op.value < 90 ? row.cost / (1 - op.value / 100) : null
      break
  }
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null
  const out = op.type === 'set' ? raw : roundPrice(raw, rounding)
  return out > 0 && out <= MAX_PRICE ? out : null
}

export type PriceWarning = 'below_margin' | 'below_cost' | 'big_drop' | 'big_rise'

export function priceWarnings(oldPrice: number | null, newPrice: number, cost: number | null, minMarginPct: number): PriceWarning[] {
  const w: PriceWarning[] = []
  if (cost != null && cost > 0) {
    if (newPrice < cost) w.push('below_cost')
    else if (marginFromPrice(cost, newPrice) < minMarginPct) w.push('below_margin')
  }
  if (oldPrice != null && oldPrice > 0) {
    const change = (newPrice - oldPrice) / oldPrice
    if (change <= -0.15) w.push('big_drop')
    if (change >= 0.25) w.push('big_rise')
  }
  return w
}

export interface Suggestion { price: number; reason: string; limitedByMargin: boolean }

/** Suggest matching a competitor, never below the margin floor. null when we are already at or below. */
export function suggestFromCompetitor(
  current: number | null, cost: number | null, competitor: { label: string; price: number; warrantyMonths: number | null },
  rules: PricingRules,
): Suggestion | null {
  const target = roundPrice(competitor.price - rules.beat_by, rules.rounding)
  if (current != null && target >= current) return null
  const floor = cost != null && cost > 0 ? minPriceForMargin(cost, rules.min_margin_pct) : 0
  const limited = floor > 0 && target < floor
  const price = limited ? roundNotBelow(floor, rules.rounding, floor) : target
  if (current != null && price >= current) return null
  const wty = competitor.warrantyMonths ? ` (${competitor.warrantyMonths} m warranty)` : ''
  return {
    price,
    limitedByMargin: limited,
    reason: `${competitor.label} ₹${Math.round(competitor.price).toLocaleString('en-IN')}${wty}` + (limited ? `; held at your ${rules.min_margin_pct}% minimum margin` : ''),
  }
}

/** Gentle drop for stock that has sat too long. */
export function suggestForAging(current: number | null, cost: number | null, ageDays: number, rules: PricingRules): Suggestion | null {
  if (current == null || ageDays < rules.aging_days || rules.aging_drop_pct <= 0) return null
  const target = roundPrice(current * (1 - rules.aging_drop_pct / 100), rules.rounding)
  const floor = cost != null && cost > 0 ? minPriceForMargin(cost, rules.min_margin_pct) : 0
  const price = floor > 0 ? Math.max(target, roundNotBelow(floor, rules.rounding, floor)) : target
  if (price >= current) return null
  return { price, limitedByMargin: floor > 0 && target < floor, reason: `Oldest unit is ${ageDays} days old` }
}

export function isUndercut(ourPrice: number | null, competitorPrice: number | null, tolerance: number): boolean {
  return ourPrice != null && competitorPrice != null && competitorPrice < ourPrice - tolerance
}

/** Validation shared by every route that writes a selling price. */
export function validatePrice(value: unknown): { ok: true; price: number } | { ok: false; error: string } {
  const n = typeof value === 'string' ? Number(value.trim()) : (value as number)
  if (typeof n !== 'number' || !Number.isFinite(n)) return { ok: false, error: 'Price must be a number.' }
  if (n <= 0) return { ok: false, error: 'Price must be greater than zero.' }
  if (n > MAX_PRICE) return { ok: false, error: `Price cannot exceed ₹${MAX_PRICE.toLocaleString('en-IN')}.` }
  return { ok: true, price: Math.round(n * 100) / 100 }
}

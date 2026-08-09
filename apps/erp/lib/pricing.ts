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

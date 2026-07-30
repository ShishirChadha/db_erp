import { supabaseAdmin } from '@db/db/admin'

export interface CartLineForPromo {
  skuId: string
  category: string
  brand: string | null
  lineTotal: number // quantity * (already-upgraded) unit_price
}

interface Promotion {
  id: string
  promo_type: 'percent_off' | 'flat_off' | 'free_gift' | 'coupon_code'
  code: string | null
  discount_percent: number | null
  discount_flat: number | null
  free_gift_sku_id: string | null
  scope_type: 'product' | 'brand' | 'category' | 'sitewide'
  scope_value: string | null
  is_stackable: boolean
  min_order_value: number | null
}

function scopeMatches(promo: Promotion, lines: CartLineForPromo[]): CartLineForPromo[] {
  if (promo.scope_type === 'sitewide') return lines
  if (promo.scope_type === 'category') return lines.filter((l) => l.category === promo.scope_value)
  if (promo.scope_type === 'brand') return lines.filter((l) => l.brand === promo.scope_value)
  if (promo.scope_type === 'product') return lines.filter((l) => l.skuId === promo.scope_value)
  return []
}

// Never trusts the client for anything beyond "which coupon code did they
// type" -- every promo's actual terms (discount, scope, dates, stackability)
// are re-read from the live `promotions` table.
export async function resolveApplicablePromotions(
  lines: CartLineForPromo[],
  couponCode?: string | null
): Promise<{ discountAmount: number; appliedPromotionIds: string[]; freeGiftPromotionId: string | null; freeGiftSkuId: string | null }> {
  const orderTotal = lines.reduce((sum, l) => sum + l.lineTotal, 0)
  const now = new Date().toISOString()

  const { data: activePromos } = await supabaseAdmin
    .from('promotions')
    .select('id, promo_type, code, discount_percent, discount_flat, free_gift_sku_id, scope_type, scope_value, is_stackable, min_order_value')
    .eq('is_active', true)
    .lte('starts_at', now)
    .gte('ends_at', now)

  const candidates = (activePromos ?? []).filter((p) => {
    // A coupon_code promo only ever applies if the customer typed that exact
    // code; a non-coupon promo (code IS NULL) is automatic.
    if (p.code) return couponCode != null && p.code.toUpperCase() === couponCode.toUpperCase()
    return true
  })

  type Applied = { promo: Promotion; matchedLines: CartLineForPromo[]; discount: number }
  const applied: Applied[] = []

  for (const p of candidates as Promotion[]) {
    if (p.min_order_value != null && orderTotal < Number(p.min_order_value)) continue
    const matchedLines = scopeMatches(p, lines)
    if (matchedLines.length === 0) continue
    const matchedTotal = matchedLines.reduce((sum, l) => sum + l.lineTotal, 0)

    let discount = 0
    if (p.promo_type === 'percent_off') discount = Math.round(matchedTotal * (Number(p.discount_percent) / 100) * 100) / 100
    else if (p.promo_type === 'flat_off') discount = Math.min(Number(p.discount_flat), matchedTotal)
    else if (p.promo_type === 'coupon_code') discount = 0 // a coupon_code promo carries no discount of its own -- pair it with a free_gift/percent/flat promo if you want it to do something
    else continue // free_gift handled separately below

    applied.push({ promo: p, matchedLines, discount })
  }

  // Combinability: at most one non-stackable promo (best discount wins); any
  // number of stackable ones combine with it and each other.
  const stackable = applied.filter((a) => a.promo.is_stackable)
  const nonStackable = applied.filter((a) => !a.promo.is_stackable).sort((a, b) => b.discount - a.discount)
  const winningNonStackable = nonStackable.length > 0 ? [nonStackable[0]] : []
  const finalApplied = [...stackable, ...winningNonStackable]

  const discountAmount = finalApplied.reduce((sum, a) => sum + a.discount, 0)
  const appliedPromotionIds = finalApplied.map((a) => a.promo.id)

  // Free-gift promo: separate from the discount math above -- it adds a $0
  // line, not a price reduction. Same scope/min-order/stacking rules apply.
  const giftCandidate = (candidates as Promotion[]).find((p) => {
    if (p.promo_type !== 'free_gift') return false
    if (p.min_order_value != null && orderTotal < Number(p.min_order_value)) return false
    return scopeMatches(p, lines).length > 0
  })

  return {
    discountAmount,
    appliedPromotionIds,
    freeGiftPromotionId: giftCandidate?.id ?? null,
    freeGiftSkuId: giftCandidate?.free_gift_sku_id ?? null,
  }
}

'use client'

import { sortSelectedUpgrades, type SelectedUpgrade } from '@/lib/upgrades'

// A "Buy Now" click sets exactly one line here and sends the customer
// straight to /checkout?buyNow=1 -- it never touches the real cart (DB
// cart_items for a signed-in customer, localStorage for a guest), by design:
// the point of the button is to skip the cart entirely for a single item,
// not to add-then-redirect.
//
// sessionStorage, not localStorage: this is a one-shot intent for the very
// next page load, not something that should survive and resurface in a
// later, unrelated visit the way the real cart does.
const KEY = 'db_buy_now_v1'

export interface BuyNowLine {
  sku_id: string
  quantity: number
  selected_upgrades: SelectedUpgrade[]
}

export function setBuyNowLine(skuId: string, upgrades: SelectedUpgrade[] = [], quantity = 1): void {
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ sku_id: skuId, quantity, selected_upgrades: sortSelectedUpgrades(upgrades) })
    )
  } catch {
    // Out of quota or blocked -- /checkout?buyNow=1 will just find nothing
    // and fall back to the real cart; the button click still navigates.
  }
}

export function getBuyNowLine(): BuyNowLine | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.sku_id !== 'string') return null
    return {
      sku_id: parsed.sku_id,
      quantity: Number.isInteger(parsed.quantity) && parsed.quantity > 0 ? parsed.quantity : 1,
      selected_upgrades: Array.isArray(parsed.selected_upgrades) ? parsed.selected_upgrades : [],
    }
  } catch {
    return null
  }
}

export function clearBuyNowLine(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

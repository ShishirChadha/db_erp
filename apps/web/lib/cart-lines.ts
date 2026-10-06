import { sortSelectedUpgrades } from '@/lib/upgrades'

// Shared shape/limit validation for a cart payload arriving from outside the
// server -- guest-cart.ts's localStorage blob, carried by both /api/cart/merge
// (on login) and /api/checkout/start's guest path. Both treat this as HOSTILE
// INPUT (it's user-writable by definition); this is the one place the limits
// live, so they can't drift between the two call sites.
export const CART_LINE_LIMITS = { MAX_LINES: 20, MAX_QTY_PER_LINE: 10, MAX_TOTAL_UNITS: 50 }

export interface ParsedCartLine {
  sku_id: string
  quantity: number
  selected_upgrades: ReturnType<typeof sortSelectedUpgrades>
}

export function parseCartLines(
  incoming: unknown
): { ok: true; lines: ParsedCartLine[] } | { ok: false; error: string } {
  const { MAX_LINES, MAX_QTY_PER_LINE, MAX_TOTAL_UNITS } = CART_LINE_LIMITS
  const arr = Array.isArray(incoming) ? incoming : []
  if (arr.length > MAX_LINES) return { ok: false, error: `A cart cannot hold more than ${MAX_LINES} different items.` }

  const lines: ParsedCartLine[] = arr
    .map((l: any) => ({
      sku_id: typeof l?.sku_id === 'string' ? l.sku_id : null,
      quantity: Number(l?.quantity),
      selected_upgrades: Array.isArray(l?.selected_upgrades) ? sortSelectedUpgrades(l.selected_upgrades) : [],
    }))
    .filter((l) => !!l.sku_id) as ParsedCartLine[]

  if (lines.some((l) => !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > MAX_QTY_PER_LINE)) {
    return { ok: false, error: `Each item is limited to ${MAX_QTY_PER_LINE}.` }
  }
  const totalUnits = lines.reduce((sum, l) => sum + l.quantity, 0)
  if (totalUnits > MAX_TOTAL_UNITS) {
    return { ok: false, error: `A cart cannot hold more than ${MAX_TOTAL_UNITS} units.` }
  }
  return { ok: true, lines }
}

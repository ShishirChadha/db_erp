// A unit is only offered in the Sell screen's picker (and reservable by the
// website) once it has cleared QC.
export const SELLABLE_STATUSES = ['ready_for_sale', 'qc_passed']

// Indian financial year runs April-March, so Jan-Mar belongs to the FY that
// started the previous calendar year -- not the current one.
export function financialYear(date = new Date()): string {
  const year = date.getFullYear()
  const fyStartYear = date.getMonth() >= 3 ? year : year - 1
  const nextYearShort = (fyStartYear + 1) % 100
  return `${fyStartYear}-${String(nextYearShort).padStart(2, '0')}`
}

// One payment method's contribution to a cart checkout -- e.g. ₹50,000 into
// "Digitalbluez" + ₹50,000 "Cash" for one laptop. payment_account here is
// purely a receipt/reconciliation detail (which of the business's accounts
// the money landed in), independent of a sale's own invoicing-entity
// payment_account (see docs/decisions.md -- a serialized unit can only ever
// belong to one sales row, so it can't be half-invoiced across entities,
// even though its payment legitimately can be split).
export type PaymentLeg = { amount: number; payment_account: string; note?: string }

// Allocates every leg's amount across every cart item's total, processing legs IN
// ORDER, each leg split proportionally across items' REMAINING (not yet allocated by an
// earlier leg) capacity -- not their full total. This guarantees (a) one leg's
// allocations across all items sum EXACTLY to that leg's own amount (this is real money
// that must reconcile against actual bank/cash amounts) and (b) no single item is ever
// allocated more than its own total, which independently re-running a naive
// per-item proportional split once per leg (against each item's full total every time)
// does NOT guarantee -- two legs can jointly over-allocate one item past its own total
// even though the whole-cart sum is exact. Reduces byte-for-byte to a simple
// proportional-by-total split when legs.length === 1 (remaining == full item total on
// the only leg). Integer-paise arithmetic; a leg's own floor-division remainder cascades
// backward through items with remaining capacity.
//
// Lives in @db/shared (not apps/erp alone) because apps/web's website-order
// checkout needs the exact same paise-exact split -- a token/advance payment
// against a multi-line order fans out across one `sales` row per order_item,
// same shape as the ERP's own multi-item Sell cart. apps/erp/lib/sales-cart.ts
// re-exports this rather than duplicating it, so its own ~2 existing import
// sites are unaffected.
export function allocatePaymentLegs(
  legs: PaymentLeg[],
  itemTotalsRupees: number[]
): Array<Array<{ legIndex: number; amount: number }>> {
  const toPaise = (r: number) => Math.round(r * 100)
  const n = itemTotalsRupees.length
  const remaining = itemTotalsRupees.map(toPaise)
  const perItem: Array<Array<{ legIndex: number; amount: number }>> = itemTotalsRupees.map(() => [])

  legs.forEach((leg, legIndex) => {
    const totalRemaining = remaining.reduce((sum, r) => sum + r, 0)
    if (totalRemaining <= 0) return
    const legPaise = Math.min(toPaise(leg.amount), totalRemaining) // defensive clamp
    if (legPaise <= 0) return

    const shares = remaining.map((r) => Math.floor((legPaise * r) / totalRemaining))
    let remainder = legPaise - shares.reduce((sum, s) => sum + s, 0)

    // Cascade the remainder backward through items with capacity left -- terminates with
    // remainder === 0 because legPaise <= totalRemaining and floor division never
    // over-allocates.
    for (let i = n - 1; i >= 0 && remainder > 0; i--) {
      const capacityLeft = remaining[i] - shares[i]
      const add = Math.min(remainder, capacityLeft)
      shares[i] += add
      remainder -= add
    }

    for (let i = 0; i < n; i++) {
      if (shares[i] > 0) {
        perItem[i].push({ legIndex, amount: shares[i] / 100 })
        remaining[i] -= shares[i]
      }
    }
  })

  return perItem
}

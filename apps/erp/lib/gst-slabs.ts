// The GST rates GSTR-1 accepts on a line. A rate derived as tax / base can land just off a slab
// after paise rounding (a Rs 1 price -> 0.85 + 0.15 tax = 17.65%), and the portal rejects it.
export const GST_SLABS = [0, 0.25, 1.5, 3, 5, 12, 18, 28, 40] as const

// Snaps to the nearest slab when within 0.5 percentage points; anything further off is kept
// as-is so a genuinely wrong rate stays visible to the invalid_gst_slab_rate check.
export function snapGstRate(rate: number): number {
  let best: number = GST_SLABS[0], bestDiff = Infinity
  for (const s of GST_SLABS) {
    const d = Math.abs(rate - s)
    if (d < bestDiff) { best = s; bestDiff = d }
  }
  return bestDiff <= 0.5 ? best : rate
}

// Renders an accessory receipt's unit price, showing both the pre-GST and GST-inclusive
// figure when a GST percentage was optionally captured at receipt time (most receipts
// don't have one -- gst_percentage is an optional field, see docs/decisions.md).
export function formatPurchasePrice(unitPrice: number | null | undefined, gstPercentage?: number | null): string | null {
  if (unitPrice == null) return null
  if (gstPercentage == null) return `₹${unitPrice.toFixed(2)}`
  const inclusive = unitPrice * (1 + gstPercentage / 100)
  return `₹${unitPrice.toFixed(2)} + GST ${gstPercentage}% = ₹${inclusive.toFixed(2)}`
}

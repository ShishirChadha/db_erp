// Shared before/after-GST math for purchase-order line items -- used by the New PO
// wizard, the quick-checkbox "Create PO from Selected" form, and the PO-correction
// dialog, so all three compute identically instead of each carrying its own copy.
// The server (POST /api/purchase-orders, POST /api/purchase-orders/from-intake,
// PATCH /api/purchase-orders/[id]/items/[itemId]) always recomputes gst_amount/
// line_total itself from base_price + gst_percentage -- these helpers are for live
// client-side preview only, not the source of truth.

export interface GstLineAmounts {
  lineTotalBeforeGst: number
  gstAmount: number
  lineTotal: number
}

// Forward: unit price (before GST) x quantity x GST% -> line total (incl. GST).
// This is the only path quantity/GST%/unit-price edits ever take -- changing any of
// them always scales the total up/down from the current unit price, never back-solves
// a smaller unit price from a stale total.
export function computeFromUnitPrice(unitPrice: number, quantity: number, gstPercent: number): GstLineAmounts {
  const lineTotalBeforeGst = unitPrice * quantity
  const gstAmount = lineTotalBeforeGst * gstPercent / 100
  return { lineTotalBeforeGst, gstAmount, lineTotal: lineTotalBeforeGst + gstAmount }
}

// Reverse: a direct edit of the Line Total (incl. GST) field back-solves unit price,
// holding quantity/GST% fixed. Only triggered by editing Line Total itself.
export function computeFromLineTotal(lineTotal: number, quantity: number, gstPercent: number): { unitPrice: number } & GstLineAmounts {
  const lineTotalBeforeGst = lineTotal / (1 + gstPercent / 100)
  const unitPrice = quantity > 0 ? lineTotalBeforeGst / quantity : 0
  const gstAmount = lineTotal - lineTotalBeforeGst
  return { unitPrice, lineTotalBeforeGst, gstAmount, lineTotal }
}

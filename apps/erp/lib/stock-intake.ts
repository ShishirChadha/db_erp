import { supabaseAdmin } from './supabase/service'
import { TYPE_TO_CATEGORY, resolveBrand, buildSpecifications, getAssetPrefix } from './purchases-legacy'

export { TYPE_TO_CATEGORY, resolveBrand, buildSpecifications }

// Employee stock-intake payload -- deliberately has no vendor_id, cost_price, or po_id.
// Building it out mirrors buildPurchaseRecord()'s spec-field handling but targets
// asset_ledger directly (source='employee_intake') rather than the rich `purchases`
// companion row -- intake is about registering that a physical unit exists, not
// capturing the purchase-event/GST detail the vendor door needs.
export interface StockIntakeInput {
  type: string
  brand?: string
  brand_other?: string
  model: string
  cpu?: string
  generation?: string
  ram?: string
  ssd?: string
  screen_size?: string
  serial_number?: string
  condition_notes?: string
  public_photo_url?: string
  purchased_by_type?: string
  received_date?: string
}

// A unit is live stock the moment it's entered -- it starts life in 'qc_pending', same
// as a freshly-received PO-flow unit, and is fully QC-able/sellable right away. But its
// asset_number stays NULL until a real PO exists for it: numbers are a paperwork
// artifact tied to a committed purchase order, not something to spend on an employee's
// report. Until then the unit is identified everywhere by serial_number + its row id.
// The PO can be attached whenever -- even after the unit has already been sold (see the
// attach-to-PO flow, which is the only place these units ever get numbered).
export function buildIntakeLedgerRow(input: StockIntakeInput, opts: {
  skuId: string
  enteredBy: string
}) {
  return {
    sku_id: opts.skuId,
    asset_number: null,
    serial_number: input.serial_number || null,
    status: 'qc_pending',
    source: 'employee_intake',
    entered_by: opts.enteredBy,
    notes: input.condition_notes || null,
    purchased_by_type: input.purchased_by_type || null,
    vendor_id: null,
    cost_price: null,
    gst_percentage: null,
    po_id: null,
    po_item_id: null,
    // A backdated entry (unit actually received earlier but logged late) supplies
    // received_date (YYYY-MM-DD); noon UTC keeps the date stable across timezones
    // rather than risking a midnight-UTC day shift. No date supplied -> exact "now".
    received_at: input.received_date ? `${input.received_date}T12:00:00.000Z` : new Date().toISOString(),
  }
}

export { getAssetPrefix }
export { supabaseAdmin }

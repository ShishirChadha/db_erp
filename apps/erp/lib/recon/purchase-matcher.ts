import { supabaseAdmin } from '@/lib/supabase/service'

// Debit-side matching candidates for Bank Reconciliation's "Match Purchase" action.
// Two independent sources, since this business records a purchase's vendor/price two
// different ways depending on whether a formal PO exists (see business-rules and
// docs/decisions.md, 2026-09-02):
//  - stock_movements receipts: the common no-PO accessory-purchase case -- vendor_id
//    and unit_price are already captured at receive-stock time, so matching a bank
//    debit to one is just confirming "this bank line is the payment for that receipt
//    already on file", never a write to inventory.
//  - purchase_orders with an outstanding balance: the formal-PO case. Matching here
//    CREATES a real vendor_payments row (via the existing POST /api/purchase-orders/
//    [id]/payments route, reused rather than duplicated) rather than requiring one to
//    already exist, mirroring how an 'expense' match creates its expenses row on the
//    spot -- a bank debit is normally the FIRST evidence a PO got paid, not something
//    entered beforehand.
// Deterministic vendor-name + amount + date matching only, no AI/PDF parsing -- same
// posture as lib/recon/credit-matcher.ts.

const AMOUNT_TOLERANCE_PCT = 0.02
const DATE_WINDOW_DAYS = 10 // wider than credit-matching's 5: a purchase's stock often
// arrives days before or after the bank debit that pays for it, more so than a sale.

export interface StockPurchaseCandidate {
  kind: 'stock_movement'
  stock_movement_id: string
  amount: number
  purchase_date: string
  vendor_id: string | null
  vendor_name: string | null
  sku_description: string | null
  full_sku_code: string | null
  quantity: number
  amount_delta: number
  date_delta_days: number
  score: number
}

export interface PoPurchaseCandidate {
  kind: 'purchase_order'
  po_id: string
  po_number: string
  outstanding: number
  po_date: string
  vendor_id: string | null
  vendor_name: string | null
  grand_total: number
  amount_delta: number
  date_delta_days: number
  score: number
}

export type PurchaseCandidate = StockPurchaseCandidate | PoPurchaseCandidate

// Bank narrations bury the vendor name in wildly different positions depending on the
// rail (INF/NEFT puts it near the end, "NEFT-XXX-Vendor Name-..." puts it 2nd, UPI
// varies) and mixed with transaction IDs, IFSC codes, etc. Trying similarity() on the
// FULL narration string against a vendor's short company_name reproduces the exact
// dilution bug already found and fixed in invoice-line matching this session -- so
// this only tries individual slash/hyphen-delimited segments that look name-shaped
// (letters/spaces, no digits, 3+ chars), the same filter guessPayerName uses for
// customer narrations in credit-matcher.ts.
function nameLikeSegments(narration: string): string[] {
  return narration
    .split(/[\/\-]/)
    .map((p) => p.trim())
    .filter((p) => /^[a-zA-Z ]{3,}$/.test(p) && !/bank|upi|neft|rtgs|imps|inf$/i.test(p))
}

async function guessVendorIds(narration: string): Promise<Set<string>> {
  const segments = nameLikeSegments(narration).slice(0, 4)
  // Each segment's RPC call is independent -- these used to run sequentially,
  // so a narration with 4 name-like segments cost 4 serial round trips per
  // transaction on top of everything else findPurchaseCandidates does.
  const results = await Promise.all(
    segments.map((seg) => supabaseAdmin.rpc('match_vendors_by_name', { p_name: seg, p_limit: 3 }))
  )
  const ids = new Set<string>()
  for (const { data } of results) {
    for (const v of data || []) if (v.similarity >= 0.35) ids.add(v.id)
  }
  return ids
}

function dateScore(deltaDays: number, amountDelta: number, amount: number): number {
  return (1 - Math.min(amountDelta / Math.max(amount, 1), 1)) * 7 + (1 - Math.min(deltaDays / DATE_WINDOW_DAYS, 1)) * 3
}

// The two "already consumed" lookups below don't depend on any one
// transaction -- they're the same query for every row in a batch. Exposed so
// a caller matching many transactions in one request (bank-transactions'
// with_candidates=true, used against a whole month of transactions with no
// caller-side pagination) can compute this exactly once and pass it in,
// instead of findPurchaseCandidates re-running both queries per transaction --
// that was 2 of this function's ~4-5 queries repeated identically N times.
export interface PurchaseMatchContext {
  consumedStockIds: Set<string>
  posAlreadyFullyMatched: Set<string>
}

export async function loadPurchaseMatchContext(): Promise<PurchaseMatchContext> {
  const [{ data: existingStockMatches }, { data: existingVendorPaymentMatches }] = await Promise.all([
    supabaseAdmin
      .from('bank_transaction_matches')
      .select('stock_movement_id, amount_applied')
      .eq('match_type', 'stock_purchase')
      .not('stock_movement_id', 'is', null),
    supabaseAdmin
      .from('bank_transaction_matches')
      .select('vendor_payment_id')
      .eq('match_type', 'vendor_payment')
      .not('vendor_payment_id', 'is', null),
  ])
  const consumedStockIds = new Set((existingStockMatches || []).map((m) => m.stock_movement_id))

  const matchedVendorPaymentIds = (existingVendorPaymentMatches || []).map((m) => m.vendor_payment_id)
  let posAlreadyFullyMatched = new Set<string>()
  if (matchedVendorPaymentIds.length > 0) {
    const { data: vp } = await supabaseAdmin.from('vendor_payments').select('po_id').in('id', matchedVendorPaymentIds)
    posAlreadyFullyMatched = new Set((vp || []).map((v) => v.po_id))
  }
  return { consumedStockIds, posAlreadyFullyMatched }
}

export async function findPurchaseCandidates(params: {
  narration: string
  amount: number
  txnDate: string
  entityKey: string
  context?: PurchaseMatchContext
}): Promise<PurchaseCandidate[]> {
  const { narration, amount, txnDate, entityKey } = params
  const paymentAccount = entityKey.charAt(0).toUpperCase() + entityKey.slice(1)
  const windowStart = new Date(new Date(txnDate).getTime() - DATE_WINDOW_DAYS * 86400000).toISOString().slice(0, 10)
  const windowEnd = new Date(new Date(txnDate).getTime() + DATE_WINDOW_DAYS * 86400000).toISOString().slice(0, 10)
  const upperBound = amount * (1 + AMOUNT_TOLERANCE_PCT)

  // guessVendorIds (varies per transaction's narration) and loading the
  // consumed/matched context (identical for every transaction, only computed
  // here when the caller didn't already hoist it) are independent -- run
  // them concurrently instead of one after the other.
  const [guessedVendorIds, { consumedStockIds, posAlreadyFullyMatched }] = await Promise.all([
    guessVendorIds(narration),
    params.context ? Promise.resolve(params.context) : loadPurchaseMatchContext(),
  ])

  const results: PurchaseCandidate[] = []

  // ---- stock_movements receipts (no PO) ----
  const smQuery = supabaseAdmin
    .from('stock_movements')
    .select('id, quantity_change, unit_price, vendor_id, purchase_date, payment_account, sku_master(full_sku_code, sku_description), vendors(company_name)')
    .eq('movement_type', 'receipt')
    .is('po_id', null)
    .not('vendor_id', 'is', null)
    .not('unit_price', 'is', null)
    .gte('purchase_date', windowStart)
    .lte('purchase_date', windowEnd)
    .eq('payment_account', paymentAccount)
  const { data: movements } = await smQuery

  for (const m of movements || []) {
    if (consumedStockIds.has(m.id)) continue
    const lineAmount = Math.abs(m.quantity_change) * Number(m.unit_price)
    if (lineAmount <= 0 || lineAmount > upperBound) continue
    const amountDelta = Math.abs(lineAmount - amount)
    const dateDelta = Math.abs((new Date(m.purchase_date).getTime() - new Date(txnDate).getTime()) / 86400000)
    const vendorBoost = m.vendor_id && guessedVendorIds.has(m.vendor_id) ? 2 : 0
    const sku: any = m.sku_master
    const vendor: any = m.vendors
    results.push({
      kind: 'stock_movement',
      stock_movement_id: m.id,
      amount: lineAmount,
      purchase_date: m.purchase_date,
      vendor_id: m.vendor_id,
      vendor_name: vendor?.company_name || null,
      sku_description: sku?.sku_description || null,
      full_sku_code: sku?.full_sku_code || null,
      quantity: Math.abs(m.quantity_change),
      amount_delta: amountDelta,
      date_delta_days: dateDelta,
      score: dateScore(dateDelta, amountDelta, amount) + vendorBoost,
    })
  }

  // ---- purchase_orders with an outstanding balance (formal PO) ----
  const poQuery = supabaseAdmin
    .from('purchase_orders')
    .select('id, po_number, po_date, grand_total, amount_paid, vendor_id, purchased_by_type, vendors(company_name)')
    .eq('is_deleted', false)
    .neq('payment_status', 'paid')
    .gte('po_date', windowStart)
    .lte('po_date', windowEnd)
    .eq('purchased_by_type', paymentAccount)
  const { data: pos } = await poQuery

  for (const po of pos || []) {
    if (posAlreadyFullyMatched.has(po.id)) continue
    const outstanding = Number(po.grand_total) - Number(po.amount_paid || 0)
    if (outstanding <= 0.5 || outstanding > upperBound) continue
    const amountDelta = Math.abs(outstanding - amount)
    const dateDelta = Math.abs((new Date(po.po_date).getTime() - new Date(txnDate).getTime()) / 86400000)
    const vendorBoost = po.vendor_id && guessedVendorIds.has(po.vendor_id) ? 2 : 0
    const vendor: any = po.vendors
    results.push({
      kind: 'purchase_order',
      po_id: po.id,
      po_number: po.po_number,
      outstanding,
      po_date: po.po_date,
      vendor_id: po.vendor_id,
      vendor_name: vendor?.company_name || null,
      grand_total: Number(po.grand_total),
      amount_delta: amountDelta,
      date_delta_days: dateDelta,
      score: dateScore(dateDelta, amountDelta, amount) + vendorBoost,
    })
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 8)
}

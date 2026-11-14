import { supabaseAdmin } from './supabase/service'
import { chunkedIn } from './chunked-in'

// A sale can have several partial-payment installments (sale_payments rows) --
// "the payment date" shown on a sale-list view is the most recent installment's
// date, which for a single-payment sale is just that payment's date. Shared by
// every touchpoint that needs to show/sort a per-sale payment date (Sales Ledger,
// Live Stock's Sold Stock tab, Sold Accessories) so they can't drift on the
// definition of "latest."
export async function latestPaymentDatesBySaleId(saleIds: string[]): Promise<Map<string, string>> {
  if (saleIds.length === 0) return new Map()

  // Batched: Live Stock's Sold tab passes every sold sale id at once, which
  // overruns the proxy's request-line limit as a single .in() filter. See
  // lib/chunked-in.ts.
  const { data } = await chunkedIn<{ sale_id: string; recorded_at: string }>(saleIds, chunk =>
    supabaseAdmin
      .from('sale_payments')
      .select('sale_id, recorded_at')
      .in('sale_id', chunk)
  )

  const latest = new Map<string, string>()
  for (const row of data || []) {
    const current = latest.get(row.sale_id)
    if (!current || row.recorded_at > current) latest.set(row.sale_id, row.recorded_at)
  }
  return latest
}

// A customer's payment for one sale can be split across accounts (e.g. part into
// Digitalbluez, part into Techtenth) -- surfaced wherever a sale's "Received Into"
// is shown, and used to let the GST invoice be raised for only the portion actually
// credited to a GST-registered entity (see /api/sales/[id]/finalize's invoice_amount).
// Returns one entry per sale that has at least one recorded payment; a sale with a
// single payment still gets a one-row array, left for the caller to ignore when
// there's nothing to call out (only >1 distinct account is actually "split").
export async function paymentAccountSplitsBySaleId(saleIds: string[]): Promise<Map<string, { payment_account: string | null; amount: number }[]>> {
  if (saleIds.length === 0) return new Map()

  const { data } = await chunkedIn<{ sale_id: string; payment_account: string | null; amount: number }>(saleIds, chunk =>
    supabaseAdmin
      .from('sale_payments')
      .select('sale_id, payment_account, amount')
      .in('sale_id', chunk)
  )

  const bySale = new Map<string, Map<string, number>>()
  for (const row of data || []) {
    const key = row.payment_account || 'Unspecified'
    if (!bySale.has(row.sale_id)) bySale.set(row.sale_id, new Map())
    const perAccount = bySale.get(row.sale_id)!
    perAccount.set(key, (perAccount.get(key) || 0) + Number(row.amount))
  }

  const result = new Map<string, { payment_account: string | null; amount: number }[]>()
  for (const [saleId, perAccount] of bySale) {
    result.set(saleId, [...perAccount.entries()].map(([payment_account, amount]) => ({ payment_account, amount })))
  }
  return result
}

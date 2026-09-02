import { supabaseAdmin } from './supabase/service'

// A sale can have several partial-payment installments (sale_payments rows) --
// "the payment date" shown on a sale-list view is the most recent installment's
// date, which for a single-payment sale is just that payment's date. Shared by
// every touchpoint that needs to show/sort a per-sale payment date (Sales Ledger,
// Live Stock's Sold Stock tab, Sold Accessories) so they can't drift on the
// definition of "latest."
export async function latestPaymentDatesBySaleId(saleIds: string[]): Promise<Map<string, string>> {
  if (saleIds.length === 0) return new Map()

  const { data } = await supabaseAdmin
    .from('sale_payments')
    .select('sale_id, recorded_at')
    .in('sale_id', saleIds)

  const latest = new Map<string, string>()
  for (const row of data || []) {
    const current = latest.get(row.sale_id)
    if (!current || row.recorded_at > current) latest.set(row.sale_id, row.recorded_at)
  }
  return latest
}

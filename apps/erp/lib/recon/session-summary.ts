import { supabaseAdmin } from '@/lib/supabase/service'

// Recon session summary computation (Phase 7). Counts are always recomputed fresh
// from bank_transactions -- never cached/trusted stale, since matches can change
// between summary calls.

export interface SessionSummary {
  total_count: number
  open_count: number
  matched_count: number
  by_status: Record<string, number>
  total_debit: number
  total_credit: number
  recurring_expense_watch: { type: string; last_seen_period: string }[]
}

export async function computeSessionSummary(bankAccountId: string, periodStart: string, periodEnd: string): Promise<SessionSummary> {
  const { data: txns } = await supabaseAdmin
    .from('bank_transactions')
    .select('recon_status, debit, credit')
    .eq('bank_account_id', bankAccountId)
    .gte('txn_date', periodStart)
    .lte('txn_date', periodEnd)

  const rows = txns || []
  const byStatus: Record<string, number> = {}
  let totalDebit = 0, totalCredit = 0
  for (const t of rows) {
    byStatus[t.recon_status] = (byStatus[t.recon_status] || 0) + 1
    totalDebit += t.debit || 0
    totalCredit += t.credit || 0
  }
  const openCount = (byStatus.open || 0) + (byStatus.split || 0)
  const matchedCount = rows.length - openCount

  // Recurring-expense watch: a type with an active recurring_expense_rules entry
  // for this account's entity (Phase 3's real schedule -- scan_recurring_expenses()
  // reminds separately, on its own cadence) that also has real expense history in
  // an EARLIER period but no corresponding expense row landing inside the current
  // period is flagged here too -- a missing recurring cost is easier to overlook
  // than an unexpected one. Previously a hardcoded ['Rent','Electricity','Internet']
  // array; now sourced from the same rules table so there's one definition of
  // "what counts as recurring," not two independent lists.
  const { data: account } = await supabaseAdmin.from('bank_accounts').select('entity_key').eq('id', bankAccountId).single()
  const watch: { type: string; last_seen_period: string }[] = []
  if (account) {
    const { data: rules } = await supabaseAdmin
      .from('recurring_expense_rules')
      .select('type')
      .eq('entity_key', account.entity_key)
      .eq('is_active', true)
    const recurringTypes = [...new Set((rules || []).map((r) => r.type))]
    for (const type of recurringTypes) {
      const { data: history } = await supabaseAdmin
        .from('expenses')
        .select('expense_date')
        .eq('entity_key', account.entity_key)
        .eq('type', type)
        .lt('expense_date', periodStart)
        .order('expense_date', { ascending: false })
        .limit(1)
      if (!history || history.length === 0) continue // no history for this type -- nothing to expect yet

      const { data: inPeriod } = await supabaseAdmin
        .from('expenses')
        .select('id')
        .eq('entity_key', account.entity_key)
        .eq('type', type)
        .gte('expense_date', periodStart)
        .lte('expense_date', periodEnd)
        .limit(1)
      if (!inPeriod || inPeriod.length === 0) {
        watch.push({ type, last_seen_period: history[0].expense_date })
      }
    }
  }

  return {
    total_count: rows.length,
    open_count: openCount,
    matched_count: matchedCount,
    by_status: byStatus,
    total_debit: totalDebit,
    total_credit: totalCredit,
    recurring_expense_watch: watch,
  }
}

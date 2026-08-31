import { supabaseAdmin } from '@/lib/supabase/service'

// Credit-side matching candidates: a bank credit vs. sale_payments (Phase 6's
// matching logic; Phase 7 is what actually records a confirmed match into
// bank_transaction_matches and updates recon_status -- this module only suggests).

const AMOUNT_TOLERANCE_PCT = 0.02 // 2% -- covers a payment gateway/TDS shave, not a typo
const DATE_WINDOW_DAYS = 5

export interface CreditCandidate {
  sale_payment_id: string
  sale_id: string
  amount: number
  payment_account: string | null
  recorded_at: string
  customer_name: string | null
  amount_delta: number
  date_delta_days: number
  score: number
}

// Extracts a plausible payer name from a UPI/NEFT narration (e.g.
// "UPI/123456789/RAJESH KUMAR/HDFC BANK/..." or "NEFT-HDFC0001234-RAJESH KUMAR-...")
// -- deliberately permissive since bank narration formats vary by bank; a bad guess
// here only means match_customers_by_name returns nothing useful, not a wrong write.
function guessPayerName(narration: string): string | null {
  const parts = narration.split(/[\/\-]/).map((p) => p.trim()).filter(Boolean)
  // Prefer a segment that looks like a name (letters/spaces, no digits, 3+ chars) --
  // bank/UPI ids and reference numbers are usually alphanumeric or pure digits.
  const nameLike = parts.find((p) => /^[a-zA-Z ]{3,}$/.test(p) && !/bank|upi|neft|rtgs|imps/i.test(p))
  return nameLike || null
}

export async function findCreditCandidates(params: {
  amount: number
  txnDate: string
  entityKey: string
}): Promise<CreditCandidate[]> {
  const { amount, txnDate, entityKey } = params

  const lower = amount * (1 - AMOUNT_TOLERANCE_PCT)
  const upper = amount * (1 + AMOUNT_TOLERANCE_PCT)
  const windowStart = new Date(new Date(txnDate).getTime() - DATE_WINDOW_DAYS * 86400000).toISOString().slice(0, 10)
  const windowEnd = new Date(new Date(txnDate).getTime() + DATE_WINDOW_DAYS * 86400000).toISOString().slice(0, 10)

  // entityKey ('digitalbluez'/'techtenth'/'cash') maps to sale_payments.payment_account
  // ('Digitalbluez'/'Techtenth'/'Cash') by capitalization -- same three-entity model
  // used throughout (business_profiles.key vs. the *_account text columns).
  const paymentAccount = entityKey.charAt(0).toUpperCase() + entityKey.slice(1)

  const { data: payments } = await supabaseAdmin
    .from('sale_payments')
    .select('id, sale_id, amount, payment_account, recorded_at, sales(customer_name)')
    .gte('amount', lower)
    .lte('amount', upper)
    .gte('recorded_at', windowStart)
    .lte('recorded_at', windowEnd)
    .eq('payment_account', paymentAccount)

  return (payments || []).map((p: any) => {
    const dateDelta = Math.abs((new Date(p.recorded_at).getTime() - new Date(txnDate).getTime()) / 86400000)
    const amountDelta = Math.abs(p.amount - amount)
    // Exact amount + same day scores highest; tolerance/window usage decays the score
    // rather than excluding -- this is a suggestion list, not a filter.
    const score = (1 - amountDelta / amount) * 7 + (1 - dateDelta / DATE_WINDOW_DAYS) * 3
    return {
      sale_payment_id: p.id,
      sale_id: p.sale_id,
      amount: p.amount,
      payment_account: p.payment_account,
      recorded_at: p.recorded_at,
      customer_name: p.sales?.customer_name || null,
      amount_delta: amountDelta,
      date_delta_days: dateDelta,
      score,
    }
  }).sort((a, b) => b.score - a.score)
}

export interface CustomerNameGuess {
  guessed_name: string | null
  candidates: { id: string; customer_name: string; similarity: number }[]
}

export async function guessPayerCustomer(narration: string): Promise<CustomerNameGuess> {
  const guessedName = guessPayerName(narration)
  if (!guessedName) return { guessed_name: null, candidates: [] }
  const { data } = await supabaseAdmin.rpc('match_customers_by_name', { p_name: guessedName, p_limit: 3 })
  return { guessed_name: guessedName, candidates: data || [] }
}

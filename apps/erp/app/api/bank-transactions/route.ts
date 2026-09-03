import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { parsePagination } from '@/lib/pagination'
import { findCreditCandidates, guessPayerCustomer } from '@/lib/recon/credit-matcher'
import { findPurchaseCandidates } from '@/lib/recon/purchase-matcher'

// ---------- GET: paginated transaction list, with optional credit-candidate suggestions ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const bankAccountId = searchParams.get('bank_account_id')
  const reconStatus = searchParams.get('recon_status')
  const dateFrom = searchParams.get('date_from')
  const dateTo = searchParams.get('date_to')
  const withCandidates = searchParams.get('with_candidates') === 'true'
  const pagination = parsePagination(searchParams)

  let query = supabaseAdmin.from('bank_transactions').select('*, bank_accounts(label, entity_key)', pagination ? { count: 'exact' } : {}).order('txn_date', { ascending: false })
  if (bankAccountId) query = query.eq('bank_account_id', bankAccountId)
  if (reconStatus) query = query.eq('recon_status', reconStatus)
  // Date-range filtering happens here, in the DB query -- not by over-fetching a fixed
  // page and filtering client-side, which silently drops any month outside whatever
  // that page's newest-N rows happen to cover once an account has more transactions
  // than the page size (see docs/decisions.md, the Recon Sessions month-window bug).
  if (dateFrom) query = query.gte('txn_date', dateFrom)
  if (dateTo) query = query.lte('txn_date', dateTo)
  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let rows: any[] = data || []
  if (withCandidates) {
    rows = await Promise.all(rows.map(async (t) => {
      if (t.recon_status !== 'open') return t
      const entityKey = t.bank_accounts?.entity_key || 'digitalbluez'
      if (t.credit) {
        const [candidates, payerGuess] = await Promise.all([
          findCreditCandidates({ amount: t.credit, txnDate: t.txn_date, entityKey }),
          guessPayerCustomer(t.narration),
        ])
        return { ...t, credit_candidates: candidates, payer_guess: payerGuess }
      }
      if (t.debit) {
        const candidates = await findPurchaseCandidates({ narration: t.narration, amount: t.debit, txnDate: t.txn_date, entityKey })
        return { ...t, purchase_candidates: candidates }
      }
      return t
    }))
  }

  if (pagination) return NextResponse.json({ data: rows, total: count || 0 })
  return NextResponse.json(rows)
}

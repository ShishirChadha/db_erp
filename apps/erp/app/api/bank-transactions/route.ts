import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { parsePagination } from '@/lib/pagination'
import { findCreditCandidates, guessPayerCustomer } from '@/lib/recon/credit-matcher'

// ---------- GET: paginated transaction list, with optional credit-candidate suggestions ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const bankAccountId = searchParams.get('bank_account_id')
  const reconStatus = searchParams.get('recon_status')
  const withCandidates = searchParams.get('with_candidates') === 'true'
  const pagination = parsePagination(searchParams)

  let query = supabaseAdmin.from('bank_transactions').select('*, bank_accounts(label, entity_key)', pagination ? { count: 'exact' } : {}).order('txn_date', { ascending: false })
  if (bankAccountId) query = query.eq('bank_account_id', bankAccountId)
  if (reconStatus) query = query.eq('recon_status', reconStatus)
  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let rows: any[] = data || []
  if (withCandidates) {
    rows = await Promise.all(rows.map(async (t) => {
      if (t.recon_status !== 'open' || !t.credit) return t
      const [candidates, payerGuess] = await Promise.all([
        findCreditCandidates({ amount: t.credit, txnDate: t.txn_date, entityKey: t.bank_accounts?.entity_key || 'digitalbluez' }),
        guessPayerCustomer(t.narration),
      ])
      return { ...t, credit_candidates: candidates, payer_guess: payerGuess }
    }))
  }

  if (pagination) return NextResponse.json({ data: rows, total: count || 0 })
  return NextResponse.json(rows)
}

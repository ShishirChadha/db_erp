import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'

// A customer's store-credit balance (customer_credit_ledger) -- issued when a plain
// return (lib/rma.ts's processCustomerReturn) is resolved with type 'credit_note',
// debited when a sale is paid with payment_account 'Customer Credit'
// (app/api/sales/[id]/payments/route.ts). Balance is always derived by summing the
// append-only ledger, never stored.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, ['live_stock', 'new_entry', 'sales'])) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { id } = await params
  const { data, error } = await supabaseAdmin
    .from('customer_credit_ledger')
    .select('id, sale_id, amount, reason, created_at')
    .eq('customer_id', id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const balance = (data || []).reduce((sum, r: any) => sum + Number(r.amount), 0)
  return NextResponse.json({ balance, ledger: data || [] })
}

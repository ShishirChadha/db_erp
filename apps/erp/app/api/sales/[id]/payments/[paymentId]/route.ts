import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// ---------- DELETE: remove an erroneous payment entry ----------
// Owner-only correction (a mis-entered installment) -- the trigger on sale_payments
// recomputes sales.amount_paid/payment_status automatically after the delete.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id, paymentId } = await params
  const { error } = await supabaseAdmin
    .from('sale_payments')
    .delete()
    .eq('id', paymentId)
    .eq('sale_id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: updatedSale } = await supabaseAdmin
    .from('sales')
    .select('amount_paid, payment_status')
    .eq('id', id)
    .single()

  return NextResponse.json({ sale: updatedSale })
}

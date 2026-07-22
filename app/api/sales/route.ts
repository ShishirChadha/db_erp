import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// ---------- GET: the full Sales ledger (every sale, unit + accessory) ----------
// Owner-only -- this is the transactional/financial view (payment state, incentive
// attribution), distinct from the Sold Stock tab on the Stock page (inventory/warranty
// view, employee-visible). Both read from the same `sales` table.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const paymentStatus = searchParams.get('payment_status')
  const search = searchParams.get('search')

  let query = supabaseAdmin
    .from('sales')
    .select('*')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })

  if (paymentStatus) query = query.eq('payment_status', paymentStatus)
  if (search) {
    query = query.or(`customer_name.ilike.%${search}%,asset_number.ilike.%${search}%,serial_number.ilike.%${search}%,invoice_number.ilike.%${search}%`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // sold_by is already a plain name (see custom_options 'staff_names') -- no join needed.
  return NextResponse.json(data)
}

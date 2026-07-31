import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { resolveEntityKey } from '@/lib/invoice-finalize'
import { parsePagination } from '@/lib/pagination'

// ---------- GET: the full Sales ledger (every sale, unit + accessory) ----------
// This is the transactional/financial view (payment state, incentive attribution),
// distinct from the Sold Stock tab on the Stock page (inventory/warranty view). Both
// read from the same `sales` table. View requires the 'sales' page grant; finalize/void
// stay owner-only (see [id]/finalize, [id]/void, finalize-batch, record-external-invoice).
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!hasPageAccess(sessionUser, 'sales')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const paymentStatus = searchParams.get('payment_status')
  const search = searchParams.get('search')
  const finalized = searchParams.get('finalized') // optional 'true'/'false' -- e.g. "Awaiting Invoice" filter
  const pagination = parsePagination(searchParams)

  let query = supabaseAdmin
    .from('sales')
    .select('*', pagination ? { count: 'exact' } : undefined)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })

  if (paymentStatus) query = query.eq('payment_status', paymentStatus)
  if (finalized === 'true') query = query.eq('finalized', true)
  if (finalized === 'false') query = query.eq('finalized', false)
  if (search) {
    query = query.or(`customer_name.ilike.%${search}%,asset_number.ilike.%${search}%,serial_number.ilike.%${search}%,invoice_number.ilike.%${search}%`)
  }
  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // customer_name is a snapshot frozen at sale creation. For sales not yet finalized
  // into a GST invoice, prefer the customer's current name/details instead -- an
  // owner correcting incomplete/wrong info an employee entered (e.g. missing company
  // address) should see it reflected here immediately rather than only on the next
  // sale. Finalized sales keep their frozen snapshot untouched (legal GST record).
  const unfinalizedCustomerIds = [...new Set(
    (data || []).filter((s: any) => !s.finalized && s.customer_id).map((s: any) => s.customer_id)
  )]
  const { data: liveCustomers } = unfinalizedCustomerIds.length
    ? await supabaseAdmin.from('customers').select('id, customer_name').in('id', unfinalizedCustomerIds)
    : { data: [] as any[] }
  const liveNameById = new Map((liveCustomers || []).map((c: any) => [c.id, c.customer_name]))

  // Per-sale invoicing mode (Zoho transition): resolve each sale's entity from its
  // payment_account and tag it 'erp' or 'external' so the ledger UI shows the right
  // action -- "Generate Invoice" (ERP) vs "Record Zoho Invoice #" (external).
  const { data: profiles } = await supabaseAdmin.from('business_profiles').select('key, invoicing_mode')
  const modeByKey = new Map((profiles || []).map((p: any) => [p.key, p.invoicing_mode]))

  const result = (data || []).map((s: any) => {
    const withName = !s.finalized && s.customer_id && liveNameById.has(s.customer_id)
      ? { ...s, customer_name: liveNameById.get(s.customer_id) }
      : { ...s }
    withName.invoice_mode = modeByKey.get(resolveEntityKey(s.payment_account)) === 'external' ? 'external' : 'erp'
    return withName
  })

  // sold_by is already a plain name (see custom_options 'staff_names') -- no join needed.
  if (pagination) return NextResponse.json({ data: result, total: count ?? 0 })
  return NextResponse.json(result)
}

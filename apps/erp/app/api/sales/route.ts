import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { resolveEntityKey } from '@/lib/invoice-finalize'
import { parsePagination } from '@/lib/pagination'
import { latestPaymentDatesBySaleId } from '@/lib/sale-payment-dates'
import { buildCustomerSummary } from '@/lib/customer-summary'

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
  const receivedInto = searchParams.get('received_into')
  const search = searchParams.get('search')
  const finalized = searchParams.get('finalized') // optional 'true'/'false' -- e.g. "Awaiting Invoice" filter
  const sortKey = searchParams.get('sort')
  const sortDir = searchParams.get('dir') === 'desc' ? -1 : 1
  // Mirrors the Vendors page's "Show deleted" toggle -- the ledger's normal view is
  // always active (non-voided) sales; passing voided=true instead shows ONLY voided
  // ones (an audit/reference view of what was corrected and why), never both mixed
  // together, so a voided sale never silently reappears in the operational view.
  const voided = searchParams.get('voided') === 'true'
  const pagination = parsePagination(searchParams)

  // Stat-card counts mode: SQL exact counts for the same filters the ledger's stat
  // cards use (search/payment_status/received_into, never `finalized` -- matches
  // sales/page.tsx's fetchStats, which deliberately omits it so Pending/Partial/
  // Awaiting Invoice always count across both finalized states). Replaces an
  // unpaginated select('*') + JS .filter().length that silently plateaued at
  // PostgREST's row cap as the ledger grew.
  if (searchParams.get('counts') === 'true') {
    const countQuery = (extra: (q: any) => any) => {
      let q = supabaseAdmin.from('sales').select('id', { count: 'exact', head: true }).eq('is_deleted', voided)
      if (paymentStatus) q = q.eq('payment_status', paymentStatus)
      if (receivedInto) q = q.eq('payment_account', receivedInto)
      if (search) q = q.or(`customer_name.ilike.%${search}%,asset_number.ilike.%${search}%,serial_number.ilike.%${search}%,invoice_number.ilike.%${search}%`)
      return extra(q)
    }
    const [totalSold, pending, partial, awaitingInvoice] = await Promise.all([
      countQuery((q: any) => q),
      countQuery((q: any) => q.eq('payment_status', 'pending')),
      countQuery((q: any) => q.eq('payment_status', 'partial')),
      countQuery((q: any) => q.eq('finalized', false)),
    ])
    return NextResponse.json({
      totalCount: totalSold.count || 0,
      pendingCount: pending.count || 0,
      partialCount: partial.count || 0,
      awaitingInvoiceCount: awaitingInvoice.count || 0,
    })
  }

  // Sorting has to happen after enrichment below, not in this query -- several
  // sortable columns (description/RAM/SSD/bundle) are resolved from sku_master
  // post-fetch, not real columns on `sales`. So this always fetches every row
  // matching the filters (no .range() here); pagination is applied in JS after
  // sort, over the full filtered+enriched set, so sorting is correct across pages
  // rather than just within whichever page happened to be fetched.
  let query = supabaseAdmin
    .from('sales')
    .select('*')
    .eq('is_deleted', voided)
    .order('created_at', { ascending: false })

  if (paymentStatus) query = query.eq('payment_status', paymentStatus)
  if (receivedInto) query = query.eq('payment_account', receivedInto)
  if (finalized === 'true') query = query.eq('finalized', true)
  if (finalized === 'false') query = query.eq('finalized', false)
  if (search) {
    query = query.or(`customer_name.ilike.%${search}%,asset_number.ilike.%${search}%,serial_number.ilike.%${search}%,invoice_number.ilike.%${search}%`)
  }

  const { data, error } = await query
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

  // Small disambiguation summary (type/contact/address/source) shown next to every
  // customer name in the ledger -- see lib/customer-summary.ts. Always live (not
  // frozen), for every sale regardless of finalized state, since it's informational
  // rather than a legal invoice field.
  const allCustomerIds = [...new Set((data || []).filter((s: any) => s.customer_id).map((s: any) => s.customer_id))]
  const { data: summaryCustomers } = allCustomerIds.length
    ? await supabaseAdmin.from('customers').select('id, type, contact_person, address_line1, address_line2, city, source').in('id', allCustomerIds)
    : { data: [] as any[] }
  const customerSummaryById = new Map((summaryCustomers || []).map((c: any) => [c.id, buildCustomerSummary(c)]))

  // Per-sale invoicing mode (Zoho transition): resolve each sale's entity from its
  // payment_account and tag it 'erp' or 'external' so the ledger UI shows the right
  // action -- "Generate Invoice" (ERP) vs "Record Zoho Invoice #" (external).
  const { data: profiles } = await supabaseAdmin.from('business_profiles').select('key, invoicing_mode')
  const modeByKey = new Map((profiles || []).map((p: any) => [p.key, p.invoicing_mode]))

  // Product description: accessory sales point at sku_master directly via
  // accessory_id; unit sales need asset_ledger_id -> asset_ledger.sku_id first.
  // Same pattern as /api/stock/sold-accessories.
  const assetLedgerIds = [...new Set((data || []).map((s: any) => s.asset_ledger_id).filter(Boolean))]
  const { data: assetLedgerRows } = assetLedgerIds.length
    ? await supabaseAdmin.from('asset_ledger').select('id, sku_id').in('id', assetLedgerIds)
    : { data: [] as any[] }
  const skuIdByAssetLedgerId = new Map((assetLedgerRows || []).map((a: any) => [a.id, a.sku_id]))

  // Include specifications/category so the ledger can surface RAM/SSD directly
  // (specifications.ram / specifications.ssd -- see sku_category_templates field
  // naming convention, same keys used by website-admin upgrade rules).
  const skuIds = [...new Set(
    (data || [])
      .map((s: any) => s.accessory_id || skuIdByAssetLedgerId.get(s.asset_ledger_id))
      .filter(Boolean)
  )]
  const { data: skus } = skuIds.length
    ? await supabaseAdmin.from('sku_master').select('id, full_sku_code, sku_description, specifications').in('id', skuIds)
    : { data: [] as any[] }
  const skuById = new Map((skus || []).map((s: any) => [s.id, s]))

  // Bundled accessories are stored inline on the unit's own sales row
  // (sales.bundled_accessories JSONB: [{accessory_id, quantity, unit_price}]) --
  // resolve each accessory_id to a display name in one batched lookup.
  const bundledAccessoryIds = [...new Set(
    (data || []).flatMap((s: any) => (Array.isArray(s.bundled_accessories) ? s.bundled_accessories : []).map((b: any) => b.accessory_id).filter(Boolean))
  )]
  const { data: bundledSkus } = bundledAccessoryIds.length
    ? await supabaseAdmin.from('sku_master').select('id, full_sku_code, sku_description').in('id', bundledAccessoryIds)
    : { data: [] as any[] }
  const bundledSkuById = new Map((bundledSkus || []).map((s: any) => [s.id, s]))

  // Repair-derived sales rows (sales.repair_job_id) have no sku_master row --
  // resolve their display text from the linked repair_jobs row instead.
  const repairJobIds = [...new Set((data || []).map((s: any) => s.repair_job_id).filter(Boolean))]
  const { data: repairJobs } = repairJobIds.length
    ? await supabaseAdmin.from('repair_jobs').select('id, job_number, problem_description').in('id', repairJobIds)
    : { data: [] as any[] }
  const repairJobById = new Map((repairJobs || []).map((r: any) => [r.id, r]))

  // Most recent sale_payments installment date per sale -- shown as "Payment Date"
  // alongside sale_date; a sale with 2+ partial payments shows its latest one.
  const paymentDateBySaleId = await latestPaymentDatesBySaleId((data || []).map((s: any) => s.id))

  const result = (data || []).map((s: any) => {
    const withName = !s.finalized && s.customer_id && liveNameById.has(s.customer_id)
      ? { ...s, customer_name: liveNameById.get(s.customer_id) }
      : { ...s }
    withName.customer_summary = s.customer_id ? customerSummaryById.get(s.customer_id) || null : null
    withName.invoice_mode = modeByKey.get(resolveEntityKey(s.payment_account)) === 'external' ? 'external' : 'erp'
    const sku = skuById.get(s.accessory_id || skuIdByAssetLedgerId.get(s.asset_ledger_id))
    withName.sku_description = sku?.sku_description || null
    withName.full_sku_code = sku?.full_sku_code || null
    withName.ram = sku?.specifications?.ram || null
    withName.ssd = sku?.specifications?.ssd || null
    withName.bundled_accessories_display = (Array.isArray(s.bundled_accessories) ? s.bundled_accessories : []).map((b: any) => {
      const bsku = bundledSkuById.get(b.accessory_id)
      return { name: bsku?.sku_description || bsku?.full_sku_code || 'Accessory', quantity: b.quantity }
    })
    const repairJob = s.repair_job_id ? repairJobById.get(s.repair_job_id) : null
    withName.repair_job_number = repairJob?.job_number || null
    withName.repair_description = repairJob?.problem_description || null
    withName.payment_date = paymentDateBySaleId.get(s.id) || null
    return withName
  })

  // sold_by is already a plain name (see custom_options 'staff_names') -- no join needed.
  if (sortKey) {
    const value = getSortValue(sortKey)
    result.sort((a: any, b: any) => {
      const av = value(a)
      const bv = value(b)
      if (av < bv) return -sortDir
      if (av > bv) return sortDir
      return 0
    })
  }

  if (pagination) {
    const page = result.slice(pagination.from, pagination.to + 1)
    return NextResponse.json({ data: page, total: result.length })
  }
  return NextResponse.json(result)
}

// Mirrors the column accessors in app/dashboard/sales/page.tsx's COLUMNS so
// "sort by X" means the same thing whether it's applied here (full dataset,
// pre-pagination) or would have been applied client-side.
function getSortValue(key: string): (s: any) => string | number {
  switch (key) {
    case 'sale_date': return (s) => s.sale_date || ''
    case 'payment_date': return (s) => s.payment_date || ''
    case 'customer_name': return (s) => s.customer_name || ''
    case 'item': return (s) => s.asset_number || (s.serial_number ? `SN: ${s.serial_number}` : s.accessory_id ? 'Accessory' : s.repair_job_id ? (s.repair_job_number || 'Repair') : '')
    case 'description': return (s) => s.sku_description || s.full_sku_code || s.repair_description || ''
    case 'ram': return (s) => s.ram || ''
    case 'ssd': return (s) => s.ssd || ''
    case 'bundle': return (s) => (s.bundled_accessories_display || []).length
    case 'sale_total': return (s) => s.sale_total || 0
    case 'payment_status': return (s) => s.payment_status || ''
    case 'amount_paid': return (s) => s.amount_paid || 0
    case 'payment_account': return (s) => s.payment_account || ''
    case 'sold_by': return (s) => s.sold_by || ''
    case 'invoice': return (s) => s.invoice_number || ''
    default: return () => 0
  }
}

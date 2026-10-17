// Single dispatcher for GST return data -- readiness, the pre-flight exception
// list, and the GSTR-1 working papers. One route, one auth path, so no screen
// can reach a differently-gated version of the same number.
//
// Owner-only and hard-403, matching how `gst_summary`/`data_health` are gated
// in app/api/reports/route.ts: a return exposes full cost-bearing turnover.
//
// Aggregation lives in SQL (v_gst_exceptions, gst_return_readiness) -- this
// route never re-derives a total in JS.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { parsePagination } from '@/lib/pagination'
import { resolveEntityKey } from '@/lib/invoice-finalize'

const METRICS = ['readiness', 'steps', 'exceptions', 'entities', 'r1_sections', 'r1_hsn', 'r1_docs',
  'completeness', 'r3b', 'books_vs_return', 'dashboard', 'uninvoiced'] as const

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const metric = sp.get('metric')
  if (!metric || !(METRICS as readonly string[]).includes(metric)) {
    return NextResponse.json({ error: `metric must be one of: ${METRICS.join(', ')}` }, { status: 400 })
  }

  try {
    // The list of entities a return can even be filed for. Driven by
    // is_gst_registered, never by matching an entity name.
    if (metric === 'entities') {
      const { data, error } = await supabaseAdmin
        .from('business_profiles')
        .select('key, legal_name, gstin, state_code, is_gst_registered')
        .eq('is_gst_registered', true)
        .order('key')
      if (error) throw error
      return NextResponse.json(data ?? [])
    }

    const entity = sp.get('entity')
    const from = sp.get('from')
    const to = sp.get('to')
    if (!entity) return NextResponse.json({ error: 'entity is required' }, { status: 400 })

    // The dashboard spans many periods, so it takes a month count rather than
    // a from/to range.
    if (metric === 'dashboard') {
      const months = Math.min(Math.max(parseInt(sp.get('months') || '12', 10) || 12, 1), 36)
      const { data, error } = await supabaseAdmin.rpc('gst_returns_dashboard', {
        p_entity_key: entity, p_months: months,
      })
      if (error) throw error
      return NextResponse.json(data)
    }

    if (!from || !to) return NextResponse.json({ error: 'from and to are required' }, { status: 400 })

    // GST sales in the period with no invoice recorded yet (guided-filing step 1). Filtered by the
    // same entity rule the SQL uses, so the list always matches the step's count.
    if (metric === 'uninvoiced') {
      const { data, error } = await supabaseAdmin
        .from('sales')
        .select('id, customer_name, effective_sale_date, sale_total, sale_gst, payment_status, payment_account, accessory_id, asset_ledger_id')
        .or('is_deleted.is.null,is_deleted.eq.false')
        .is('invoice_id', null).eq('sale_type', 'GST')
        .gte('effective_sale_date', from).lte('effective_sale_date', to)
        .order('effective_sale_date', { ascending: false })
      if (error) throw error
      const rows = (data ?? []).filter((s: any) => resolveEntityKey(s.payment_account) === entity)
      // Name the item: an accessory sale points at its SKU; a unit sale at its asset, whose
      // current SKU (after any reassignment) wins over the as-purchased one.
      const assetIds = [...new Set(rows.map((s: any) => s.asset_ledger_id).filter(Boolean))]
      const { data: assets } = assetIds.length
        ? await supabaseAdmin.from('asset_ledger').select('id, sku_id, current_sku_id, asset_number, serial_number').in('id', assetIds)
        : { data: [] as any[] }
      const assetById = new Map((assets ?? []).map((a: any) => [a.id, a]))
      const skuIds = [...new Set(rows.map((s: any) => s.accessory_id || (assetById.get(s.asset_ledger_id) as any)?.current_sku_id || (assetById.get(s.asset_ledger_id) as any)?.sku_id).filter(Boolean))]
      const { data: skus } = skuIds.length
        ? await supabaseAdmin.from('sku_master').select('id, sku_description, full_sku_code').in('id', skuIds)
        : { data: [] as any[] }
      const skuById = new Map((skus ?? []).map((k: any) => [k.id, k]))
      return NextResponse.json(rows.map((s: any) => {
        const a: any = assetById.get(s.asset_ledger_id)
        const sku: any = skuById.get(s.accessory_id || a?.current_sku_id || a?.sku_id)
        const { accessory_id, asset_ledger_id, ...rest } = s
        return { ...rest, item: sku?.sku_description || null, item_code: sku?.full_sku_code || null, unit_ref: a?.asset_number || a?.serial_number || null }
      }))
    }

    // Each working-paper metric is one RPC; the aggregation never happens here.
    const RPC_BY_METRIC: Record<string, string> = {
      readiness: 'gst_return_readiness',
      steps: 'gst_period_steps',
      r1_sections: 'gst_r1_sections',
      r1_hsn: 'gst_r1_hsn_summary',
      r1_docs: 'gst_r1_docs_issued',
      completeness: 'gst_completeness_worksheet',
      r3b: 'gst_r3b_summary',
      books_vs_return: 'gst_books_vs_return',
    }
    if (RPC_BY_METRIC[metric]) {
      const { data, error } = await supabaseAdmin.rpc(RPC_BY_METRIC[metric], {
        p_entity_key: entity, p_from: from, p_to: to,
      })
      if (error) throw error
      // 3B only: attach the ITC the portal will show from the latest GSTR-2B upload, so the
      // page can work out the net payable by head. Reverse-charge rows (rev = 'Y') are kept
      // apart -- that credit is only available after the tax is paid in cash.
      if (metric === 'r3b' && data && typeof data === 'object') {
        const { data: imp } = await supabaseAdmin
          .from('gst_recon_imports').select('id, created_at')
          .eq('entity_key', entity).eq('kind', 'gstr2b').eq('period_start', from)
          .order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (imp) {
          const { data: ls } = await supabaseAdmin
            .from('gst_recon_lines').select('cgst, sgst, igst, taxable_value, raw').eq('import_id', imp.id)
          const sum = { cgst: 0, sgst: 0, igst: 0, taxable: 0, invoices: 0 }
          const rcm = { cgst: 0, sgst: 0, igst: 0, taxable: 0, invoices: 0 }
          for (const l of ls ?? []) {
            const inv = (l.raw as any)?.inv
            if (!inv) continue
            const t = inv.rev === 'Y' ? rcm : sum
            t.cgst += Number(l.cgst) || 0; t.sgst += Number(l.sgst) || 0; t.igst += Number(l.igst) || 0
            t.taxable += Number(l.taxable_value) || 0; t.invoices += 1
          }
          const r2 = (n: number) => Math.round(n * 100) / 100
          const round = (o: any) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === 'invoices' ? v : r2(v as number)]))
          ;(data as any).itc_2b = { uploaded_at: imp.created_at, ...round(sum), reverse_charge: round(rcm) }
        }
      }
      return NextResponse.json(data)
    }

    // exceptions
    const group = sp.get('group')
    const severity = sp.get('severity')
    let q = supabaseAdmin
      .from('v_gst_exceptions')
      .select('*', { count: 'exact' })
      .eq('entity_key', entity)
      // A null period_month means the finding is not tied to one month (a bad
      // customer record, an unclassified SKU) -- it still blocks every period,
      // so it is always included rather than filtered out by the date range.
      .or(`period_month.is.null,and(period_month.gte.${from},period_month.lte.${to})`)
    if (group) q = q.eq('check_group', group)
    if (severity) q = q.eq('severity', severity)

    const pagination = parsePagination(sp)
    q = q.order('severity', { ascending: true }).order('check_code', { ascending: true })

    if (pagination) {
      const { from: rangeFrom, to: rangeTo } = pagination
      const { data, error, count } = await q.range(rangeFrom, rangeTo)
      if (error) throw error
      return NextResponse.json({ data: data ?? [], total: count ?? 0 })
    }

    const { data, error } = await q
    if (error) throw error
    return NextResponse.json(data ?? [])
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load GST data' }, { status: 500 })
  }
}

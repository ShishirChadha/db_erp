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

const METRICS = ['readiness', 'exceptions', 'entities', 'r1_sections', 'r1_hsn', 'r1_docs',
  'completeness', 'r3b', 'books_vs_return', 'dashboard'] as const

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

    // Each working-paper metric is one RPC; the aggregation never happens here.
    const RPC_BY_METRIC: Record<string, string> = {
      readiness: 'gst_return_readiness',
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

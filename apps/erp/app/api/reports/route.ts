// Single dispatcher for every reporting metric -- one route, one auth/redaction
// path, so a page/report/digest can never accidentally call a differently-gated
// endpoint for the same number. All metrics are computed by the report_* RPCs
// (apps/erp/db metrics layer, see migration reporting_metrics_rpcs) -- this route
// never re-derives an aggregate in JS.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner, hasPageAccess } from '@/lib/auth/session'
import { REPORT_DIMENSIONS, type ReportDimension } from '@/lib/reports'

const METRICS = ['kpis', 'timeseries', 'breakdown', 'inventory', 'receivables', 'gst_summary', 'data_health', 'expenses', 'expense_timeseries'] as const

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'reports')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const metric = sp.get('metric')
  if (!metric || !(METRICS as readonly string[]).includes(metric)) {
    return NextResponse.json({ error: `metric must be one of: ${METRICS.join(', ')}` }, { status: 400 })
  }

  // Only the owner ever sees cost/vendor/margin -- matches the redaction rule for
  // every other financial surface in the app (lib/auth/redact.ts).
  const includeFinancials = isOwner(sessionUser)

  const from = sp.get('from')
  const to = sp.get('to')

  try {
    switch (metric) {
      case 'kpis': {
        if (!from || !to) return NextResponse.json({ error: 'from and to are required' }, { status: 400 })
        const compareFrom = sp.get('compare_from')
        const compareTo = sp.get('compare_to')
        const { data, error } = await supabaseAdmin.rpc('report_kpis', {
          p_from: from, p_to: to,
          p_compare_from: compareFrom || null, p_compare_to: compareTo || null,
          p_include_financials: includeFinancials,
        })
        if (error) throw error
        return NextResponse.json(data)
      }
      case 'timeseries': {
        if (!from || !to) return NextResponse.json({ error: 'from and to are required' }, { status: 400 })
        const grain = sp.get('grain') || 'day'
        const { data, error } = await supabaseAdmin.rpc('report_timeseries', {
          p_from: from, p_to: to, p_grain: grain, p_include_financials: includeFinancials,
        })
        if (error) throw error
        return NextResponse.json(data)
      }
      case 'breakdown': {
        if (!from || !to) return NextResponse.json({ error: 'from and to are required' }, { status: 400 })
        const dimension = sp.get('dimension') as ReportDimension | null
        if (!dimension || !(REPORT_DIMENSIONS as readonly string[]).includes(dimension)) {
          return NextResponse.json({ error: `dimension must be one of: ${REPORT_DIMENSIONS.join(', ')}` }, { status: 400 })
        }
        const limit = Math.min(parseInt(sp.get('limit') || '20', 10) || 20, 100)
        const { data, error } = await supabaseAdmin.rpc('report_breakdown', {
          p_from: from, p_to: to, p_dimension: dimension, p_include_financials: includeFinancials, p_limit: limit,
        })
        if (error) throw error
        return NextResponse.json(data)
      }
      case 'inventory': {
        const { data, error } = await supabaseAdmin.rpc('report_inventory', { p_include_financials: includeFinancials })
        if (error) throw error
        return NextResponse.json(data)
      }
      case 'receivables': {
        // Receivables are collections-status, not cost/vendor/margin -- visible to
        // any signed-in staff the same way sale_payments already is.
        const { data, error } = await supabaseAdmin.rpc('report_receivables')
        if (error) throw error
        return NextResponse.json(data)
      }
      case 'gst_summary': {
        if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
        if (!from || !to) return NextResponse.json({ error: 'from and to are required' }, { status: 400 })
        const { data, error } = await supabaseAdmin.rpc('report_gst_summary', { p_from: from, p_to: to })
        if (error) throw error
        return NextResponse.json(data)
      }
      case 'data_health': {
        if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
        const { data, error } = await supabaseAdmin.rpc('report_data_health')
        if (error) throw error
        return NextResponse.json(data)
      }
      case 'expenses': {
        if (!from || !to) return NextResponse.json({ error: 'from and to are required' }, { status: 400 })
        const { data, error } = await supabaseAdmin.rpc('report_expenses', { p_from: from, p_to: to })
        if (error) throw error
        return NextResponse.json(data)
      }
      case 'expense_timeseries': {
        if (!from || !to) return NextResponse.json({ error: 'from and to are required' }, { status: 400 })
        const grain = sp.get('grain') || 'day'
        const { data, error } = await supabaseAdmin.rpc('report_expense_timeseries', { p_from: from, p_to: to, p_grain: grain })
        if (error) throw error
        return NextResponse.json(data)
      }
      default:
        return NextResponse.json({ error: 'Unknown metric' }, { status: 400 })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Report query failed' }, { status: 500 })
  }
}

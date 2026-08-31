// Composes one digest's data payload from the report_* RPCs -- the same metrics
// layer every dashboard/report reads (see reporting-metrics migrations). A digest
// never re-derives a number of its own; it only picks which of the existing
// report_kpis/report_timeseries/report_breakdown/report_inventory/report_receivables/
// report_data_health results to include, gated by both the recipient's role and
// their chosen `blocks` (see lib/digests/blocks.ts) -- fetches for an unselected
// block are skipped entirely rather than fetched and discarded.
import { supabaseAdmin } from '@/lib/supabase/service'
import { yesterday, previousWeek, previousFortnight, monthToDate, prevPeriod } from '@/lib/reports'
import { sanitizeBlocks } from './blocks'

export type DigestPeriod = 'daily' | 'weekly' | 'fortnightly' | 'monthly'
export type DigestRole = 'owner' | 'manager' | 'employee'

export interface DigestPayload {
  period: DigestPeriod
  periodLabel: string
  from: string
  to: string
  role: DigestRole
  blocks: string[]
  kpis: any
  timeseries: any[] | null
  categoryBreakdown: any[] | null
  staffBreakdown: any[] | null
  saleTypeSplit: any[] | null
  vendorBreakdown: any[] | null
  inventory: any
  receivables: any
  dataHealth: any // owner only
}

// Daily/Weekly/Fortnightly recap the most recently *closed* calendar period
// (yesterday / last Mon-Sun week / last half-month) -- the standard "digest" pattern,
// each fired once at that period's natural boundary. Monthly is deliberately
// different: month-to-date (1st of the current month through today), not a rolling
// 30-day window and not last month's closed recap -- so "Send test now" mid-month
// always shows the real current month so far, matching Dashboard/Reports' own
// "Month to Date" preset. Fired via cron on the 1st it will show just that one day,
// which is expected (a fresh-month kickoff), not a bug.
export function periodRange(period: DigestPeriod): { from: string; to: string; label: string } {
  if (period === 'daily') {
    const { from, to } = yesterday()
    return { from, to, label: `Daily — ${new Date(from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` }
  }
  if (period === 'weekly') {
    const { from, to } = previousWeek()
    return { from, to, label: `Week — ${new Date(from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} to ${new Date(to).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` }
  }
  if (period === 'fortnightly') {
    const { from, to } = previousFortnight()
    return { from, to, label: `Fortnight — ${from} to ${to}` }
  }
  const { from, to } = monthToDate()
  return { from, to, label: `Month to Date — ${new Date(to).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}` }
}

// Only the daily digest is genuinely time-boxed to "run once" (any day qualifies);
// weekly/fortnightly/monthly only make sense to actually send on their boundary
// day, even though dispatch_digests() polls every 15 minutes for every subscription.
export function isDueToday(period: DigestPeriod, ref = new Date()): boolean {
  if (period === 'daily') return true
  if (period === 'weekly') return ref.getDay() === 1 // Monday, recapping the week that just closed
  const day = ref.getDate()
  if (period === 'fortnightly') return day === 1 || day === 16
  return day === 1 // monthly
}

export async function buildDigestPayload(period: DigestPeriod, role: DigestRole, requestedBlocks?: string[] | null): Promise<DigestPayload> {
  const { from, to, label } = periodRange(period)
  const compare = prevPeriod(from, to)
  const includeFinancials = role === 'owner'
  const blocks = sanitizeBlocks(requestedBlocks, role)
  const has = (id: string) => blocks.includes(id)

  const [
    kpisRes, timeseriesRes, categoryRes, staffRes, saleTypeRes, vendorRes, inventoryRes, receivablesRes, dataHealthRes,
  ] = await Promise.all([
    has('kpis') || has('margin')
      ? supabaseAdmin.rpc('report_kpis', {
          p_from: from, p_to: to, p_compare_from: compare.from, p_compare_to: compare.to, p_include_financials: includeFinancials,
        })
      : Promise.resolve({ data: null }),
    has('trend')
      ? supabaseAdmin.rpc('report_timeseries', { p_from: from, p_to: to, p_grain: 'day', p_include_financials: includeFinancials })
      : Promise.resolve({ data: null }),
    has('category_breakdown')
      ? supabaseAdmin.rpc('report_breakdown', { p_from: from, p_to: to, p_dimension: 'category', p_include_financials: includeFinancials, p_limit: 8 })
      : Promise.resolve({ data: null }),
    has('staff_breakdown')
      ? supabaseAdmin.rpc('report_breakdown', { p_from: from, p_to: to, p_dimension: 'staff', p_include_financials: includeFinancials, p_limit: 8 })
      : Promise.resolve({ data: null }),
    has('sale_type_split')
      ? supabaseAdmin.rpc('report_breakdown', { p_from: from, p_to: to, p_dimension: 'sale_type', p_include_financials: includeFinancials, p_limit: 5 })
      : Promise.resolve({ data: null }),
    has('purchasing')
      ? supabaseAdmin.rpc('report_breakdown', { p_from: from, p_to: to, p_dimension: 'vendor', p_include_financials: includeFinancials, p_limit: 8 })
      : Promise.resolve({ data: null }),
    has('inventory')
      ? supabaseAdmin.rpc('report_inventory', { p_include_financials: includeFinancials })
      : Promise.resolve({ data: null }),
    has('receivables')
      ? supabaseAdmin.rpc('report_receivables')
      : Promise.resolve({ data: null }),
    has('data_health')
      ? supabaseAdmin.rpc('report_data_health')
      : Promise.resolve({ data: null }),
  ])

  return {
    period, periodLabel: label, from, to, role, blocks,
    kpis: kpisRes.data,
    timeseries: timeseriesRes.data,
    categoryBreakdown: categoryRes.data,
    staffBreakdown: staffRes.data,
    saleTypeSplit: saleTypeRes.data,
    vendorBreakdown: vendorRes.data,
    inventory: inventoryRes.data,
    receivables: receivablesRes.data,
    dataHealth: dataHealthRes.data,
  }
}

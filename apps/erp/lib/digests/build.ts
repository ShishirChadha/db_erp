// Composes one digest's data payload from the report_* RPCs -- the same metrics
// layer every dashboard/report reads (see reporting-metrics migrations). A digest
// never re-derives a number of its own; it only picks which of the existing
// report_kpis/report_inventory/report_receivables/report_data_health results to
// include, gated by the recipient's role exactly like /api/reports does.
import { supabaseAdmin } from '@/lib/supabase/service'
import { yesterday, previousFortnight, lastMonthFull, prevPeriod, toDateStr } from '@/lib/reports'

export type DigestPeriod = 'daily' | 'fortnightly' | 'monthly'
export type DigestRole = 'owner' | 'manager' | 'employee'

export interface DigestPayload {
  period: DigestPeriod
  periodLabel: string
  from: string
  to: string
  role: DigestRole
  kpis: any
  inventory: any
  receivables: any
  dataHealth: any // owner only
}

export function periodRange(period: DigestPeriod): { from: string; to: string; label: string } {
  if (period === 'daily') {
    const { from, to } = yesterday()
    return { from, to, label: `Daily — ${new Date(from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` }
  }
  if (period === 'fortnightly') {
    const { from, to } = previousFortnight()
    return { from, to, label: `Fortnight — ${from} to ${to}` }
  }
  const { from, to } = lastMonthFull()
  return { from, to, label: `Monthly — ${new Date(from).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}` }
}

// Only the daily digest is genuinely time-boxed to "run once" (any day qualifies);
// fortnightly/monthly only make sense to actually send on their boundary day, even
// though dispatch_digests() polls every 15 minutes for every subscription.
export function isDueToday(period: DigestPeriod, ref = new Date()): boolean {
  if (period === 'daily') return true
  const day = ref.getDate()
  if (period === 'fortnightly') return day === 1 || day === 16
  return day === 1 // monthly
}

export async function buildDigestPayload(period: DigestPeriod, role: DigestRole): Promise<DigestPayload> {
  const { from, to, label } = periodRange(period)
  const compare = prevPeriod(from, to)
  const includeFinancials = role === 'owner'

  const [kpisRes, inventoryRes, receivablesRes, dataHealthRes] = await Promise.all([
    supabaseAdmin.rpc('report_kpis', {
      p_from: from, p_to: to, p_compare_from: compare.from, p_compare_to: compare.to, p_include_financials: includeFinancials,
    }),
    supabaseAdmin.rpc('report_inventory', { p_include_financials: includeFinancials }),
    role !== 'employee' ? supabaseAdmin.rpc('report_receivables') : Promise.resolve({ data: null }),
    role === 'owner' ? supabaseAdmin.rpc('report_data_health') : Promise.resolve({ data: null }),
  ])

  return {
    period, periodLabel: label, from, to, role,
    kpis: kpisRes.data,
    inventory: inventoryRes.data,
    receivables: receivablesRes.data,
    dataHealth: dataHealthRes.data,
  }
}

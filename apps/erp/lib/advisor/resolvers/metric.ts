// Resolver 2: a metric keyword ("revenue", "margin", "stock value", "receivables",
// "gst", "outstanding") resolves straight to the same report_* RPCs the Reports page
// itself calls -- lib/reports.ts's period helpers (via period-parse.ts) supply the
// date range, so "revenue last fortnight" is byte-for-byte the same number the
// Reports page's own fortnight button would show, because it's the same query.
//
// p_include_financials mirrors /api/reports/route.ts exactly: true only for the
// owner. A non-owner asking for margin/cost/GST gets told plainly that it's
// owner-only, rather than a redacted-looking zero.
import { supabaseAdmin } from '@/lib/supabase/service'
import { isOwner } from '@/lib/auth/session'
import { parsePeriod } from '../period-parse'
import type { AdvisorResult, ResolverContext } from '../types'

type MetricGroup = 'revenue' | 'margin' | 'stock_value' | 'receivables' | 'gst'

const KEYWORDS: { re: RegExp; group: MetricGroup; ownerOnly: boolean }[] = [
  { re: /\bmargin\b|\bprofit\b|\bcogs\b/i, group: 'margin', ownerOnly: true },
  { re: /\bgst\b|\btax\b/i, group: 'gst', ownerOnly: true },
  { re: /\bstock\s*value\b|\binventory\s*value\b/i, group: 'stock_value', ownerOnly: true },
  { re: /\breceivables?\b|\boutstanding\b|\bdue\b|\bunpaid\b|\bbaaki\b/i, group: 'receivables', ownerOnly: false },
  { re: /\brevenue\b|\bsales?\b|\bturnover\b|\bkitna\s*becha\b/i, group: 'revenue', ownerOnly: false },
]

export async function resolveMetric(ctx: ResolverContext): Promise<AdvisorResult | null> {
  const match = KEYWORDS.find((k) => k.re.test(ctx.text))
  if (!match) return null

  if (match.ownerOnly && !isOwner(ctx.user)) {
    return {
      resolver: 'metric',
      card: {
        kind: 'metric',
        title: 'Owner-only figure',
        lines: [{ label: '', value: `${match.group.replace('_', ' ')} is only visible to the owner.` }],
        sourceLabel: 'Reports',
      },
    }
  }

  const includeFinancials = isOwner(ctx.user)
  const period = parsePeriod(ctx.text)

  switch (match.group) {
    case 'revenue':
    case 'margin': {
      const { data, error } = await supabaseAdmin.rpc('report_kpis', {
        p_from: period.from, p_to: period.to, p_compare_from: null, p_compare_to: null,
        p_include_financials: includeFinancials,
      })
      if (error || !data) return null
      const c = (data as any).current
      const lines = [
        { label: 'Revenue (incl. GST)', value: formatInr(c.revenue_incl) },
        { label: 'Units sold', value: String(c.unit_sales_total ?? c.units ?? 0) },
        { label: 'Orders', value: String(c.order_count ?? 0) },
      ]
      if (includeFinancials && match.group === 'margin') {
        lines.push({ label: 'Gross margin (costed units)', value: formatInr(c.gross_margin_known) })
        lines.push({ label: 'Cost coverage', value: `${c.cost_coverage_pct ?? 0}%` })
      }
      return {
        resolver: 'metric',
        card: {
          kind: 'metric',
          title: match.group === 'margin' ? 'Margin' : 'Revenue',
          subtitle: `${period.label} (${period.from} to ${period.to})`,
          lines,
          href: `/dashboard/reports?from=${period.from}&to=${period.to}`,
          sourceLabel: 'Reports → KPIs',
        },
      }
    }
    case 'stock_value': {
      const { data, error } = await supabaseAdmin.rpc('report_inventory', { p_include_financials: includeFinancials })
      if (error || !data) return null
      const u = (data as any).units
      return {
        resolver: 'metric',
        card: {
          kind: 'metric',
          title: 'Stock value',
          lines: [
            { label: 'Stock value (at cost)', value: formatInr(u.stock_value_at_cost) },
            { label: 'Sellable units', value: String(u.sellable_count ?? 0) },
            { label: 'On hand', value: String(u.on_hand_count ?? 0) },
            { label: 'QC pending', value: String(u.qc_pending_count ?? 0) },
          ],
          href: '/dashboard/reports',
          sourceLabel: 'Reports → Inventory',
        },
      }
    }
    case 'receivables': {
      const { data, error } = await supabaseAdmin.rpc('report_receivables', {})
      if (error || !data) return null
      const buckets = (data as any).by_bucket as { bucket: string; outstanding: number; count: number }[]
      const total = buckets.reduce((sum, b) => sum + Number(b.outstanding || 0), 0)
      const topDebtor = ((data as any).top_debtors || [])[0]
      const lines = [
        { label: 'Total outstanding', value: formatInr(total) },
        ...buckets.map((b) => ({ label: `${b.bucket} days`, value: `${formatInr(b.outstanding)} (${b.count})` })),
      ]
      if (topDebtor) lines.push({ label: 'Largest', value: `${topDebtor.customer_name} — ${formatInr(topDebtor.outstanding)}` })
      return {
        resolver: 'metric',
        card: { kind: 'metric', title: 'Receivables', lines, href: '/dashboard/reports', sourceLabel: 'Reports → Receivables' },
      }
    }
    case 'gst': {
      const { data, error } = await supabaseAdmin.rpc('report_gst_summary', { p_from: period.from, p_to: period.to })
      if (error || !data) return null
      const g = data as any
      const rows = (g.by_month_entity || []) as { entity: string; gst: number; taxable_value: number; cash_revenue: number }[]
      const totalGst = rows.reduce((sum, r) => sum + Number(r.gst || 0), 0)
      const lines = [
        { label: 'Total GST', value: formatInr(totalGst) },
        ...rows.filter((r) => r.gst || r.taxable_value).map((r) => ({ label: r.entity, value: formatInr(r.gst) })),
      ]
      if (g.gst_sales_not_invoiced) {
        lines.push({ label: 'GST sales not yet invoiced', value: String(g.gst_sales_not_invoiced) })
      }
      return {
        resolver: 'metric',
        card: {
          kind: 'metric',
          title: 'GST summary',
          subtitle: `${period.label} (${period.from} to ${period.to})`,
          lines,
          href: `/dashboard/reports?from=${period.from}&to=${period.to}`,
          sourceLabel: 'Reports → GST',
        },
      }
    }
  }
}

function formatInr(n: number | null | undefined): string {
  if (n == null) return '—'
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

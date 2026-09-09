import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendingUp, Receipt, ShoppingCart, IndianRupee, Clock, PackageCheck } from 'lucide-react'
import RequirePageAccess from '@/components/RequirePageAccess'
import { getCookieSessionUser, isOwner } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/service'
import { monthToDate, last7Days, last15Days, lastMonthFull, fyToDate, prevPeriod } from '@/lib/reports'

// Correctness note (2026-08-29 reporting rebuild): this page used to read the
// legacy `purchases` table with no is_deleted filters and no period selector at
// all. Every number here now comes from the report_* RPCs (single source of
// truth), and the period is chosen via a plain ?preset= link so switching ranges
// needs no client JS -- same presets as Dashboard -> Reports.
const PRESETS: Record<string, { label: string; range: () => { from: string; to: string } }> = {
  mtd: { label: 'Month to Date', range: monthToDate },
  l7: { label: 'Last 7 Days', range: last7Days },
  l15: { label: 'Last 15 Days', range: last15Days },
  lm: { label: 'Last Month', range: lastMonthFull },
  fy: { label: 'FY to Date', range: fyToDate },
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

async function DashboardPageContent({ preset }: { preset: string }) {
  const sessionUser = await getCookieSessionUser()
  const includeFinancials = isOwner(sessionUser)
  const presetKey = PRESETS[preset] ? preset : 'mtd'
  const { from, to } = PRESETS[presetKey].range()
  const compare = prevPeriod(from, to)

  const [kpisRes, purchaseRes, expensesRes, inventoryRes] = await Promise.all([
    supabaseAdmin.rpc('report_kpis', {
      p_from: from, p_to: to, p_compare_from: compare.from, p_compare_to: compare.to, p_include_financials: includeFinancials,
    }),
    supabaseAdmin.rpc('report_purchase_kpis', { p_from: from, p_to: to }),
    supabaseAdmin.rpc('report_expenses', { p_from: from, p_to: to, p_include_financials: includeFinancials }),
    supabaseAdmin.rpc('report_inventory', { p_include_financials: includeFinancials }),
  ])

  const kpis = kpisRes.data?.current
  const growth = kpisRes.data?.revenue_growth_pct
  const purchase = purchaseRes.data
  const expenses = expensesRes.data
  const inv = inventoryRes.data?.units

  const purchaseGrowth = purchase?.prev_value > 0
    ? Math.round(((purchase.value - purchase.prev_value) / purchase.prev_value) * 1000) / 10
    : null

  // Exactly the tiles requested -- Total Purchase (Value) is owner-only (it's a
  // cost figure, same redaction rule as everywhere else), every other tile is
  // visible to any role since selling price/expense totals aren't redacted fields.
  const tiles = [
    {
      title: 'Total Sold (Value)', value: fmt(kpis?.revenue_incl),
      sub: growth !== null && growth !== undefined ? `${growth > 0 ? '+' : ''}${growth}% vs prior period` : undefined,
      href: '/dashboard/sales', icon: TrendingUp, color: 'text-success', bg: 'bg-success/15',
    },
    {
      title: 'Total Sales (Count)', value: kpis?.order_count ?? '—',
      sub: kpis ? `${kpis.units} units` : undefined,
      href: '/dashboard/sales', icon: Receipt, color: 'text-primary', bg: 'bg-info/15',
    },
    ...(includeFinancials ? [{
      title: 'Total Purchase (Value)', value: fmt(purchase?.value),
      sub: purchaseGrowth !== null ? `${purchaseGrowth > 0 ? '+' : ''}${purchaseGrowth}% vs prior period` : undefined,
      href: '/dashboard/purchase-orders', icon: ShoppingCart, color: 'text-warning', bg: 'bg-warning/15',
    }] : []),
    {
      title: 'Total Purchase (Count)', value: purchase?.count ?? '—',
      href: '/dashboard/purchase-orders', icon: ShoppingCart, color: 'text-warning', bg: 'bg-warning/15',
    },
    {
      title: 'Total Expense', value: fmt(expenses?.total_amount),
      sub: expenses ? `${expenses.entry_count} entries` : undefined,
      href: '/dashboard/expenses', icon: IndianRupee, color: 'text-destructive', bg: 'bg-destructive/15',
    },
    {
      title: 'Pending Payment (Value)', value: fmt(kpis?.outstanding),
      href: '/dashboard/sales', icon: Clock, color: 'text-purple', bg: 'bg-purple/15',
    },
    {
      title: 'Ready for Sale (Count)', value: inv?.sellable_count ?? '—',
      sub: inv ? `${inv.on_hand_count} on hand, pre-QC` : undefined,
      href: '/dashboard/stock?tab=current', icon: PackageCheck, color: 'text-pink', bg: 'bg-pink/15',
    },
  ]

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {new Date(from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} –{' '}
            {new Date(to).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {Object.entries(PRESETS).map(([key, p]) => (
            <Link
              key={key}
              href={`/dashboard?preset=${key}`}
              className={`px-3 py-1.5 text-sm rounded-md transition ${
                key === presetKey ? 'bg-card shadow-sm font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {tiles.map((stat) => (
          <Link key={stat.title} href={stat.href} className="block h-full">
            <Card className="h-full transition hover:shadow-md hover:ring-primary/30 cursor-pointer">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{stat.title}</CardTitle>
                  <div className={`${stat.bg} p-2 rounded-lg`}>
                    <stat.icon className={`h-4 w-4 ${stat.color}`} />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold text-foreground">{stat.value}</p>
                {stat.sub && <p className="text-xs text-muted-foreground mt-1">{stat.sub}</p>}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {includeFinancials && kpis?.cost_coverage_pct !== null && kpis?.cost_coverage_pct !== undefined && (
        <p className="text-xs text-muted-foreground mt-4">
          Margin figures for this period are based on {kpis.cost_coverage_pct}% of unit sales with known cost —
          see Reports → Profitability for the full cost-coverage breakdown.
        </p>
      )}
    </div>
  )
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ preset?: string }> }) {
  const { preset } = await searchParams
  return (
    <RequirePageAccess pageKey="dashboard">
      <DashboardPageContent preset={preset || 'mtd'} />
    </RequirePageAccess>
  )
}

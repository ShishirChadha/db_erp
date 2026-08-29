import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ShoppingCart, TrendingUp, Users, Package, PackageCheck, IndianRupee } from 'lucide-react'
import RequirePageAccess from '@/components/RequirePageAccess'
import { getCookieSessionUser, isOwner } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/service'
import { monthToDate } from '@/lib/reports'

// Correctness note (2026-08-29 reporting rebuild): this page used to read the
// legacy `purchases` table for "In Stock"/"Ready for Sale" (0 rows in that
// status today -- the entire asset_ledger/live-stock flow was invisible to it)
// and had no is_deleted filters anywhere. Every number here now comes from the
// report_* RPCs (single source of truth -- see docs/current-progress.md and the
// reporting-metrics migrations), which already exclude soft-deleted rows.
async function DashboardPageContent() {
  const sessionUser = await getCookieSessionUser()
  const includeFinancials = isOwner(sessionUser)
  const { from, to } = monthToDate()

  const [kpisRes, inventoryRes, customersRes, poRes] = await Promise.all([
    supabaseAdmin.rpc('report_kpis', { p_from: from, p_to: to, p_include_financials: includeFinancials }),
    supabaseAdmin.rpc('report_inventory', { p_include_financials: includeFinancials }),
    supabaseAdmin.from('customers').select('id', { count: 'exact', head: true }).eq('is_deleted', false),
    supabaseAdmin.from('purchase_orders').select('id', { count: 'exact', head: true })
      .eq('is_deleted', false).gte('po_date', from).lte('po_date', to),
  ])

  const kpis = kpisRes.data?.current
  const inv = inventoryRes.data?.units

  const stats = [
    {
      title: 'Sales This Month',
      value: kpis ? `₹${Math.round(kpis.revenue_incl).toLocaleString('en-IN')}` : '—',
      sub: kpis ? `${kpis.units} units` : undefined,
      icon: TrendingUp,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      title: 'Collections This Month',
      value: kpis ? `₹${Math.round(kpis.collections).toLocaleString('en-IN')}` : '—',
      sub: kpis ? `₹${Math.round(kpis.outstanding).toLocaleString('en-IN')} outstanding` : undefined,
      icon: IndianRupee,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      title: 'Ready for Sale',
      value: inv?.sellable_count ?? '—',
      sub: inv ? `${inv.on_hand_count} on hand, pre-QC` : undefined,
      icon: PackageCheck,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
    {
      title: 'On Hand (Stock)',
      value: inv?.on_hand_count ?? '—',
      sub: inv ? `${inv.qc_pending_count} awaiting QC` : undefined,
      icon: Package,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
    },
    {
      title: 'Customers',
      value: customersRes.count ?? 0,
      icon: Users,
      color: 'text-pink-600',
      bg: 'bg-pink-50',
    },
    {
      title: 'Purchase Orders This Month',
      value: poRes.count ?? 0,
      icon: ShoppingCart,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
  ]

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">
          Month to date ({new Date(from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} –{' '}
          {new Date(to).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-gray-500">
                  {stat.title}
                </CardTitle>
                <div className={`${stat.bg} p-2 rounded-lg`}>
                  <stat.icon className={`h-4 w-4 ${stat.color}`} />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold text-gray-900">{stat.value}</p>
              {stat.sub && <p className="text-xs text-gray-400 mt-1">{stat.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {includeFinancials && kpis?.cost_coverage_pct !== null && kpis?.cost_coverage_pct !== undefined && (
        <p className="text-xs text-gray-400 mt-4">
          Margin figures this month are based on {kpis.cost_coverage_pct}% of unit sales with known cost —
          see Reports → Profitability for the full cost-coverage breakdown.
        </p>
      )}
    </div>
  )
}

export default async function DashboardPage() {
  return (
    <RequirePageAccess pageKey="dashboard">
      <DashboardPageContent />
    </RequirePageAccess>
  )
}

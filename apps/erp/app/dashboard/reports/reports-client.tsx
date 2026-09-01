'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  BarChart, Bar, LineChart, Line, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  TrendingUp, TrendingDown, Package, IndianRupee, Users, AlertTriangle,
} from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import {
  toDateStr, monthToDate, last7Days, last15Days, lastMonthFull, fyToDate, prevPeriod,
} from '@/lib/reports'

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-5)', 'var(--chart-5)', 'var(--chart-6)', 'var(--chart-2)', 'var(--chart-4)']

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}
function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `${n > 0 ? '+' : ''}${n}%`
}

type Period = { from: string; to: string; label: string }

function presets(): Record<string, Period> {
  const mtd = monthToDate()
  const l7 = last7Days()
  const l15 = last15Days()
  const lm = lastMonthFull()
  const fy = fyToDate()
  return {
    mtd: { ...mtd, label: 'Month to Date' },
    l7: { ...l7, label: 'Last 7 Days' },
    l15: { ...l15, label: 'Last 15 Days' },
    lm: { ...lm, label: 'Last Month' },
    fy: { ...fy, label: 'FY to Date' },
  }
}

async function getReport<T = any>(metric: string, params: Record<string, string> = {}): Promise<T | null> {
  const sp = new URLSearchParams({ metric, ...params })
  const res = await apiFetch(`/api/reports?${sp.toString()}`)
  if (!res.ok) return null
  return res.json()
}

export default function ReportsClient() {
  const allPresets = useMemo(presets, [])
  const [presetKey, setPresetKey] = useState('mtd')
  const period = allPresets[presetKey]
  const compare = useMemo(() => prevPeriod(period.from, period.to), [period.from, period.to])

  const [activeTab, setActiveTab] = useState('overview')
  const [kpis, setKpis] = useState<any>(null)
  const [timeseries, setTimeseries] = useState<any[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      getReport('kpis', { from: period.from, to: period.to, compare_from: compare.from, compare_to: compare.to }),
      getReport('timeseries', { from: period.from, to: period.to, grain: 'day' }),
    ]).then(([k, t]) => {
      setKpis(k)
      setTimeseries(t)
      setLoading(false)
    })
  }, [period.from, period.to, compare.from, compare.to])

  const cur = kpis?.current
  const includeFinancials = cur ? 'cost_coverage_pct' in cur : false

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Reports</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {new Date(period.from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} –{' '}
            {new Date(period.to).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {Object.entries(allPresets).map(([key, p]) => (
            <button
              key={key}
              onClick={() => setPresetKey(key)}
              className={`px-3 py-1.5 text-sm rounded-md transition ${
                presetKey === key ? 'bg-card shadow-sm font-medium text-foreground' : 'text-muted-foreground hover:text-muted-foreground'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4 flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="profitability">Profitability</TabsTrigger>
          <TabsTrigger value="inventory">Inventory & Ageing</TabsTrigger>
          <TabsTrigger value="purchasing">Purchasing & Vendors</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="cash">Cash & Receivables</TabsTrigger>
          <TabsTrigger value="gst">GST</TabsTrigger>
          <TabsTrigger value="data_health">Data Health</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab kpis={kpis} timeseries={timeseries} loading={loading} includeFinancials={includeFinancials} />
        </TabsContent>
        <TabsContent value="sales">
          <SalesTab period={period} active={activeTab === 'sales'} />
        </TabsContent>
        <TabsContent value="profitability">
          <ProfitabilityTab period={period} active={activeTab === 'profitability'} includeFinancials={includeFinancials} cur={cur} />
        </TabsContent>
        <TabsContent value="inventory">
          <InventoryTab active={activeTab === 'inventory'} includeFinancials={includeFinancials} />
        </TabsContent>
        <TabsContent value="purchasing">
          <PurchasingTab period={period} active={activeTab === 'purchasing'} includeFinancials={includeFinancials} />
        </TabsContent>
        <TabsContent value="expenses">
          <ExpensesTab period={period} compare={compare} active={activeTab === 'expenses'} includeFinancials={includeFinancials} />
        </TabsContent>
        <TabsContent value="cash">
          <CashTab active={activeTab === 'cash'} />
        </TabsContent>
        <TabsContent value="gst">
          <GstTab period={period} active={activeTab === 'gst'} />
        </TabsContent>
        <TabsContent value="data_health">
          <DataHealthTab active={activeTab === 'data_health'} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── Overview ──────────────────────────────────────────────────────────
function OverviewTab({ kpis, timeseries, loading, includeFinancials }: any) {
  const cur = kpis?.current
  if (loading || !cur) return <p className="text-sm text-muted-foreground">Loading…</p>

  const tiles = [
    { title: 'Revenue', value: fmt(cur.revenue_incl), sub: kpis.revenue_growth_pct !== undefined ? pct(kpis.revenue_growth_pct) + ' vs prior period' : undefined, icon: TrendingUp, color: 'text-success', bg: 'bg-success/15' },
    { title: 'Units Sold', value: cur.units, sub: `${cur.order_count} orders`, icon: Package, color: 'text-info', bg: 'bg-info/15' },
    { title: 'Collections', value: fmt(cur.collections), sub: `${fmt(cur.outstanding)} outstanding`, icon: IndianRupee, color: 'text-success', bg: 'bg-success/15' },
    { title: 'New Customers', value: cur.new_customers, sub: `${cur.repeat_customers} repeat`, icon: Users, color: 'text-pink', bg: 'bg-pink/15' },
  ]
  if (includeFinancials) {
    tiles.push({
      title: 'Gross Margin (costed units)',
      value: fmt(cur.gross_margin_known),
      sub: `Cost coverage: ${cur.cost_coverage_pct ?? '—'}% of unit sales`,
      icon: cur.gross_margin_known >= 0 ? TrendingUp : TrendingDown,
      color: 'text-purple', bg: 'bg-purple/15',
    })
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {tiles.map((t) => (
          <Card key={t.title}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">{t.title}</CardTitle>
                <div className={`${t.bg} p-2 rounded-lg`}><t.icon className={`h-4 w-4 ${t.color}`} /></div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xl font-semibold text-foreground">{t.value}</p>
              {t.sub && <p className="text-xs text-muted-foreground mt-1">{t.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {includeFinancials && cur.cost_coverage_pct !== null && cur.cost_coverage_pct < 50 && (
        <div className="flex items-start gap-2 rounded-md border border-warning/20 bg-warning/15 p-3 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Only {cur.cost_coverage_pct}% of unit sales in this period have a known cost — margin here reflects the costed
            subset only, not the full picture. See the Data Health tab and Profitability tab to close the gap.
          </span>
        </div>
      )}

      {timeseries && timeseries.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Daily Revenue{includeFinancials ? ' & Known Margin' : ''}</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={timeseries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: any) => fmt(Number(v))} labelFormatter={(d) => new Date(d).toLocaleDateString('en-IN')} />
                <Bar dataKey="revenue_incl" name="Revenue" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                {includeFinancials && <Line type="monotone" dataKey="gross_margin_known" name="Known Margin" stroke="var(--chart-2)" strokeWidth={2} dot={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ── Sales ─────────────────────────────────────────────────────────────
function SalesTab({ period, active }: { period: Period; active: boolean }) {
  const [byBrand, setByBrand] = useState<any[] | null>(null)
  const [byStaff, setByStaff] = useState<any[] | null>(null)
  const [byEntity, setByEntity] = useState<any[] | null>(null)
  const [byType, setByType] = useState<any[] | null>(null)
  const [topCustomers, setTopCustomers] = useState<any[] | null>(null)

  useEffect(() => {
    if (!active) return
    const p = { from: period.from, to: period.to }
    getReport('breakdown', { ...p, dimension: 'brand', limit: '10' }).then(setByBrand)
    getReport('breakdown', { ...p, dimension: 'staff', limit: '10' }).then(setByStaff)
    getReport('breakdown', { ...p, dimension: 'entity', limit: '5' }).then(setByEntity)
    getReport('breakdown', { ...p, dimension: 'sale_type', limit: '5' }).then(setByType)
    getReport('breakdown', { ...p, dimension: 'customer', limit: '10' }).then(setTopCustomers)
  }, [active, period.from, period.to])

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <BreakdownCard title="Revenue by Brand" rows={byBrand} />
      <BreakdownCard title="Revenue by Staff" rows={byStaff} />
      <BreakdownCard title="Revenue by Entity" rows={byEntity} />
      <ChartPie title="GST vs Cash Split" rows={byType} valueKey="units" />
      <BreakdownCard title="Top Customers" rows={topCustomers} className="md:col-span-2" />
    </div>
  )
}

function BreakdownCard({ title, rows, className }: { title: string; rows: any[] | null; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {!rows ? <p className="text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? <p className="text-sm text-muted-foreground">No data for this period.</p> : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Label</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Revenue</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Units</th>
                  {'gross_margin_known' in (rows[0] || {}) && <th className="text-right px-3 py-2 font-medium text-muted-foreground">Margin (costed)</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2">{r.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.revenue_incl)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.units}</td>
                    {'gross_margin_known' in r && <td className="px-3 py-2 text-right tabular-nums">{fmt(r.gross_margin_known)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ChartPie({ title, rows, valueKey }: { title: string; rows: any[] | null; valueKey: string }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {!rows ? <p className="text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? <p className="text-sm text-muted-foreground">No data.</p> : (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={rows} dataKey={valueKey} nameKey="label" outerRadius={80} label={(e: any) => `${e.label}: ${e[valueKey]}`}>
                {rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}

// ── Profitability ────────────────────────────────────────────────────
function ProfitabilityTab({ period, active, includeFinancials, cur }: { period: Period; active: boolean; includeFinancials: boolean; cur: any }) {
  const [byCategory, setByCategory] = useState<any[] | null>(null)

  useEffect(() => {
    if (!active) return
    getReport('breakdown', { from: period.from, to: period.to, dimension: 'category', limit: '15' }).then(setByCategory)
  }, [active, period.from, period.to])

  if (!includeFinancials) {
    return <p className="text-sm text-muted-foreground">Margin figures are owner-only.</p>
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Cost Coverage</CardTitle></CardHeader>
          <CardContent>
            <p className="text-xl font-semibold text-foreground">{cur?.cost_coverage_pct ?? '—'}%</p>
            <p className="text-xs text-muted-foreground mt-1">{cur?.unit_sales_costed ?? 0} of {cur?.unit_sales_total ?? 0} unit sales costed</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Revenue (costed)</CardTitle></CardHeader>
          <CardContent><p className="text-xl font-semibold text-foreground">{fmt(cur?.revenue_of_costed)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">COGS (known)</CardTitle></CardHeader>
          <CardContent><p className="text-xl font-semibold text-foreground">{fmt(cur?.cogs_known)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Gross Margin (known)</CardTitle></CardHeader>
          <CardContent><p className="text-xl font-semibold text-foreground">{fmt(cur?.gross_margin_known)}</p></CardContent>
        </Card>
      </div>

      <BreakdownCard title="Margin by Category (costed units only)" rows={byCategory} />

      <Card className="border-warning/20">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warning" /> Sold units awaiting a cost</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Every sale in this period without a recoverable cost is excluded from the margin figures above rather
            than treated as zero cost. Attach a Purchase Order to these units — from Stock → the unit → Attach to
            PO — to bring them into margin reporting.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Inventory ─────────────────────────────────────────────────────────
function InventoryTab({ active, includeFinancials }: { active: boolean; includeFinancials: boolean }) {
  const [data, setData] = useState<any>(null)

  useEffect(() => {
    if (!active) return
    getReport('inventory').then(setData)
  }, [active])

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>
  const u = data.units

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatTile label="Sellable" value={u.sellable_count} />
        <StatTile label="On Hand (pre-sale)" value={u.on_hand_count} />
        <StatTile label="QC Pending" value={u.qc_pending_count} />
        <StatTile label="Faulty" value={u.faulty_count} />
        <StatTile label="Sold, no sale record" value={u.sold_without_sale_row} warn={u.sold_without_sale_row > 0} />
        {includeFinancials && <StatTile label="Stock Value (at cost)" value={fmt(u.stock_value_at_cost)} sub={`${u.stock_value_costed_count} units costed`} />}
      </div>

      {data.ageing && (
        <Card>
          <CardHeader><CardTitle className="text-base">Stock Ageing</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.ageing}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {data.accessories_attention?.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Accessories Needing Attention</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">SKU</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Category</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">In Stock</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Needs PO</th>
                  </tr>
                </thead>
                <tbody>
                  {data.accessories_attention.slice(0, 25).map((a: any) => (
                    <tr key={a.sku_id} className="border-t">
                      <td className="px-3 py-2">{a.full_sku_code}</td>
                      <td className="px-3 py-2">{a.category}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{a.quantity_in_stock}{a.low_stock && <Badge variant="destructive" className="ml-2 text-xs">Low</Badge>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{a.needs_po_qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function StatTile({ label, value, sub, warn }: { label: string; value: any; sub?: string; warn?: boolean }) {
  return (
    <Card className={warn ? 'border-warning/20' : undefined}>
      <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent>
        <p className={`text-xl font-semibold ${warn ? 'text-warning' : 'text-foreground'}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  )
}

// ── Purchasing & Vendors ─────────────────────────────────────────────
function PurchasingTab({ period, active, includeFinancials }: { period: Period; active: boolean; includeFinancials: boolean }) {
  const [byVendor, setByVendor] = useState<any[] | null>(null)
  const [byCategory, setByCategory] = useState<any[] | null>(null)

  useEffect(() => {
    if (!active) return
    getReport('breakdown', { from: period.from, to: period.to, dimension: 'vendor', limit: '15' }).then(setByVendor)
  }, [active, period.from, period.to])

  if (!includeFinancials) return <p className="text-sm text-muted-foreground">Purchasing figures are owner-only.</p>

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Spend by Vendor</CardTitle></CardHeader>
        <CardContent>
          {!byVendor ? <p className="text-sm text-muted-foreground">Loading…</p> : byVendor.length === 0 ? <p className="text-sm text-muted-foreground">No purchases in this period.</p> : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Vendor</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Spend</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Units</th>
                  </tr>
                </thead>
                <tbody>
                  {byVendor.map((v: any, i: number) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2">{v.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(v.spend)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{v.units}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Expenses ──────────────────────────────────────────────────────────
function ExpensesTab({ period, compare, active, includeFinancials }: { period: Period; compare: { from: string; to: string }; active: boolean; includeFinancials: boolean }) {
  const [summary, setSummary] = useState<any>(null)
  const [prevSummary, setPrevSummary] = useState<any>(null)
  const [timeseries, setTimeseries] = useState<any[] | null>(null)
  const [byType, setByType] = useState<any[] | null>(null)
  const [byVendor, setByVendor] = useState<any[] | null>(null)

  useEffect(() => {
    if (!active) return
    const p = { from: period.from, to: period.to }
    getReport('expenses', p).then(setSummary)
    getReport('expenses', { from: compare.from, to: compare.to }).then(setPrevSummary)
    getReport('expense_timeseries', { ...p, grain: 'day' }).then(setTimeseries)
    getReport('breakdown', { ...p, dimension: 'expense_type', limit: '15' }).then(setByType)
    if (includeFinancials) getReport('breakdown', { ...p, dimension: 'expense_vendor', limit: '15' }).then(setByVendor)
  }, [active, period.from, period.to, compare.from, compare.to, includeFinancials])

  if (!summary) return <p className="text-sm text-muted-foreground">Loading…</p>

  const growthPct = prevSummary?.total_amount > 0
    ? Math.round(((summary.total_amount - prevSummary.total_amount) / prevSummary.total_amount) * 1000) / 10
    : null

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatTile label="Total Expenses" value={fmt(summary.total_amount)} sub={growthPct !== null ? `${pct(growthPct)} vs prior period` : undefined} />
        <StatTile label="Entry Count" value={summary.entry_count} />
        <StatTile label="Avg per Entry" value={fmt(summary.avg_amount)} />
      </div>

      {timeseries && timeseries.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Daily Expenses</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={timeseries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: any) => fmt(Number(v))} labelFormatter={(d) => new Date(d).toLocaleDateString('en-IN')} />
                <Bar dataKey="total_amount" name="Expenses" fill="var(--chart-4)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <ExpenseBreakdownCard title="By Type" rows={byType} />
        {includeFinancials
          ? <ExpenseBreakdownCard title="By Vendor" rows={byVendor} />
          : <Card><CardHeader><CardTitle className="text-base">By Vendor</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">Vendor figures are owner-only.</p></CardContent></Card>}
      </div>
    </div>
  )
}

function ExpenseBreakdownCard({ title, rows }: { title: string; rows: any[] | null }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {!rows ? <p className="text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? <p className="text-sm text-muted-foreground">No data for this period.</p> : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Label</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Amount</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Count</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2">{r.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Cash & Receivables ───────────────────────────────────────────────
function CashTab({ active }: { active: boolean }) {
  const [data, setData] = useState<any>(null)

  useEffect(() => {
    if (!active) return
    getReport('receivables').then(setData)
  }, [active])

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Receivables Ageing</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.by_bucket}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: any) => fmt(Number(v))} />
              <Bar dataKey="outstanding" fill="var(--chart-4)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Top Outstanding Customers</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Customer</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Outstanding</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Sales</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Oldest (days)</th>
                </tr>
              </thead>
              <tbody>
                {data.top_debtors.map((d: any, i: number) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2">{d.customer_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(d.outstanding)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.sales_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.oldest_days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ── GST ───────────────────────────────────────────────────────────────
function GstTab({ period, active }: { period: Period; active: boolean }) {
  const [data, setData] = useState<any>(null)

  useEffect(() => {
    if (!active) return
    getReport('gst_summary', { from: period.from, to: period.to }).then(setData)
  }, [active, period.from, period.to])

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>

  return (
    <div className="space-y-6">
      <Card className="border-warning/20">
        <CardContent className="pt-6 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">GST sales not yet invoiced in this period</span>
          <Badge variant={data.gst_sales_not_invoiced > 0 ? 'destructive' : 'secondary'}>{data.gst_sales_not_invoiced}</Badge>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Output GST by Month & Entity</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Month</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Entity</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Taxable Value</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">GST</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Cash Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.by_month_entity.map((r: any, i: number) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2">{new Date(r.month).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</td>
                    <td className="px-3 py-2">{r.entity}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.taxable_value)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.gst)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.cash_revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Data Health ───────────────────────────────────────────────────────
const ISSUE_LABELS: Record<string, string> = {
  sold_assets_without_sale_row: 'Sold assets with no matching sale record',
  sales_with_unknown_cogs: 'Unit sales with no recoverable cost',
  skus_without_base_cost: 'SKUs with no base cost set',
  receipts_without_unit_price: 'Stock receipts with no unit price',
  sales_year_month_mismatch: 'Sales with inconsistent year/month fields',
  sales_without_asset_or_accessory_link: 'Sales not linked to any unit or accessory',
  po_items_without_price: 'PO line items with no unit price',
}

function DataHealthTab({ active }: { active: boolean }) {
  const [data, setData] = useState<Record<string, number> | null>(null)

  useEffect(() => {
    if (!active) return
    getReport('data_health').then(setData)
  }, [active])

  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground mb-4">
        These are exactly the gaps that make some numbers elsewhere in Reports partial rather than complete —
        closing them (attaching POs, pricing receipts) directly raises Cost Coverage %.
      </p>
      {Object.entries(data).map(([issue, count]) => (
        <Card key={issue}>
          <CardContent className="pt-6 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{ISSUE_LABELS[issue] || issue}</span>
            <Badge variant={count > 0 ? 'destructive' : 'secondary'}>{count}</Badge>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

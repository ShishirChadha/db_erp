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
  TrendingUp, TrendingDown, Package, IndianRupee, Users, AlertTriangle, Globe, Eye, MousePointerClick, Clock,
  Search, ShoppingCart, Activity,
} from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { CategoryEntityMatrixTable, type MatrixRow } from '@/components/CategoryEntityMatrixTable'

const SALES_CATEGORY_ORDER = ['Laptops', 'Desktops', 'Accessories', 'Repair', 'Rental']
const PURCHASE_CATEGORY_ORDER = ['Laptops', 'Desktops', 'Accessories']
import {
  toDateStr, monthToDate, last7Days, last15Days, lastMonthFull, fyToDate, prevPeriod,
} from '@/lib/reports'

// One entry per series/slice. Indices 3 and 4 were both --chart-5, so two
// adjacent pie slices rendered identically and read as one.
const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)']

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

// Returns `status` as well as the body, because 501 and 502 mean completely
// different things here and the UI used to conflate them: 501 is "the env
// vars are not set", 502 is "they are set but the API call failed" (wrong
// property, revoked access, quota). Rendering both as "not configured yet"
// is what made a real, diagnosable error look like a feature nobody had
// switched on.
async function getWebsiteReport<T = any>(metric: string, params: Record<string, string> = {}): Promise<{ data: T | null; error: string | null; status: number }> {
  const sp = new URLSearchParams({ metric, ...params })
  const res = await apiFetch(`/api/reports/website?${sp.toString()}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    return { data: null, error: body.error || 'Failed to load', status: res.status }
  }
  return { data: await res.json(), error: null, status: res.status }
}

// Returns `status` as well as the body, because 501 and 502 mean completely
// different things here and the UI used to conflate them: 501 is "the env
// vars are not set", 502 is "they are set but the API call failed" (wrong
// property, revoked access, quota). Rendering both as "not configured yet"
// is what made a real, diagnosable error look like a feature nobody had
// switched on.
async function getSearchConsoleReport<T = any>(metric: string, params: Record<string, string> = {}): Promise<{ data: T | null; error: string | null; status: number }> {
  const sp = new URLSearchParams({ metric, ...params })
  const res = await apiFetch(`/api/reports/search-console?${sp.toString()}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    return { data: null, error: body.error || 'Failed to load', status: res.status }
  }
  return { data: await res.json(), error: null, status: res.status }
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
          <TabsTrigger value="website">Website</TabsTrigger>
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
        <TabsContent value="website">
          <WebsiteTab period={period} active={activeTab === 'website'} />
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
  const [matrix, setMatrix] = useState<MatrixRow[] | null>(null)

  useEffect(() => {
    if (!active) return
    const p = { from: period.from, to: period.to }
    getReport('breakdown', { ...p, dimension: 'brand', limit: '10' }).then(setByBrand)
    getReport('breakdown', { ...p, dimension: 'staff', limit: '10' }).then(setByStaff)
    getReport('breakdown', { ...p, dimension: 'entity', limit: '5' }).then(setByEntity)
    getReport('breakdown', { ...p, dimension: 'sale_type', limit: '5' }).then(setByType)
    getReport('breakdown', { ...p, dimension: 'customer', limit: '10' }).then(setTopCustomers)
    getReport('category_entity_matrix', { ...p, source: 'sales' }).then(setMatrix)
  }, [active, period.from, period.to])

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Sales: Value & Count by Entity and Category</CardTitle></CardHeader>
        <CardContent>
          {!matrix ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <CategoryEntityMatrixTable title="" rows={matrix} categoryOrder={SALES_CATEGORY_ORDER} />
          )}
        </CardContent>
      </Card>
      <div className="grid md:grid-cols-2 gap-6">
        <BreakdownCard title="Revenue by Brand" rows={byBrand} />
        <BreakdownCard title="Revenue by Staff" rows={byStaff} />
        <BreakdownCard title="Revenue by Entity" rows={byEntity} />
        <ChartPie title="GST vs Cash Split" rows={byType} valueKey="units" />
        <BreakdownCard title="Top Customers" rows={topCustomers} className="md:col-span-2" />
      </div>
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
  const [matrix, setMatrix] = useState<MatrixRow[] | null>(null)

  useEffect(() => {
    if (!active) return
    getReport('breakdown', { from: period.from, to: period.to, dimension: 'vendor', limit: '15' }).then(setByVendor)
    getReport('category_entity_matrix', { from: period.from, to: period.to, source: 'purchases' }).then(setMatrix)
  }, [active, period.from, period.to])

  if (!includeFinancials) return <p className="text-sm text-muted-foreground">Purchasing figures are owner-only.</p>

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Purchases: Value & Count by Entity and Category</CardTitle></CardHeader>
        <CardContent>
          {!matrix ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <CategoryEntityMatrixTable
              title=""
              subtitle="Repair and Rental don't have their own purchase category — repair parts and rental units are already counted as Accessories/Laptop/Desktop purchases here."
              rows={matrix}
              categoryOrder={PURCHASE_CATEGORY_ORDER}
            />
          )}
        </CardContent>
      </Card>
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

// ── Website (Google Analytics) ──────────────────────────────────────
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m ${s}s`
}

// Health of the analytics pipe itself, shown above the numbers it feeds.
//
// Why this exists: the storefront spent weeks firing at a measurement ID that
// did not belong to the property the ERP reads, so every tile here rendered a
// perfectly plausible zero. Zero traffic and a broken pipe look identical on a
// chart. The only signals that can tell them apart are all-time event count and
// last-event date, which is what this reads -- and it states what to DO, not
// just that something is off, following /dashboard/monitoring's rule that a
// dashboard which only colours things red still leaves you guessing.
function AnalyticsConnectionCard({
  config, notConfigured, trafficError, gscNotConfigured, gscError,
}: {
  config: any
  notConfigured: boolean
  trafficError: string | null
  gscNotConfigured: boolean
  gscError: string | null
}) {
  const actions: { level: 'act' | 'watch'; text: string }[] = []

  if (notConfigured) {
    actions.push({ level: 'act', text: 'Google Analytics credentials are not set on this server (GA4_PROPERTY_ID, GA4_CLIENT_EMAIL, GA4_PRIVATE_KEY).' })
  } else if (trafficError) {
    actions.push({ level: 'act', text: `Google Analytics rejected the request: ${trafficError}` })
  }

  if (config) {
    const expected: string | null = config.expected_measurement_id ?? null
    const ids: string[] = config.measurement_ids ?? []

    if (config.all_time_event_count === 0) {
      actions.push({
        level: 'act',
        text:
          `GA4 property ${config.property_id}${config.property_display_name ? ` (${config.property_display_name})` : ''} ` +
          `has never received a single event. The storefront is almost certainly firing at a different property. ` +
          `Open GA4 Admin → Data Streams, confirm the web stream's Measurement ID, and check it belongs to this property.`,
      })
    } else if (config.last_event_date) {
      const days = Math.floor((Date.now() - new Date(config.last_event_date).getTime()) / 86_400_000)
      if (days >= 2) {
        actions.push({
          level: 'act',
          text: `GA4's last recorded event was ${days} days ago (${config.last_event_date}). Tracking has probably stopped — check that the storefront still loads gtag.js and that the measurement ID is intact.`,
        })
      }
    }

    // Pure format check, independent of any API. Cheap, and it is what would
    // have caught the original truncated ID on day one.
    for (const id of [expected, ...ids].filter(Boolean) as string[]) {
      if (!/^G-[A-Z0-9]{10}$/.test(id)) {
        actions.push({ level: 'act', text: `Measurement ID "${id}" is not the expected shape (G- followed by 10 characters), so hits will go nowhere.` })
      }
    }
    if (expected && ids.length > 0 && !ids.includes(expected)) {
      actions.push({
        level: 'act',
        text: `The storefront fires at ${expected}, but this property's streams are ${ids.join(', ')}. They do not match, so the ERP is reading the wrong property.`,
      })
    }
    if (config.admin_error) {
      actions.push({
        level: 'watch',
        text: `Could not read this property's data streams, so the measurement ID can't be cross-checked automatically: ${config.admin_error}`,
      })
    }
  }

  if (gscNotConfigured) {
    actions.push({ level: 'watch', text: 'Search Console is not connected — set GSC_SITE_URL (exactly as the property is spelled there: "https://www.digitalbluez.com/" for a URL-prefix property, "sc-domain:digitalbluez.com" for a Domain property).' })
  } else if (gscError) {
    actions.push({ level: 'watch', text: `Search Console returned: ${gscError}` })
  }

  actions.sort((a, b) => (a.level === b.level ? 0 : a.level === 'act' ? -1 : 1))

  const healthy = actions.length === 0

  return (
    <Card className={healthy ? 'border-success/20' : 'border-destructive/20'}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Analytics connection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {healthy ? (
          <p className="text-success">Google Analytics is connected and receiving events.</p>
        ) : (
          <ul className="space-y-1.5">
            {actions.map((a, i) => (
              <li key={i} className={`flex items-start gap-2 ${a.level === 'act' ? 'text-destructive' : 'text-warning'}`}>
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{a.text}</span>
              </li>
            ))}
          </ul>
        )}

        {config && (
          <div className="grid gap-x-6 gap-y-1 pt-2 text-xs text-muted-foreground sm:grid-cols-2">
            <span>Property: <span className="font-mono">{config.property_id}</span>{config.property_display_name ? ` · ${config.property_display_name}` : ''}</span>
            <span>Events all-time: <span className="tabular-nums">{Number(config.all_time_event_count ?? 0).toLocaleString('en-IN')}</span></span>
            <span>Streams: <span className="font-mono">{(config.measurement_ids?.length ? config.measurement_ids.join(', ') : '—')}</span></span>
            <span>Last event: {config.last_event_date ?? '—'}</span>
            <span>Live right now: <span className="tabular-nums">{config.realtime_active_users ?? '—'}</span></span>
            <span>Search Console: {config.search_console_configured ? 'connected' : 'not set'}</span>
          </div>
        )}

        {/* Said explicitly because it is the most common false alarm after a
            fix: realtime updates in seconds, but everything date-ranged on this
            page comes from GA4's batch pipeline. */}
        <p className="pt-1 text-xs text-muted-foreground">
          &quot;Live right now&quot; updates within seconds. Every other figure on this page comes from
          Google&apos;s daily processing and can lag 24–48 hours, so after fixing tracking expect the
          tiles below to stay at zero for about a day.
        </p>
      </CardContent>
    </Card>
  )
}

// Step-to-step conversion for the GA4 funnel. Returns null (not "0%") when
// the previous step was zero, because the rate is undefined there rather than
// nil -- distinct from the existing pct(), which formats signed period deltas.
function stepRate(v: number | null | undefined): string | null {
  return v === null || v === undefined ? null : `${v}%`
}

function WebsiteTab({ period, active }: { period: Period; active: boolean }) {
  const [summary, setSummary] = useState<any>(null)
  const [timeseries, setTimeseries] = useState<any[] | null>(null)
  const [topPages, setTopPages] = useState<any[] | null>(null)
  const [devices, setDevices] = useState<any[] | null>(null)
  const [ageData, setAgeData] = useState<any[] | null>(null)
  const [genderData, setGenderData] = useState<any[] | null>(null)
  const [geo, setGeo] = useState<any[] | null>(null)
  const [trafficSource, setTrafficSource] = useState<any[] | null>(null)
  const [notConfigured, setNotConfigured] = useState(false)
  const [trafficError, setTrafficError] = useState<string | null>(null)
  const [gaConfig, setGaConfig] = useState<any>(null)
  const [gaFunnel, setGaFunnel] = useState<any>(null)
  const [searchTerms, setSearchTerms] = useState<any>(null)

  const [gscSummary, setGscSummary] = useState<any>(null)
  const [gscTimeseries, setGscTimeseries] = useState<any[] | null>(null)
  const [gscTopQueries, setGscTopQueries] = useState<any[] | null>(null)
  const [gscTopPages, setGscTopPages] = useState<any[] | null>(null)
  const [gscNotConfigured, setGscNotConfigured] = useState(false)
  const [gscError, setGscError] = useState<string | null>(null)

  const [funnel, setFunnel] = useState<any>(null)
  const [funnelSeries, setFunnelSeries] = useState<any[] | null>(null)

  const [health, setHealth] = useState<any>(null)

  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!active) return
    setLoading(true)
    const p = { from: period.from, to: period.to }
    Promise.all([
      getWebsiteReport('config'),
      getWebsiteReport('ecommerce_funnel', p),
      getWebsiteReport('search_terms', p),
      getWebsiteReport('summary', p),
      getWebsiteReport('timeseries', p),
      getWebsiteReport('top_pages', p),
      getWebsiteReport('devices', p),
      getWebsiteReport('demographics_age', p),
      getWebsiteReport('demographics_gender', p),
      getWebsiteReport('geo', p),
      getWebsiteReport('traffic_source', p),
      getSearchConsoleReport('summary', p),
      getSearchConsoleReport('timeseries', p),
      getSearchConsoleReport('top_queries', p),
      getSearchConsoleReport('top_pages', p),
      getReport('web_funnel', p),
      getReport('web_funnel_timeseries', p),
      getReport('website_health', p),
    ]).then(([cfg, gaf, stm, s, t, tp, d, a, g, geoR, ts, gscS, gscT, gscQ, gscP, wf, wfs, wh]) => {
      setGaConfig(cfg.data)
      setGaFunnel(gaf.data)
      setSearchTerms(stm.data)
      // 501 = env vars missing. Anything else non-OK = configured but failing,
      // which must show the real message rather than "not set up yet".
      setNotConfigured(s.status === 501)
      setTrafficError(s.status !== 501 ? s.error : null)
      setSummary(s.data)
      setTimeseries(t.data)
      setTopPages(tp.data)
      setDevices(d.data)
      setAgeData(a.data)
      setGenderData(g.data)
      setGeo(geoR.data)
      setTrafficSource(ts.data)

      setGscNotConfigured(gscS.status === 501)
      setGscError(gscS.status !== 501 ? gscS.error : null)
      setGscSummary(gscS.data)
      setGscTimeseries(gscT.data)
      setGscTopQueries(gscQ.data)
      setGscTopPages(gscP.data)

      setFunnel(wf)
      setFunnelSeries(wfs)
      setHealth(wh)

      setLoading(false)
    })
  }, [active, period.from, period.to])

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>

  const tiles = [
    { title: 'Sessions', value: summary?.sessions ?? 0, icon: Globe, color: 'text-info', bg: 'bg-info/15' },
    { title: 'Active Users', value: summary?.active_users ?? 0, sub: `${summary?.new_users ?? 0} new`, icon: Users, color: 'text-pink', bg: 'bg-pink/15' },
    { title: 'Page Views', value: summary?.page_views ?? 0, icon: Eye, color: 'text-success', bg: 'bg-success/15' },
    { title: 'Engagement Rate', value: `${Math.round((summary?.engagement_rate ?? 0) * 100)}%`, icon: MousePointerClick, color: 'text-purple', bg: 'bg-purple/15' },
    { title: 'Avg Session Duration', value: formatDuration(summary?.avg_session_duration_sec ?? 0), icon: Clock, color: 'text-warning', bg: 'bg-warning/15' },
  ]

  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2"><Globe className="h-4 w-4" /> Traffic (Google Analytics)</h3>

        <AnalyticsConnectionCard
          config={gaConfig}
          notConfigured={notConfigured}
          trafficError={trafficError}
          gscNotConfigured={gscNotConfigured}
          gscError={gscError}
        />

        {notConfigured ? (
          <Card className="border-warning/20">
            <CardContent className="pt-6 flex items-start gap-2 text-sm text-warning">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Google Analytics isn&apos;t configured on this server yet — set GA4_PROPERTY_ID, GA4_CLIENT_EMAIL and GA4_PRIVATE_KEY.</span>
            </CardContent>
          </Card>
        ) : trafficError ? (
          <Card className="border-destructive/20">
            <CardContent className="pt-6 flex items-start gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Google Analytics is configured but the request failed:{' '}
                <span className="font-mono text-xs">{trafficError}</span>
              </span>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {tiles.map((t) => (
                <Card key={t.title}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium text-muted-foreground">{t.title}</CardTitle>
                      <div className={`${t.bg} p-2 rounded-lg`}><t.icon className={`h-4 w-4 ${t.color}`} /></div>
                    </div>
                  </CardHeader>
                  <CardContent><p className="text-xl font-semibold text-foreground">{t.value}</p></CardContent>
                </Card>
              ))}
            </div>

            {timeseries && timeseries.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">Daily Traffic</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={timeseries}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip labelFormatter={(d) => new Date(d).toLocaleDateString('en-IN')} />
                      <Bar dataKey="sessions" name="Sessions" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                      <Line type="monotone" dataKey="active_users" name="Active Users" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            <div className="grid md:grid-cols-2 gap-6">
              <BreakdownRowsCard title="Top Pages" rows={topPages} labelKey="label" valueKey="page_views" valueLabel="Views" />
              <BreakdownRowsCard title="Traffic Sources" rows={trafficSource} labelKey="label" valueKey="sessions" valueLabel="Sessions" />
              <ChartPie title="Devices" rows={devices} valueKey="sessions" />
              <BreakdownRowsCard title="Top Cities" rows={geo} labelKey="label" valueKey="sessions" valueLabel="Sessions" />
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-base">Age</CardTitle></CardHeader>
                <CardContent>
                  {!ageData || ageData.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No age data yet — Google Signals demographics need more traffic before they populate (can take days to weeks after enabling).</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={ageData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Bar dataKey="active_users" name="Users" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Gender</CardTitle></CardHeader>
                <CardContent>
                  {!genderData || genderData.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No gender data yet — Google Signals demographics need more traffic before they populate (can take days to weeks after enabling).</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={genderData} dataKey="active_users" nameKey="label" outerRadius={80} label={(e: any) => `${e.label}: ${e.active_users}`}>
                          {genderData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>

      <div className="space-y-6">
        <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2"><Search className="h-4 w-4" /> Search (Google Search Console)</h3>
        {gscNotConfigured ? (
          <Card className="border-warning/20">
            <CardContent className="pt-6 flex items-start gap-2 text-sm text-warning">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Search Console isn&apos;t configured on this server yet — set GSC_SITE_URL (and reuses GA4_CLIENT_EMAIL/GA4_PRIVATE_KEY, which must also be granted access to the Search Console property).</span>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Clicks</CardTitle></CardHeader>
                <CardContent><p className="text-xl font-semibold text-foreground">{gscSummary?.clicks ?? 0}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Impressions</CardTitle></CardHeader>
                <CardContent><p className="text-xl font-semibold text-foreground">{gscSummary?.impressions ?? 0}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">CTR</CardTitle></CardHeader>
                <CardContent><p className="text-xl font-semibold text-foreground">{`${Math.round((gscSummary?.ctr ?? 0) * 1000) / 10}%`}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Avg Position</CardTitle></CardHeader>
                <CardContent><p className="text-xl font-semibold text-foreground">{(gscSummary?.avg_position ?? 0).toFixed(1)}</p></CardContent>
              </Card>
            </div>

            {gscTimeseries && gscTimeseries.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">Daily Search Clicks &amp; Impressions</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={gscTimeseries}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip labelFormatter={(d) => new Date(d).toLocaleDateString('en-IN')} />
                      <Bar dataKey="impressions" name="Impressions" fill="var(--chart-4)" radius={[4, 4, 0, 0]} />
                      <Line type="monotone" dataKey="clicks" name="Clicks" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            <div className="grid md:grid-cols-2 gap-6">
              <BreakdownRowsCard title="Top Queries" rows={gscTopQueries} labelKey="label" valueKey="clicks" valueLabel="Clicks" />
              <BreakdownRowsCard title="Top Pages (Search)" rows={gscTopPages} labelKey="label" valueKey="clicks" valueLabel="Clicks" />
            </div>
          </>
        )}
      </div>

      {/* Visitor-level funnel, from GA4 events. Sits ABOVE the SQL funnel
          because it is the wider measurement: it includes people who never
          created a database row. */}
      <div className="space-y-6">
        <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2"><Eye className="h-4 w-4" /> Visitor funnel (Google Analytics)</h3>
        <p className="text-xs text-muted-foreground -mt-4">
          Every visitor, including people who never signed in — so these are bigger than the
          cart/order figures below, and the gap between the two is the point. This one answers
          &ldquo;how many looked but never added to a cart&rdquo;; the one below answers &ldquo;what
          actually reached the database&rdquo;. They are not meant to match.
        </p>
        {gaFunnel?.no_events ? (
          <Card className="border-warning/20">
            <CardContent className="pt-6 flex items-start gap-2 text-sm text-warning">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                No product or cart events have been received in this period. The storefront only
                started sending them recently, and Google can take 24–48 hours to process them —
                if this is still empty after a day, check the Analytics connection card above.
              </span>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {[
                { label: 'Viewed a product', value: gaFunnel?.view_item ?? 0 },
                { label: 'Added to cart', value: gaFunnel?.add_to_cart ?? 0, sub: stepRate(gaFunnel?.view_to_cart_rate) },
                { label: 'Viewed cart', value: gaFunnel?.view_cart ?? 0 },
                { label: 'Started checkout', value: gaFunnel?.begin_checkout ?? 0, sub: stepRate(gaFunnel?.cart_to_checkout_rate) },
                { label: 'Purchased', value: gaFunnel?.purchase ?? 0, sub: stepRate(gaFunnel?.checkout_to_purchase_rate) },
              ].map((t) => (
                <Card key={t.label}>
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{t.label}</CardTitle></CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold tabular-nums">{Number(t.value).toLocaleString('en-IN')}</p>
                    {t.sub && <p className="text-xs text-muted-foreground mt-0.5">{t.sub} of previous step</p>}
                  </CardContent>
                </Card>
              ))}
            </div>

            {searchTerms?.dimension_missing ? (
              <Card className="border-warning/20">
                <CardContent className="pt-6 text-sm text-warning">
                  On-site search terms are being collected but can&apos;t be broken out yet — register
                  <span className="font-mono text-xs"> search_term </span>
                  as an event-scoped Custom definition in Google Analytics Admin.
                </CardContent>
              </Card>
            ) : searchTerms?.rows?.length ? (
              <BreakdownRowsCard
                title="What people searched for"
                rows={searchTerms.rows}
                labelKey="term"
                valueKey="count"
                valueLabel="Searches"
              />
            ) : null}
          </>
        )}
      </div>

      <div className="space-y-6">
        <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2"><ShoppingCart className="h-4 w-4" /> Records (cart → checkout → purchase)</h3>
        <p className="text-xs text-muted-foreground -mt-4">
          Cart-onward only — the storefront doesn&apos;t yet send add-to-cart/checkout events to Google Analytics, so this is built from actual cart and order records, not site-wide traffic.
        </p>
        {/* An all-zero funnel is ambiguous in exactly the same way an all-zero
            traffic chart is: it reads as "broken report" when it may simply be
            "nothing has happened yet". Say which. */}
        {funnel && (funnel.checkout_started ?? 0) === 0 && (funnel.purchased ?? funnel.purchased_orders ?? 0) === 0 && (
          <p className="text-xs text-muted-foreground -mt-4">
            These are all zero because no website order has been placed yet — this is the real figure,
            not a reporting problem. Carts Started counts people who added something to a cart.
          </p>
        )}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Carts Started</CardTitle></CardHeader>
            <CardContent><p className="text-xl font-semibold text-foreground">{funnel?.cart_customers ?? 0}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Checkout Started</CardTitle></CardHeader>
            <CardContent><p className="text-xl font-semibold text-foreground">{funnel?.checkout_started ?? 0}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Purchased</CardTitle></CardHeader>
            <CardContent><p className="text-xl font-semibold text-foreground">{funnel?.purchased ?? 0}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Checkout → Purchase</CardTitle></CardHeader>
            <CardContent><p className="text-xl font-semibold text-foreground">{funnel?.checkout_to_purchase_rate != null ? `${funnel.checkout_to_purchase_rate}%` : '—'}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Abandoned Carts</CardTitle></CardHeader>
            <CardContent><p className="text-xl font-semibold text-foreground">{funnel?.abandoned_cart_customers ?? 0}</p></CardContent>
          </Card>
        </div>

        {funnelSeries && funnelSeries.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Funnel Over Time</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={funnelSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip labelFormatter={(d) => new Date(d).toLocaleDateString('en-IN')} />
                  <Bar dataKey="cart_customers" name="Carts Started" fill="var(--chart-4)" radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="checkout_started" name="Checkout Started" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="purchased" name="Purchased" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-6">
        <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2"><Activity className="h-4 w-4" /> Health</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Uptime</CardTitle></CardHeader>
            <CardContent><p className="text-xl font-semibold text-foreground">{health?.uptime_pct != null ? `${health.uptime_pct}%` : '—'}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Avg Latency</CardTitle></CardHeader>
            <CardContent><p className="text-xl font-semibold text-foreground">{health?.avg_latency_ms != null ? `${health.avg_latency_ms}ms` : '—'}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">P95 Latency</CardTitle></CardHeader>
            <CardContent><p className="text-xl font-semibold text-foreground">{health?.p95_latency_ms != null ? `${Math.round(health.p95_latency_ms)}ms` : '—'}</p></CardContent>
          </Card>
        </div>

        {health?.timeseries && health.timeseries.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Uptime &amp; Latency (Hourly)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={health.timeseries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} tickFormatter={(d) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric' })} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip labelFormatter={(d) => new Date(d).toLocaleString('en-IN')} />
                  <Line type="monotone" dataKey="uptime_pct" name="Uptime %" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="avg_latency_ms" name="Avg Latency (ms)" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {health?.recent_failures && health.recent_failures.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Recent Failures</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Checked At</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {health.recent_failures.map((f: any, i: number) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-2">{new Date(f.checked_at).toLocaleString('en-IN')}</td>
                        <td className="px-3 py-2">{f.status_code ?? '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">{f.error_message ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground">
          Core Web Vitals and function error logs: see the{' '}
          <a href="https://vercel.com/dashboard" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
            Vercel dashboard
          </a>{' '}
          (Speed Insights and Logs tabs) — not duplicated here.
        </p>
      </div>
    </div>
  )
}

function BreakdownRowsCard({ title, rows, labelKey, valueKey, valueLabel }: { title: string; rows: any[] | null; labelKey: string; valueKey: string; valueLabel: string }) {
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
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">{valueLabel}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2">{r[labelKey]}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r[valueKey]}</td>
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

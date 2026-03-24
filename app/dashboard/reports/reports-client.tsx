'use client'

import { useState, useMemo } from 'react'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  TrendingUp, TrendingDown, Package,
  IndianRupee, BarChart3, Users,
  ShoppingCart, AlertTriangle, Star
} from 'lucide-react'

type Sale = {
  id: string
  sale_date: string
  sale_month: string
  sale_year: number
  customer_name: string
  asset_number: string
  brand: string
  type: string
  sale_base_price: number
  sale_gst: number
  sale_total: number
  sale_type: string
}

type Purchase = {
  id: string
  purchase_date: string
  asset_number: string
  brand: string
  type: string
  base_price: number
  total_price: number
  selling_price: number
  stock_status: string
  purchase_type: string
  created_at: string
}

type Expense = {
  id: string
  expense_date: string
  type: string
  amount: number
}

const COLORS = ['#2563eb','#16a34a','#ea580c','#9333ea','#db2777','#0891b2','#65a30d','#dc2626']
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function ReportsClient({
  allSales,
  allPurchases,
  allExpenses,
  stockForSale,
  inStock,
  currentMonth,
  currentYear,
  lastMonth,
  lastMonthYear,
  lastYear,
}: {
  allSales: Sale[]
  allPurchases: Purchase[]
  allExpenses: Expense[]
  stockForSale: Purchase[]
  inStock: Purchase[]
  currentMonth: number
  currentYear: number
  lastMonth: number
  lastMonthYear: number
  lastYear: number
}) {

  const [activeTab, setActiveTab] = useState('overview')

  // ── Helper: filter sales by month+year ──
  const salesOf = (month: number, year: number) =>
    allSales.filter(s => s.sale_year === year &&
      new Date(s.sale_date).getMonth() + 1 === month)

  const salesOfYear = (year: number) =>
    allSales.filter(s => s.sale_year === year)

  // ── Revenue helpers ──
  const revenue = (sales: Sale[]) =>
    sales.reduce((sum, s) => sum + (s.sale_total || 0), 0)

  const grossProfit = (sales: Sale[]) => {
    return sales.reduce((sum, s) => {
      const purchase = allPurchases.find(p => p.asset_number === s.asset_number)
      const cost = purchase?.total_price || 0
      return sum + ((s.sale_total || 0) - cost)
    }, 0)
  }

  const totalExpensesOf = (month: number, year: number) =>
    allExpenses
      .filter(e => {
        const d = new Date(e.expense_date)
        return d.getMonth() + 1 === month && d.getFullYear() === year
      })
      .reduce((sum, e) => sum + (e.amount || 0), 0)

  const totalExpensesOfYear = (year: number) =>
    allExpenses
      .filter(e => new Date(e.expense_date).getFullYear() === year)
      .reduce((sum, e) => sum + (e.amount || 0), 0)

  // ── Key metrics ──
  const mtdSales   = salesOf(currentMonth, currentYear)
  const lmtdSales  = salesOf(lastMonth, lastMonthYear)
  const ytdSales   = salesOfYear(currentYear)
  const lytdSales  = salesOfYear(lastYear)

  const mtdRevenue   = revenue(mtdSales)
  const lmtdRevenue  = revenue(lmtdSales)
  const ytdRevenue   = revenue(ytdSales)
  const lytdRevenue  = revenue(lytdSales)

  const mtdGross   = grossProfit(mtdSales)
  const ytdGross   = grossProfit(ytdSales)

  const mtdExpenses  = totalExpensesOf(currentMonth, currentYear)
  const ytdExpenses  = totalExpensesOfYear(currentYear)

  const mtdNet  = mtdGross - mtdExpenses
  const ytdNet  = ytdGross - ytdExpenses

  const revenueGrowth = lmtdRevenue > 0
    ? (((mtdRevenue - lmtdRevenue) / lmtdRevenue) * 100).toFixed(1)
    : '0'

  const ytdGrowth = lytdRevenue > 0
    ? (((ytdRevenue - lytdRevenue) / lytdRevenue) * 100).toFixed(1)
    : '0'

  // ── Monthly trend (last 12 months) ──
  const monthlyTrend = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(currentYear, currentMonth - 1 - (11 - i), 1)
      const m = d.getMonth() + 1
      const y = d.getFullYear()
      const s = salesOf(m, y)
      return {
        name: MONTH_NAMES[d.getMonth()],
        revenue: Math.round(revenue(s)),
        profit: Math.round(grossProfit(s)),
        units: s.length,
      }
    })
  }, [allSales])

  // ── Brand performance ──
  const brandData = useMemo(() => {
    const map: Record<string, { revenue: number; units: number; profit: number }> = {}
    allSales.forEach(s => {
      const brand = s.brand || 'Unknown'
      const purchase = allPurchases.find(p => p.asset_number === s.asset_number)
      const cost = purchase?.total_price || 0
      if (!map[brand]) map[brand] = { revenue: 0, units: 0, profit: 0 }
      map[brand].revenue += s.sale_total || 0
      map[brand].units += 1
      map[brand].profit += (s.sale_total || 0) - cost
    })
    return Object.entries(map)
      .map(([brand, d]) => ({ brand, ...d }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [allSales])

  // ── Customer revenue ──
  const customerData = useMemo(() => {
    const map: Record<string, { revenue: number; units: number }> = {}
    allSales.forEach(s => {
      const c = s.customer_name || 'Unknown'
      if (!map[c]) map[c] = { revenue: 0, units: 0 }
      map[c].revenue += s.sale_total || 0
      map[c].units += 1
    })
    return Object.entries(map)
      .map(([customer, d]) => ({ customer, ...d }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
  }, [allSales])

  // ── Expense breakdown ──
  const expenseByType = useMemo(() => {
    const map: Record<string, number> = {}
    allExpenses.forEach(e => {
      map[e.type] = (map[e.type] || 0) + (e.amount || 0)
    })
    return Object.entries(map).map(([name, value]) => ({ name, value }))
  }, [allExpenses])

  // ── Stock aging ──
  const stockAging = useMemo(() => {
    const now = new Date()
    return [...inStock, ...stockForSale].map(p => {
      const purchaseDate = new Date(p.purchase_date || p.created_at)
      const days = Math.floor((now.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24))
      const potentialLoss = (p.selling_price || 0) - (p.total_price || 0)
      return { ...p, daysInStock: days, potentialProfit: potentialLoss }
    }).sort((a, b) => b.daysInStock - a.daysInStock)
  }, [inStock, stockForSale])

  // ── Sale type split ──
  const saleTypeSplit = useMemo(() => {
    const cash = allSales.filter(s => s.sale_type === 'Cash').length
    const gst = allSales.filter(s => s.sale_type === 'GST').length
    return [
      { name: 'Cash', value: cash },
      { name: 'GST', value: gst },
    ]
  }, [allSales])

  // ── Format helpers ──
  const fmt = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
  const pct = (n: number) => Number(n) >= 0
    ? <span className="text-green-600 flex items-center gap-1"><TrendingUp className="h-3 w-3" />+{n}%</span>
    : <span className="text-red-600 flex items-center gap-1"><TrendingDown className="h-3 w-3" />{n}%</span>

  const MetricCard = ({
    title, value, sub, icon: Icon, color, growth
  }: {
    title: string
    value: string
    sub?: string
    icon: React.ElementType
    color: string
    growth?: React.ReactNode
  }) => (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            {title}
          </CardTitle>
          <div className={`p-2 rounded-lg ${color}`}>
            <Icon className="h-3.5 w-3.5 text-white" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xl font-semibold text-gray-900">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
        {growth && <div className="text-xs mt-1">{growth}</div>}
      </CardContent>
    </Card>
  )

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Reports & Insights</h1>
        <p className="text-sm text-gray-500 mt-1">
          Live data from your inventory
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6 flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
        </TabsList>

        {/* ── OVERVIEW TAB ── */}
        <TabsContent value="overview">

          {/* Revenue metrics */}
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
            Revenue metrics
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <MetricCard
              title="MTD Revenue"
              value={fmt(mtdRevenue)}
              sub={`${mtdSales.length} units sold`}
              icon={IndianRupee}
              color="bg-blue-600"
              growth={pct(revenueGrowth)}
            />
            <MetricCard
              title="LMTD Revenue"
              value={fmt(lmtdRevenue)}
              sub={`${lmtdSales.length} units sold`}
              icon={IndianRupee}
              color="bg-gray-500"
            />
            <MetricCard
              title="YTD Revenue"
              value={fmt(ytdRevenue)}
              sub={`${ytdSales.length} units sold`}
              icon={TrendingUp}
              color="bg-green-600"
              growth={pct(ytdGrowth)}
            />
            <MetricCard
              title="LYTD Revenue"
              value={fmt(lytdRevenue)}
              sub={`${lytdSales.length} units sold`}
              icon={TrendingUp}
              color="bg-gray-500"
            />
          </div>

          {/* Profit metrics */}
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
            Profit metrics
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <MetricCard
              title="MTD Gross Profit"
              value={fmt(mtdGross)}
              sub="Revenue minus purchase cost"
              icon={TrendingUp}
              color="bg-emerald-600"
            />
            <MetricCard
              title="MTD Net Profit"
              value={fmt(mtdNet)}
              sub="After all expenses"
              icon={IndianRupee}
              color={mtdNet >= 0 ? 'bg-emerald-600' : 'bg-red-600'}
            />
            <MetricCard
              title="YTD Gross Profit"
              value={fmt(ytdGross)}
              sub="Revenue minus purchase cost"
              icon={TrendingUp}
              color="bg-emerald-600"
            />
            <MetricCard
              title="YTD Net Profit"
              value={fmt(ytdNet)}
              sub="After all expenses"
              icon={IndianRupee}
              color={ytdNet >= 0 ? 'bg-emerald-600' : 'bg-red-600'}
            />
          </div>

          {/* Stock overview */}
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
            Stock overview
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <MetricCard
              title="Ready for Sale"
              value={stockForSale.length.toString()}
              sub={`Value: ${fmt(stockForSale.reduce((s, p) => s + (p.selling_price || 0), 0))}`}
              icon={Package}
              color="bg-green-600"
            />
            <MetricCard
              title="In Stock"
              value={inStock.length.toString()}
              sub={`Cost: ${fmt(inStock.reduce((s, p) => s + (p.total_price || 0), 0))}`}
              icon={Package}
              color="bg-orange-500"
            />
            <MetricCard
              title="Total Purchases"
              value={allPurchases.length.toString()}
              sub="All time"
              icon={ShoppingCart}
              color="bg-blue-600"
            />
            <MetricCard
              title="Total Sales"
              value={allSales.length.toString()}
              sub="All time"
              icon={BarChart3}
              color="bg-purple-600"
            />
          </div>

          {/* Monthly trend chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                Monthly Revenue vs Gross Profit (last 12 months)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => `₹${v.toLocaleString('en-IN')}`} />
                  <Legend />
                  <Bar dataKey="revenue" name="Revenue" fill="#2563eb" radius={[4,4,0,0]} />
                  <Bar dataKey="profit" name="Gross Profit" fill="#16a34a" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

        </TabsContent>

        {/* ── REVENUE TAB ── */}
        <TabsContent value="revenue">

          {/* Units trend */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                Units Sold per Month
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="units"
                    name="Units Sold"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Brand performance table */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                Revenue by Brand
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Brand</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Units Sold</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Revenue</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Gross Profit</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Avg Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {brandData.map((b, i) => (
                    <tr key={b.brand} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium flex items-center gap-2">
                        {i === 0 && <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" />}
                        {b.brand}
                      </td>
                      <td className="px-4 py-3">{b.units}</td>
                      <td className="px-4 py-3 font-medium">{fmt(b.revenue)}</td>
                      <td className="px-4 py-3 text-green-600">{fmt(b.profit)}</td>
                      <td className="px-4 py-3">
                        <Badge
                          className={
                            b.revenue > 0 && (b.profit / b.revenue) > 0.15
                              ? 'bg-green-100 text-green-700'
                              : 'bg-orange-100 text-orange-700'
                          }
                        >
                          {b.revenue > 0 ? ((b.profit / b.revenue) * 100).toFixed(1) : 0}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {brandData.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-gray-400">
                        No sales data yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Sale type split */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Cash vs GST Sales</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={saleTypeSplit}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {saleTypeSplit.map((_, i) => (
                        <Cell key={i} fill={COLORS[i]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Expense Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={expenseByType}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      dataKey="value"
                      label={({ name }) => name}
                    >
                      {expenseByType.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmt(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

        </TabsContent>

        {/* ── STOCK TAB ── */}
        <TabsContent value="stock">

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent className="pt-6">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Total Stock Value</p>
                <p className="text-2xl font-semibold mt-1">
                  {fmt([...inStock, ...stockForSale].reduce((s, p) => s + (p.selling_price || 0), 0))}
                </p>
                <p className="text-xs text-gray-400 mt-1">At selling price</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Total Cost in Stock</p>
                <p className="text-2xl font-semibold mt-1">
                  {fmt([...inStock, ...stockForSale].reduce((s, p) => s + (p.total_price || 0), 0))}
                </p>
                <p className="text-xs text-gray-400 mt-1">Money tied up</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Potential Profit</p>
                <p className="text-2xl font-semibold text-green-600 mt-1">
                  {fmt([...inStock, ...stockForSale].reduce((s, p) =>
                    s + ((p.selling_price || 0) - (p.total_price || 0)), 0))}
                </p>
                <p className="text-xs text-gray-400 mt-1">If all stock sold today</p>
              </CardContent>
            </Card>
          </div>

          {/* Stock aging table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                Stock Aging Report
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Asset No.</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Brand</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Description</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Days in Stock</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Cost</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Selling Price</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Potential Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockAging.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center py-8 text-gray-400">
                          No stock found
                        </td>
                      </tr>
                    ) : (
                      stockAging.map((p) => (
                        <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-blue-600">{p.asset_number}</td>
                          <td className="px-4 py-3">{p.brand}</td>
                          <td className="px-4 py-3 text-gray-600 max-w-[180px] truncate">
                            {p.asset_description}
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              className={
                                p.stock_status === 'Ready for Sale'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-orange-100 text-orange-700'
                              }
                            >
                              {p.stock_status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              className={
                                p.daysInStock > 60
                                  ? 'bg-red-100 text-red-700'
                                  : p.daysInStock > 30
                                  ? 'bg-orange-100 text-orange-700'
                                  : 'bg-green-100 text-green-700'
                              }
                            >
                              {p.daysInStock}d
                            </Badge>
                          </td>
                          <td className="px-4 py-3">{fmt(p.total_price)}</td>
                          <td className="px-4 py-3 text-green-600 font-medium">
                            {fmt(p.selling_price)}
                          </td>
                          <td className="px-4 py-3 font-medium">
                            {fmt(p.potentialProfit)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

        </TabsContent>

        {/* ── CUSTOMERS TAB ── */}
        <TabsContent value="customers">

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4" />
                Top 10 Customers by Revenue
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-4 py-3 font-medium text-gray-600">#</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Customer</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Units Bought</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Total Revenue</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Avg per Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {customerData.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-gray-400">
                        No sales data yet
                      </td>
                    </tr>
                  ) : (
                    customerData.map((c, i) => (
                      <tr key={c.customer} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-400">{i + 1}</td>
                        <td className="px-4 py-3 font-medium flex items-center gap-2">
                          {i === 0 && <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" />}
                          {c.customer}
                        </td>
                        <td className="px-4 py-3">{c.units}</td>
                        <td className="px-4 py-3 font-medium text-blue-600">
                          {fmt(c.revenue)}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {fmt(c.units > 0 ? c.revenue / c.units : 0)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

        </TabsContent>

        {/* ── INSIGHTS TAB ── */}
        <TabsContent value="insights">

          <div className="space-y-4">

            {/* Slow moving stock alert */}
            {stockAging.filter(p => p.daysInStock > 45).length > 0 && (
              <Card className="border-orange-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2 text-orange-700">
                    <AlertTriangle className="h-4 w-4" />
                    Slow Moving Stock Alert
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-600 mb-3">
                    {stockAging.filter(p => p.daysInStock > 45).length} items
                    have been in stock for more than 45 days.
                    Used electronics depreciate — consider a price reduction to move them faster.
                  </p>
                  <div className="space-y-2">
                    {stockAging.filter(p => p.daysInStock > 45).slice(0, 5).map(p => (
                      <div key={p.id} className="flex items-center justify-between bg-orange-50 rounded-lg px-3 py-2 text-sm">
                        <span className="font-medium">{p.asset_number} — {p.brand}</span>
                        <Badge className="bg-orange-100 text-orange-700">{p.daysInStock} days</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Best performing brand insight */}
            {brandData.length > 0 && (
              <Card className="border-green-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2 text-green-700">
                    <Star className="h-4 w-4" />
                    Best Performing Brand
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold text-gray-900">{brandData[0].brand}</span> is
                    your top brand with {fmt(brandData[0].revenue)} in revenue
                    across {brandData[0].units} units sold.
                    Gross margin: {brandData[0].revenue > 0
                      ? ((brandData[0].profit / brandData[0].revenue) * 100).toFixed(1)
                      : 0}%.
                    Prioritise sourcing more {brandData[0].brand} stock.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Revenue growth insight */}
            <Card className={Number(revenueGrowth) >= 0 ? 'border-green-200' : 'border-red-200'}>
              <CardHeader className="pb-2">
                <CardTitle className={`text-sm font-medium flex items-center gap-2 ${Number(revenueGrowth) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {Number(revenueGrowth) >= 0
                    ? <TrendingUp className="h-4 w-4" />
                    : <TrendingDown className="h-4 w-4" />
                  }
                  Month on Month Revenue Trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600">
                  This month you have earned{' '}
                  <span className="font-semibold text-gray-900">{fmt(mtdRevenue)}</span> vs{' '}
                  <span className="font-semibold text-gray-900">{fmt(lmtdRevenue)}</span> last month.
                  That is a{' '}
                  <span className={`font-semibold ${Number(revenueGrowth) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {Number(revenueGrowth) >= 0 ? '+' : ''}{revenueGrowth}%
                  </span>{' '}
                  {Number(revenueGrowth) >= 0 ? 'growth' : 'decline'}.
                  {Number(revenueGrowth) < 0 && ' Focus on clearing ready-for-sale stock this month.'}
                  {Number(revenueGrowth) >= 20 && ' Excellent growth! Consider sourcing more inventory.'}
                </p>
              </CardContent>
            </Card>

            {/* Net profit insight */}
            <Card className={mtdNet >= 0 ? 'border-green-200' : 'border-red-200'}>
              <CardHeader className="pb-2">
                <CardTitle className={`text-sm font-medium flex items-center gap-2 ${mtdNet >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  <IndianRupee className="h-4 w-4" />
                  Net Profit Health
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600">
                  This month your gross profit is{' '}
                  <span className="font-semibold text-gray-900">{fmt(mtdGross)}</span> and
                  total expenses are{' '}
                  <span className="font-semibold text-gray-900">{fmt(mtdExpenses)}</span>,
                  leaving a net profit of{' '}
                  <span className={`font-semibold ${mtdNet >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {fmt(mtdNet)}
                  </span>.
                  {mtdNet < 0 && ' Your expenses exceed your gross profit this month. Review your expense categories.'}
                  {mtdNet >= 0 && mtdGross > 0 &&
                    ` Net margin: ${((mtdNet / mtdRevenue) * 100).toFixed(1)}%.`
                  }
                </p>
              </CardContent>
            </Card>

            {/* Top customer insight */}
            {customerData.length > 0 && (
              <Card className="border-blue-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2 text-blue-700">
                    <Users className="h-4 w-4" />
                    Top Customer Insight
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-600">
                    Your top customer is{' '}
                    <span className="font-semibold text-gray-900">{customerData[0].customer}</span>{' '}
                    with {fmt(customerData[0].revenue)} in total purchases
                    across {customerData[0].units} units.
                    They represent{' '}
                    <span className="font-semibold text-gray-900">
                      {ytdRevenue > 0
                        ? ((customerData[0].revenue / ytdRevenue) * 100).toFixed(1)
                        : 0}%
                    </span>{' '}
                    of your total revenue. Nurture this relationship.
                  </p>
                </CardContent>
              </Card>
            )}

          </div>

        </TabsContent>

      </Tabs>
    </div>
  )
}
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ShoppingCart, TrendingUp, Users, Receipt, Package, IndianRupee } from 'lucide-react'

export default async function DashboardPage() {
  const supabase = await createClient()

  // Fetch counts for summary cards
  const [purchases, sales, customers, expenses] = await Promise.all([
    supabase.from('purchases').select('*', { count: 'exact', head: true }),
    supabase.from('sales').select('*', { count: 'exact', head: true }),
    supabase.from('customers').select('*', { count: 'exact', head: true }),
    supabase.from('expenses').select('amount'),
  ])

  const totalExpenses = expenses.data?.reduce((sum, e) => sum + (e.amount || 0), 0) || 0
  const inStock = await supabase.from('purchases').select('*', { count: 'exact', head: true }).eq('stock_status', 'In Stock')
  const readyForSale = await supabase.from('purchases').select('*', { count: 'exact', head: true }).eq('stock_status', 'Ready for Sale')

  const stats = [
    {
      title: 'Total Purchases',
      value: purchases.count || 0,
      icon: ShoppingCart,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      title: 'Total Sales',
      value: sales.count || 0,
      icon: TrendingUp,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      title: 'In Stock',
      value: inStock.count || 0,
      icon: Package,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
    },
    {
      title: 'Ready for Sale',
      value: readyForSale.count || 0,
      icon: Receipt,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
    {
      title: 'Customers',
      value: customers.count || 0,
      icon: Users,
      color: 'text-pink-600',
      bg: 'bg-pink-50',
    },
    {
      title: 'Total Expenses',
      value: `₹${totalExpenses.toLocaleString('en-IN')}`,
      icon: IndianRupee,
      color: 'text-red-600',
      bg: 'bg-red-50',
    },
  ]

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Welcome back! Here is your business overview.</p>
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
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
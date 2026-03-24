import { createClient } from '@/lib/supabase/server'
import ReportsClient from './reports-client'

export default async function ReportsPage() {
  const supabase = await createClient()

  const now = new Date()
  const thisMonth = now.getMonth() + 1
  const thisYear = now.getFullYear()
  const lastMonth = thisMonth === 1 ? 12 : thisMonth - 1
  const lastMonthYear = thisMonth === 1 ? thisYear - 1 : thisYear
  const lastYear = thisYear - 1

  // All sales
  const { data: allSales } = await supabase
    .from('sales')
    .select('*')
    .order('sale_date', { ascending: true })

  // All purchases
  const { data: allPurchases } = await supabase
    .from('purchases')
    .select('*')

  // All expenses
  const { data: allExpenses } = await supabase
    .from('expenses')
    .select('*')

  // Stock for sale
  const { data: stockForSale } = await supabase
    .from('purchases')
    .select('*')
    .eq('stock_status', 'Ready for Sale')

  // In stock
  const { data: inStock } = await supabase
    .from('purchases')
    .select('*')
    .eq('stock_status', 'In Stock')

  return (
    <ReportsClient
      allSales={allSales || []}
      allPurchases={allPurchases || []}
      allExpenses={allExpenses || []}
      stockForSale={stockForSale || []}
      inStock={inStock || []}
      currentMonth={thisMonth}
      currentYear={thisYear}
      lastMonth={lastMonth}
      lastMonthYear={lastMonthYear}
      lastYear={lastYear}
    />
  )
}
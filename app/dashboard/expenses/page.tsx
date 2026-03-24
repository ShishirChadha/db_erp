import { createClient } from '@/lib/supabase/server'
import ExpensesClient from './expenses-client'

export default async function ExpensesPage() {
  const supabase = await createClient()
  const { data: expenses } = await supabase
    .from('expenses')
    .select('*')
    .order('created_at', { ascending: false })

  return <ExpensesClient initialData={expenses || []} />
}
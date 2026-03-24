import { createClient } from '@/lib/supabase/server'
import PurchasesClient from './purchases-client'

export default async function PurchasesPage() {
  const supabase = await createClient()
  const { data: purchases } = await supabase
    .from('purchases')
    .select('*')
    .order('created_at', { ascending: false })

  return <PurchasesClient initialData={purchases || []} />
}
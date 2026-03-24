import { createClient } from '@/lib/supabase/server'
import VendorsClient from './vendors-client'

export default async function VendorsPage() {
  const supabase = await createClient()
  const { data: vendors } = await supabase
    .from('vendors')
    .select('*')
    .order('created_at', { ascending: false })

  return <VendorsClient initialData={vendors || []} />
}
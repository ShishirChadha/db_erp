import { createClient } from '@/lib/supabase/server'
import PurchasesClient from './purchases-client'

export default async function PurchasesPage() {
  const supabase = await createClient()

  const [
    { data: purchases },
    { data: vendors },
    { data: typeOptions },
    { data: accessoryOptions },
  ] = await Promise.all([
    supabase.from('purchases').select('*').order('created_at', { ascending: false }),
    supabase.from('vendors').select('id, company_name'),
    supabase.from('custom_options').select('value').eq('category', 'type'),
    supabase.from('custom_options').select('value').eq('category', 'accessory_type'),
  ])

  return (
    <PurchasesClient
      initialData={purchases || []}
      vendors={vendors || []}
      customTypes={typeOptions?.map(t => t.value) || []}
      customAccessoryTypes={accessoryOptions?.map(t => t.value) || []}
    />
  )
}
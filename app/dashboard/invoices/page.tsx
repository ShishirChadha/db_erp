import { createClient } from '@/lib/supabase/server'
import InvoicesClient from './invoices-client'

export default async function InvoicesPage() {
  const supabase = await createClient()

  const { data: sales } = await supabase
    .from('sales')
    .select(`
      *,
      purchases!sales_asset_number_fkey (
        brand,
        asset_description,
        base_price,
        total_price
      )
    `)
    .order('sale_date', { ascending: false })

  return <InvoicesClient sales={sales || []} />
}
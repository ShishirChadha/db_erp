import { createClient } from '@/lib/supabase/server'
import SalesClient from './sales-client'

export default async function SalesPage() {
  const supabase = await createClient()

  const [{ data: sales }, { data: customers }, { data: purchases }] = await Promise.all([
    supabase.from('sales').select('*').order('created_at', { ascending: false }),
    supabase.from('customers').select('customer_name'),
    supabase.from('purchases').select('asset_number, brand, asset_description, serial_number, sku, type, base_price, gst, total_price, selling_price, vendor_name, purchase_date'),
  ])

  return (
    <SalesClient
      initialData={sales || []}
      customers={customers || []}
      purchases={purchases || []}
    />
  )
}
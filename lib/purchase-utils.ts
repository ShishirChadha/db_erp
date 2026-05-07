// lib/purchase-utils.ts
import { supabaseAdmin } from './supabase/service'

export async function recalcPOTotals(poId: string) {
  const { data: items, error } = await supabaseAdmin
    .from('purchase_order_items')
    .select('line_total, gst_amount')
    .eq('po_id', poId)

  if (error) throw error

  const totalAmount = items.reduce((sum, i) => sum + (i.line_total - i.gst_amount), 0)
  const gstTotal = items.reduce((sum, i) => sum + i.gst_amount, 0)
  const grandTotal = totalAmount + gstTotal

  await supabaseAdmin
    .from('purchase_orders')
    .update({ total_amount: totalAmount, gst_total: gstTotal, grand_total: grandTotal })
    .eq('id', poId)
}

export async function getVendorName(vendorId: string) {
  const { data } = await supabaseAdmin
    .from('vendors')
    .select('company_name')
    .eq('id', vendorId)
    .single()
  return data?.company_name || ''
}
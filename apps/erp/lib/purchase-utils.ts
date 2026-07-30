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

// Most recent vendor a given (fungible/accessory) SKU was bought from, by
// purchase_order_items.created_at -- used anywhere an accessory needs "who did I last
// buy this from" without a full purchase-history view (see /api/sku-master/[id]/history
// for the full list). One query for any number of SKUs, first-seen-wins per sku_id
// since results are already ordered newest first.
export async function getLastVendorsBySku(skuIds: string[]): Promise<Map<string, string>> {
  const lastVendorBySkuId = new Map<string, string>()
  if (skuIds.length === 0) return lastVendorBySkuId

  const { data: items } = await supabaseAdmin
    .from('purchase_order_items')
    .select('sku_id, created_at, purchase_orders(vendor_name)')
    .in('sku_id', skuIds)
    .order('created_at', { ascending: false })

  for (const item of (items || []) as any[]) {
    if (!lastVendorBySkuId.has(item.sku_id) && item.purchase_orders?.vendor_name) {
      lastVendorBySkuId.set(item.sku_id, item.purchase_orders.vendor_name)
    }
  }
  return lastVendorBySkuId
}
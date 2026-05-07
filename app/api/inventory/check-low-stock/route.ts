import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { recalcPOTotals, getVendorName } from '@/lib/purchase-utils'

export async function POST(req: NextRequest) {
  // Optionally authenticate; we’ll skip for cron jobs, but can add token check.
  try {
    // Get all active SKUs
    const { data: skus } = await supabaseAdmin
      .from('sku_master')
      .select('id, full_sku_code, quantity_in_stock, reorder_level')
      .eq('status', 'active')

    if (!skus) return NextResponse.json({ checked: 0, auto_generated: 0 })

    const lowStockSkus = skus.filter(s => s.quantity_in_stock <= s.reorder_level)
    let created = 0

    for (const sku of lowStockSkus) {
      // Find rules with auto-generate enabled
      const { data: rules } = await supabaseAdmin
        .from('reorder_rules')
        .select('*')
        .eq('sku_id', sku.id)
        .eq('is_active', true)
        .eq('auto_generate_po', true)
        .order('reorder_quantity', { ascending: false })

      if (!rules?.length) continue
      const rule = rules[0]

      // Avoid duplicate auto-drafts for same SKU
      const { data: existing } = await supabaseAdmin
        .from('purchase_orders')
        .select('id')
        .eq('vendor_id', rule.vendor_id)
        .eq('po_status', 'draft')
        .ilike('remarks', '%AUTO-GENERATED%')
        .limit(1)
      if (existing && existing.length > 0) continue

      const { data: poNumber } = await supabaseAdmin.rpc('generate_po_number')
      const vendorName = await getVendorName(rule.vendor_id)

      const { data: newPo } = await supabaseAdmin
        .from('purchase_orders')
        .insert({
          po_number: poNumber,
          po_date: new Date().toISOString().slice(0, 10),
          vendor_id: rule.vendor_id,
          vendor_name: vendorName,
          po_status: 'draft',
          purchase_type: 'GST',
          purchased_by_type: 'Digitalbluez',   // default, can be extended
          remarks: `AUTO-GENERATED: SKU ${sku.full_sku_code} low stock (${sku.quantity_in_stock} units, reorder at ${sku.reorder_level})`
        })
        .select()
        .single()

      const { data: skuData } = await supabaseAdmin
        .from('sku_master')
        .select('base_sku_code, variant_number, base_cost')
        .eq('id', sku.id)
        .single()

      await supabaseAdmin.from('purchase_order_items').insert({
        po_id: newPo.id,
        line_item_number: 1,
        sku_id: sku.id,
        base_sku_code: skuData.base_sku_code,
        variant_number: skuData.variant_number,
        quantity: rule.reorder_quantity,
        base_price: skuData.base_cost,
        unit_price: skuData.base_cost,
        gst_percentage: 18,
        gst_amount: 0,
        line_total: 0
      })
      await recalcPOTotals(newPo.id)
      created++
    }

    return NextResponse.json({ checked: lowStockSkus.length, auto_generated: created })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
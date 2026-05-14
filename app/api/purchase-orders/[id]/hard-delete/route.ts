import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // 1. Invoice check – refuse if invoiced
  const { data: invoice } = await supabaseAdmin
    .from('invoices')
    .select('id')
    .eq('po_id', id)
    .eq('invoice_type', 'purchase')
    .maybeSingle()

  if (invoice) {
    return NextResponse.json(
      { error: 'Cannot delete this PO because an invoice exists. Please delete the invoice first.' },
      { status: 400 }
    )
  }

  // 2. Fetch the PO header and all items with their received quantities
  const { data: po } = await supabaseAdmin
    .from('purchase_orders')
    .select('po_number')
    .eq('id', id)
    .single()

  const { data: items } = await supabaseAdmin
    .from('purchase_order_items')
    .select('id, sku_id, quantity, serial_numbers, asset_prefix')
    .eq('po_id', id)

  // 3. Decrement stock for each item that has serials (i.e., was received)
  if (items && items.length > 0) {
    for (const item of items) {
      const receivedQty = item.serial_numbers ? item.serial_numbers.length : 0
      if (receivedQty > 0 && item.sku_id) {
        // Get current stock
        const { data: sku } = await supabaseAdmin
          .from('sku_master')
          .select('quantity_in_stock')
          .eq('id', item.sku_id)
          .single()

        const currentStock = sku?.quantity_in_stock ?? 0
        const newStock = Math.max(0, currentStock - receivedQty)

        await supabaseAdmin
          .from('sku_master')
          .update({ quantity_in_stock: newStock })
          .eq('id', item.sku_id)

        // Record stock movement for audit trail
        await supabaseAdmin.from('stock_movements').insert({
          sku_id: item.sku_id,
          movement_type: 'adjustment',      // or 'deletion'
          quantity_change: -receivedQty,
          quantity_before: currentStock,
          quantity_after: newStock,
          po_id: id,
          notes: `Stock reduced due to PO deletion (${po?.po_number})`,
        })
      }
    }
  }

  // 4. Delete asset mappings and line items
  await supabaseAdmin.from('purchase_order_asset_mapping').delete().eq('po_id', id)
  await supabaseAdmin.from('purchase_order_items').delete().eq('po_id', id)

  // 5. Delete the PO itself
  const { error: poErr } = await supabaseAdmin.from('purchase_orders').delete().eq('id', id)

  if (poErr) {
    return NextResponse.json({ error: poErr.message }, { status: 500 })
  }

  // 6. Reset asset counters for each prefix involved
  if (items && items.length > 0) {
    const currentYear = new Date().getFullYear().toString()
    const prefixes = [...new Set(items.map(i => i.asset_prefix).filter(Boolean))]

    for (const prefix of prefixes) {
      const { data: maxAsset } = await supabaseAdmin
        .from('purchase_order_asset_mapping')
        .select('asset_number')
        .ilike('asset_number', `${prefix}%`)
        .order('asset_number', { ascending: false })
        .limit(1)

      let maxNum = 0
      let maxSuffix = ''
      if (maxAsset && maxAsset.length > 0) {
        const lastAsset = maxAsset[0].asset_number
        const newRegex = new RegExp(`^${prefix}(\\d{2})-(\\d+)$`)
        const newMatch = lastAsset.match(newRegex)
        if (newMatch) {
          maxSuffix = newMatch[1]
          maxNum = parseInt(newMatch[2], 10)
        } else {
          const oldMatch = lastAsset.match(/(\d+)$/)
          if (oldMatch) maxNum = parseInt(oldMatch[1], 10)
        }
      }

      await supabaseAdmin
        .from('asset_counters')
        .upsert({ prefix, year: currentYear, last_number: maxNum, year_suffix: maxSuffix || null }, { onConflict: 'prefix,year' })
    }
  }

  // 7. Reset PO counter for the year
  if (po) {
    const year = po.po_number.split('-')[1]
    const { data: maxPO } = await supabaseAdmin
      .from('purchase_orders')
      .select('po_number')
      .ilike('po_number', `PO-${year}-%`)
      .order('po_number', { ascending: false })
      .limit(1)

    let maxPONum = 0
    if (maxPO && maxPO.length > 0) {
      const parts = maxPO[0].po_number.split('-')
      if (parts.length === 3) maxPONum = parseInt(parts[2], 10)
    }

    await supabaseAdmin
      .from('po_counter')
      .upsert({ year: parseInt(year), last_number: maxPONum }, { onConflict: 'year' })
  }

  return NextResponse.json({ success: true })
}
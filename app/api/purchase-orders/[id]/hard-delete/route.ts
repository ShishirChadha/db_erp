import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

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
    .select('id, sku_id, quantity, serial_numbers')
    .eq('po_id', id)

  // 3. Decrement stock for each item that has serials (i.e., was received)
  if (items && items.length > 0) {
    for (const item of items) {
      const receivedQty = item.serial_numbers ? item.serial_numbers.length : 0
      if (receivedQty > 0 && item.sku_id) {
        // sku_master.quantity_in_stock is updated atomically by the trg_sync_sku_stock
        // trigger (BEFORE INSERT on stock_movements), which also computes
        // quantity_before/quantity_after and floors at 0. No manual read-then-write here.
        await supabaseAdmin.from('stock_movements').insert({
          sku_id: item.sku_id,
          movement_type: 'adjustment',      // or 'deletion'
          quantity_change: -receivedQty,
          po_id: id,
          notes: `Stock reduced due to PO deletion (${po?.po_number})`,
        })
      }
    }
  }

  // 4. Delete asset mappings and line items
  await supabaseAdmin.from('asset_ledger').delete().eq('po_id', id)
  await supabaseAdmin.from('purchase_order_items').delete().eq('po_id', id)

  // 5. Delete the PO itself
  const { error: poErr } = await supabaseAdmin.from('purchase_orders').delete().eq('id', id)

  if (poErr) {
    return NextResponse.json({ error: poErr.message }, { status: 500 })
  }

  // 6. Reset PO counter for the year
  //
  // Note: this route intentionally does NOT try to "recover" the asset numbers
  // this PO had reserved (previously via a recalculate-from-asset_ledger step
  // here). Asset numbers are an atomic, never-reused sequence by design (see
  // docs/decisions.md) -- a deleted PO's numbers are meant to simply be spent,
  // not clawed back. That recalculation also used a lexicographic string sort
  // that could pick the wrong "max" once old-format legacy numbers (no year
  // segment) coexist with new-format ones under the same prefix -- removing it
  // avoids that bug entirely rather than patching it.
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
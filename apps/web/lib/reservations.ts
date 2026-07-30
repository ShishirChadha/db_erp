import { supabaseAdmin } from '@db/db/admin'

// Releases every still-active reservation for an order immediately (checkout
// aborted because one or more items couldn't be reserved) -- the same revert
// logic the expiry cron runs, just triggered synchronously instead of on a
// timer, so the customer isn't left holding a phantom lock on items that
// never made it into a real order.
export async function releaseReservationsForOrder(orderId: string): Promise<void> {
  const { data: orderItems } = await supabaseAdmin.from('order_items').select('id').eq('order_id', orderId)
  const orderItemIds = (orderItems ?? []).map((i) => i.id)
  if (orderItemIds.length === 0) return

  const { data: reservations } = await supabaseAdmin
    .from('web_reservations')
    .select('id, asset_id, previous_asset_status')
    .in('order_item_id', orderItemIds)
    .is('released_at', null)

  for (const r of reservations ?? []) {
    if (r.asset_id) {
      await supabaseAdmin
        .from('asset_ledger')
        .update({ status: r.previous_asset_status || 'ready_for_sale' })
        .eq('id', r.asset_id)
        .eq('status', 'reserved_web')
    }
    await supabaseAdmin.from('web_reservations').update({ released_at: new Date().toISOString() }).eq('id', r.id)
  }
}

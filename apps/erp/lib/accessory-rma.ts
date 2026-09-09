import { supabaseAdmin } from './supabase/service'
import { insertAccessoryMovement } from './accessory-movements'

// Accessory counterpart to processCustomerReturn (lib/rma.ts) -- accessories have no
// per-unit asset_ledger row, so there's no QC-pending status to move a returned unit
// into. Stock moves immediately at open (same "immediately real" principle as every
// other accessory stock change, see docs/decisions.md); accessory_rma_events is an
// audit/status trail layered on top, not a gate blocking the stock move.
//
// outbound_movement_id/inbound_movement_id are direction-agnostic: outbound always
// points at whichever movement *decreased* quantity_in_stock (opening a to_vendor case,
// or scrapping a from_customer return), inbound always at whichever *increased* it
// (opening a from_customer case, or a vendor-sent replacement arriving for a to_vendor
// case). Movement-type reuse: 'return' for stock physically leaving for a vendor or
// arriving back from a customer, 'receipt' for a genuine vendor-sent replacement,
// 'damage' for a customer return found unsellable on inspection -- both previously
// unused values in movement_type_enum (see docs/decisions.md).

type OpenResult = { error?: string; status?: number; event?: any }

export async function processAccessoryFromCustomer(
  skuId: string,
  quantity: number,
  opts: { reason: string; notes?: string | null; userId: string; eventDate?: string }
): Promise<OpenResult> {
  const openedAt = opts.eventDate ? `${opts.eventDate}T12:00:00.000Z` : undefined
  const { data: event, error: insertErr } = await supabaseAdmin
    .from('accessory_rma_events')
    .insert({
      sku_id: skuId,
      quantity,
      direction: 'from_customer',
      reason: opts.reason,
      notes: opts.notes || null,
      created_by: opts.userId,
      ...(openedAt ? { opened_at: openedAt } : {}),
    })
    .select()
    .single()
  if (insertErr) return { error: insertErr.message, status: 500 }

  const { data: movement, error: moveErr } = await insertAccessoryMovement({
    skuId,
    movementType: 'return',
    quantityChange: quantity,
    notes: `Customer return -- ${opts.reason}`,
    createdBy: opts.userId,
  })
  if (moveErr) return { error: moveErr.message, status: 500 }

  await supabaseAdmin.from('accessory_rma_events').update({ inbound_movement_id: movement?.id }).eq('id', event.id)

  return { event: { ...event, inbound_movement_id: movement?.id } }
}

export async function processAccessoryToVendor(
  skuId: string,
  quantity: number,
  opts: { reason: string; vendorId: string; notes?: string | null; userId: string; eventDate?: string }
): Promise<OpenResult> {
  const { data: sku } = await supabaseAdmin.from('sku_master').select('quantity_in_stock').eq('id', skuId).single()
  if (!sku) return { error: 'SKU not found', status: 404 }
  if (quantity > sku.quantity_in_stock) {
    return { error: `Only ${sku.quantity_in_stock} unit(s) in stock for this SKU.`, status: 400 }
  }

  const openedAt = opts.eventDate ? `${opts.eventDate}T12:00:00.000Z` : undefined
  const { data: event, error: insertErr } = await supabaseAdmin
    .from('accessory_rma_events')
    .insert({
      sku_id: skuId,
      quantity,
      direction: 'to_vendor',
      reason: opts.reason,
      vendor_id: opts.vendorId,
      notes: opts.notes || null,
      created_by: opts.userId,
      ...(openedAt ? { opened_at: openedAt } : {}),
    })
    .select()
    .single()
  if (insertErr) return { error: insertErr.message, status: 500 }

  const { data: movement, error: moveErr } = await insertAccessoryMovement({
    skuId,
    movementType: 'return',
    quantityChange: -quantity,
    vendorId: opts.vendorId,
    notes: `Sent to vendor -- ${opts.reason}`,
    createdBy: opts.userId,
  })
  if (moveErr) return { error: moveErr.message, status: 500 }

  await supabaseAdmin.from('accessory_rma_events').update({ outbound_movement_id: movement?.id }).eq('id', event.id)

  return { event: { ...event, outbound_movement_id: movement?.id } }
}

// Outcomes that resolve a to_vendor case and what stock movement (if any) they write.
// vendor_rejected/refund_received: vendor kept or refunded the stock -- no further movement,
// the outbound decrement from open already reflects reality.
// replacement_received: vendor sent a physical replacement -- genuinely new stock arriving.
const TO_VENDOR_MOVEMENT_TYPE: Record<string, 'receipt' | undefined> = {
  replacement_received: 'receipt',
}

// Outcomes that resolve a from_customer case.
// restocked: the returned unit is fine to resell -- stock already added at open, nothing more to do.
// scrapped: found unsellable on inspection -- reverse the increment made at open.
const FROM_CUSTOMER_MOVEMENT_TYPE: Record<string, 'damage' | undefined> = {
  scrapped: 'damage',
}

export async function closeAccessoryRma(
  eventId: string,
  status: string,
  opts: { notes?: string; userId: string }
): Promise<{ error?: string; status?: number }> {
  const { data: event } = await supabaseAdmin
    .from('accessory_rma_events')
    .select('id, sku_id, quantity, direction, vendor_id, status')
    .eq('id', eventId)
    .single()
  if (!event) return { error: 'Accessory RMA event not found', status: 404 }
  if (event.status === 'closed' || ['vendor_rejected', 'refund_received', 'replacement_received', 'restocked', 'scrapped'].includes(event.status)) {
    return { error: 'This accessory RMA event is already resolved.', status: 400 }
  }

  const toVendorStatuses = ['shipped', 'vendor_accepted', 'vendor_rejected', 'replacement_received', 'refund_received', 'closed']
  const fromCustomerStatuses = ['restocked', 'scrapped', 'closed']
  const validStatuses = event.direction === 'to_vendor' ? toVendorStatuses : fromCustomerStatuses
  if (!validStatuses.includes(status)) {
    return { error: `status must be one of: ${validStatuses.join(', ')}`, status: 400 }
  }

  const isTerminal = event.direction === 'to_vendor'
    ? ['vendor_rejected', 'replacement_received', 'refund_received', 'closed'].includes(status)
    : ['restocked', 'scrapped', 'closed'].includes(status)

  const updates: Record<string, any> = { status }
  if (opts.notes !== undefined) updates.notes = opts.notes
  if (isTerminal) updates.closed_at = new Date().toISOString()

  if (event.direction === 'to_vendor' && TO_VENDOR_MOVEMENT_TYPE[status]) {
    const { data: movement, error: moveErr } = await insertAccessoryMovement({
      skuId: event.sku_id,
      movementType: TO_VENDOR_MOVEMENT_TYPE[status]!,
      quantityChange: event.quantity,
      vendorId: event.vendor_id,
      notes: `Vendor replacement received -- accessory RMA`,
      createdBy: opts.userId,
    })
    if (moveErr) return { error: moveErr.message, status: 500 }
    updates.inbound_movement_id = movement?.id
  }

  if (event.direction === 'from_customer' && FROM_CUSTOMER_MOVEMENT_TYPE[status]) {
    const { data: movement, error: moveErr } = await insertAccessoryMovement({
      skuId: event.sku_id,
      movementType: FROM_CUSTOMER_MOVEMENT_TYPE[status]!,
      quantityChange: -event.quantity,
      notes: `Scrapped on inspection -- accessory RMA`,
      createdBy: opts.userId,
    })
    if (moveErr) return { error: moveErr.message, status: 500 }
    updates.outbound_movement_id = movement?.id
  }

  const { error: updateErr } = await supabaseAdmin.from('accessory_rma_events').update(updates).eq('id', eventId)
  if (updateErr) return { error: updateErr.message, status: 500 }

  return {}
}

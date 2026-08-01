import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner, hasPageAccess, canEditPage } from '@/lib/auth/session'
import { logFieldCorrections } from '@/lib/field-corrections'
import { logAuditEvent } from '@/lib/audit-log'
import { insertAccessoryMovement } from '@/lib/accessory-movements'

// ---------- GET: fetch one sale ----------
// Reachable from both the Sales ledger page and the Live Stock asset detail page's
// "Sale Details" panel -- either page grant is enough to view.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!hasPageAccess(sessionUser, ['live_stock', 'sales', 'stock'])) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data, error } = await supabaseAdmin.from('sales').select('*').eq('id', id).single()
  if (error || !data) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })

  const { data: history } = await supabaseAdmin
    .from('field_corrections')
    .select('field_name, old_value, new_value, changed_by, changed_at, reason')
    .eq('table_name', 'sales')
    .eq('record_id', id)
    .order('changed_at', { ascending: true })

  // Enrich bundled_accessories with a display name so EditSaleDialog doesn't need a
  // second round trip per accessory.
  let bundledAccessories = data.bundled_accessories
  if (Array.isArray(bundledAccessories) && bundledAccessories.length > 0) {
    const ids = bundledAccessories.map((b: any) => b.accessory_id).filter(Boolean)
    const { data: skus } = await supabaseAdmin.from('sku_master').select('id, sku_description').in('id', ids)
    const nameById = new Map((skus || []).map((s: any) => [s.id, s.sku_description]))
    bundledAccessories = bundledAccessories.map((b: any) => ({ ...b, accessory_name: nameById.get(b.accessory_id) || null }))
  }

  return NextResponse.json({ ...data, bundled_accessories: bundledAccessories, history: history || [] })
}

// ---------- PATCH: owner edits a sale after the fact ----------
// Anything can be corrected here -- customer, price/GST, payment status/amount,
// payment account, sold-by. This does NOT touch inventory/invoice state; if
// sale_base_price/gst_percentage change, sale_total is recomputed to stay consistent,
// but an already-generated invoice is NOT retroactively changed (matches the
// "the sale already happened" principle from Part 6 -- this is a bookkeeping correction,
// not a new sale).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser) && !canEditPage(sessionUser, 'live_stock') && !canEditPage(sessionUser, 'sales') && !canEditPage(sessionUser, 'stock')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { id } = await params
  const { data: existing } = await supabaseAdmin.from('sales').select('*').eq('id', id).single()
  if (!existing) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })

  const body = await req.json()
  const updates: Record<string, any> = {}

  // A price edit on an already-invoiced sale silently desyncs the printed/sent
  // invoice from the live record (the invoice is a frozen snapshot, never
  // retroactively updated by this route) -- warn and require explicit confirmation.
  const editingPrice = body.sale_base_price !== undefined || body.gst_percentage !== undefined || body.bundled_accessories !== undefined
  if (existing.finalized && editingPrice && !body.confirm_despite_invoice) {
    return NextResponse.json({
      error: `This sale is already invoiced (${existing.invoice_number || existing.invoice_id}) -- changing the price will NOT update that invoice, which will then disagree with the live record. Confirm to proceed anyway.`,
      error_code: 'already_invoiced',
    }, { status: 409 })
  }

  if (body.customer_id !== undefined) {
    updates.customer_id = body.customer_id
    const { data: customer } = await supabaseAdmin.from('customers').select('customer_name').eq('id', body.customer_id).single()
    updates.customer_name = customer?.customer_name || null
  }

  const basePrice = body.sale_base_price ?? existing.sale_base_price
  const gstPct = body.gst_percentage ?? (existing.sale_gst && existing.sale_base_price ? (existing.sale_gst / existing.sale_base_price) * 100 : 18)
  if (body.sale_base_price !== undefined || body.gst_percentage !== undefined) {
    const gstAmount = Math.round(basePrice * gstPct) / 100
    updates.sale_base_price = basePrice
    updates.sale_gst = gstAmount
    updates.sale_total = basePrice + gstAmount
  }

  // payment_status/amount_paid are no longer directly editable here -- they're
  // trigger-derived from the sum of sale_payments (see POST/DELETE
  // /api/sales/[id]/payments). Record an installment or delete an erroneous one
  // there instead of overwriting these fields directly.
  for (const key of ['sale_type', 'payment_account', 'sold_by', 'sale_date', 'notes'] as const) {
    if (body[key] !== undefined) updates[key] = body[key]
  }

  // Bundled-accessory correction: diff old vs new quantities and move real stock for
  // the delta, same movement-type vocabulary as creation (lib/sales-cart.ts, 'sale')
  // and void (lib/sales-entry.ts's reverseSaleInventoryEffects, 'adjustment'). Only
  // meaningful for a unit sale (asset_ledger_id set) -- standalone accessory sales
  // don't have a separate bundle.
  if (body.bundled_accessories !== undefined && existing.asset_ledger_id) {
    const oldList: { accessory_id: string; quantity: number }[] = existing.bundled_accessories || []
    const newList: { accessory_id: string; quantity: number }[] = Array.isArray(body.bundled_accessories)
      ? body.bundled_accessories.map((b: any) => ({ accessory_id: b.accessory_id, quantity: b.quantity }))
      : []
    const oldQty = new Map(oldList.map((b) => [b.accessory_id, b.quantity]))
    const newQty = new Map(newList.map((b) => [b.accessory_id, b.quantity]))
    const allIds = new Set([...oldQty.keys(), ...newQty.keys()])

    const increases: { id: string; delta: number }[] = []
    const decreases: { id: string; delta: number }[] = []
    for (const accId of allIds) {
      const delta = (newQty.get(accId) || 0) - (oldQty.get(accId) || 0)
      if (delta > 0) increases.push({ id: accId, delta })
      else if (delta < 0) decreases.push({ id: accId, delta: -delta })
    }

    if (increases.length > 0) {
      const { data: skus } = await supabaseAdmin
        .from('sku_master')
        .select('id, full_sku_code, quantity_in_stock, status')
        .in('id', increases.map((i) => i.id))
      const skuById = new Map((skus || []).map((s: any) => [s.id, s]))
      for (const inc of increases) {
        const sku = skuById.get(inc.id)
        if (!sku) return NextResponse.json({ error: 'A bundled accessory could not be found.' }, { status: 404 })
        if (sku.status !== 'active') return NextResponse.json({ error: `${sku.full_sku_code} is archived and cannot be bundled.` }, { status: 400 })
        if (sku.quantity_in_stock < inc.delta) return NextResponse.json({ error: `Only ${sku.quantity_in_stock} of ${sku.full_sku_code} in stock.` }, { status: 400 })
      }
    }

    for (const inc of increases) {
      await insertAccessoryMovement({ skuId: inc.id, movementType: 'sale', quantityChange: -inc.delta, notes: 'Sale correction -- bundled accessory added', createdBy: sessionUser.id })
    }
    for (const dec of decreases) {
      await insertAccessoryMovement({ skuId: dec.id, movementType: 'adjustment', quantityChange: dec.delta, notes: 'Sale correction -- bundled accessory removed', createdBy: sessionUser.id })
    }

    updates.bundled_accessories = newList.length > 0 ? newList : null
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin.from('sales').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const fieldCorrectionIds = await logFieldCorrections(
    'sales',
    id,
    Object.keys(updates).map((field) => ({
      field,
      oldValue: field === 'bundled_accessories' ? JSON.stringify(existing[field] || []) : existing[field],
      newValue: field === 'bundled_accessories' ? JSON.stringify(updates[field] || []) : updates[field],
    })),
    sessionUser.id,
    body.reason || null
  )

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'sales',
    tableName: 'sales',
    recordId: id,
    recordLabel: data?.invoice_number || existing.invoice_number || id,
    fieldCorrectionIds,
    reason: body.reason || null,
  })

  return NextResponse.json(data)
}

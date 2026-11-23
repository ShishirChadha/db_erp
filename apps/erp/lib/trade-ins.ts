import { supabaseAdmin } from '@/lib/supabase/service'
import { NON_SERIALIZED_CATEGORIES } from '@/lib/sku-categories'
import { buildIntakeLedgerRow } from '@/lib/stock-intake'
import { logAuditEvent } from '@/lib/audit-log'
import { istToday } from '@/lib/attendance'

// Trade-ins (docs/decisions.md 2026-11-23): a customer hands an old laptop back
// as part-payment on a sale -- the "upgrade" case. Unlike a replacement job:
//   - the old unit's own sale is left alone (it really happened, and was
//     usually GST-filed months ago);
//   - the unit comes back into stock (QC pending) with the trade-in value as
//     the cost of its next life (asset_ledger.trade_in_value -- cost_price
//     keeps meaning "what we paid the vendor", so a PO attached later for the
//     first purchase can't overwrite it);
//   - the value is settled against the new sale as one sale_payments row on
//     the non-cash account 'Trade-in' (bank recon only ever matches entity
//     accounts, so it can never be mistaken for money received).
// A laptop that was never ours becomes a new stock row (from_trade_in), kept
// out of the "needs PO" queue since there is no vendor to raise one with.

export const TRADE_IN_ACCOUNT = 'Trade-in'
export const ID_PROOF_TYPES = ['Aadhaar', 'PAN', 'Driving licence', 'Voter ID', 'Passport', 'Other'] as const
const ENTITIES = ['Digitalbluez', 'Techtenth', 'Cash']
// Where a traded-in unit may be when the trade-in is undone: still in our hands, not sold or out again.
const UNDOABLE_STATUSES = ['qc_pending', 'qc_passed', 'ready_for_sale', 'in_stock', 'received', 'faulty']

export interface TradeInInput {
  sale_id: string
  serial_number: string
  sku_id?: string | null // only for a laptop that was never ours
  value: number
  trade_in_date?: string | null
  condition_notes?: string | null
  accessories_included?: string | null
  id_proof_type?: string | null
  id_proof_last4?: string | null
  notes?: string | null
  confirm_overpayment?: boolean
}

type Actor = { id: string; email?: string | null; role?: string | null }
type Fail = { ok: false; status: number; error: string; error_code?: string }

export type TradeInLookup =
  | {
      kind: 'ours'
      asset: { id: string; sku_id: string; serial_number: string; status: string; qc_status: string | null; description: string | null; trade_in_value: number | null; traded_in_at: string | null }
      previous_sale: { id: string; sale_date: string; customer_id: string | null; customer_name: string | null; sale_total: number; payment_account: string | null } | null
    }
  | { kind: 'new' }
  | { kind: 'blocked'; reason: string }

const round2 = (n: number) => Math.round(n * 100) / 100
const rupees = (n: number) => `₹${round2(n).toLocaleString('en-IN')}`

// What the serial says about the old laptop: one of ours we sold (normal
// upgrade), one we've never had (new stock row), or something that can't be
// traded in (it is already in our stock, rented out, or the serial is ambiguous).
export async function lookupTradeInSerial(serialRaw: string): Promise<TradeInLookup> {
  const serial = serialRaw.trim()
  if (!serial) return { kind: 'blocked', reason: 'Enter the old laptop\'s serial number.' }
  const { data: rows } = await supabaseAdmin
    .from('asset_ledger')
    .select('id, sku_id, current_sku_id, serial_number, status, qc_status, trade_in_value, traded_in_at, is_deleted, sku_master!purchase_order_asset_mapping_sku_id_fkey(sku_description)')
    .ilike('serial_number', serial.replace(/[\\%_]/g, (c) => `\\${c}`))
  const live = (rows || []).filter((r: any) => !r.is_deleted)
  if (!live.length) return { kind: 'new' }
  if (live.length > 1) return { kind: 'blocked', reason: `Serial ${serial} is on ${live.length} stock records -- ask the owner to merge them on the Stock page first.` }
  const a: any = live[0]
  if (a.status !== 'sold') {
    return { kind: 'blocked', reason: `Serial ${serial} is already in the ERP with status "${a.status}", not sold -- it can't be traded in. If it really came back from a customer, check that unit on the Stock page.` }
  }
  const { data: sale } = await supabaseAdmin
    .from('sales')
    .select('id, sale_date, customer_id, customer_name, sale_total, payment_account')
    .eq('asset_ledger_id', a.id)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return {
    kind: 'ours',
    asset: {
      id: a.id, sku_id: a.sku_id, serial_number: a.serial_number, status: a.status, qc_status: a.qc_status,
      description: a.sku_master?.sku_description ?? null,
      trade_in_value: a.trade_in_value == null ? null : Number(a.trade_in_value), traded_in_at: a.traded_in_at,
    },
    previous_sale: sale ? { ...sale, sale_total: Number(sale.sale_total) || 0 } : null,
  }
}

export async function createTradeIn(input: TradeInInput, actor: Actor): Promise<{ ok: true; id: string; trade_in_number: string } | Fail> {
  const value = round2(Number(input.value))
  if (!(value > 0)) return { ok: false, status: 400, error: 'Enter the trade-in value (more than ₹0).' }
  const date = input.trade_in_date || istToday()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, status: 400, error: 'trade_in_date must be YYYY-MM-DD.' }
  const last4 = (input.id_proof_last4 || '').trim().toUpperCase() || null
  if (last4 && !/^[A-Z0-9]{4}$/.test(last4)) return { ok: false, status: 400, error: 'ID proof: give only its last 4 letters/digits.' }
  const idType = (input.id_proof_type || '').trim() || null
  if (idType && !(ID_PROOF_TYPES as readonly string[]).includes(idType)) return { ok: false, status: 400, error: `ID proof type must be one of: ${ID_PROOF_TYPES.join(', ')}.` }
  const serial = (input.serial_number || '').trim()
  if (!serial) return { ok: false, status: 400, error: 'The old laptop\'s serial number is required.' }

  const { data: sale } = await supabaseAdmin
    .from('sales')
    .select('id, customer_id, customer_name, sale_total, amount_paid, payment_account, is_deleted, asset_ledger_id')
    .eq('id', input.sale_id)
    .maybeSingle()
  if (!sale || sale.is_deleted) return { ok: false, status: 404, error: 'Sale not found.' }
  if (!sale.customer_id) return { ok: false, status: 400, error: 'This sale has no customer -- a trade-in needs one (for the buyback slip).' }
  if (!ENTITIES.includes(sale.payment_account || '')) {
    return { ok: false, status: 400, error: 'This sale has no billing entity (Digitalbluez / Techtenth / Cash) -- set it on the sale first; the same entity buys the old laptop back.' }
  }
  const paid = Number(sale.amount_paid) || 0
  const total = Number(sale.sale_total) || 0
  if (!input.confirm_overpayment && paid + value > total + 0.5) {
    return {
      ok: false, status: 409, error_code: 'exceeds_sale_total',
      error: `Already paid ${rupees(paid)} + trade-in ${rupees(value)} = ${rupees(paid + value)}, more than the sale total of ${rupees(total)}. Check the trade-in value (or the sale price); submit again only if the customer really is owed the difference.`,
    }
  }

  const lookup = await lookupTradeInSerial(serial)
  if (lookup.kind === 'blocked') return { ok: false, status: 409, error: lookup.reason }
  if (lookup.kind === 'ours' && lookup.asset.id === sale.asset_ledger_id) {
    return { ok: false, status: 400, error: 'That serial is the laptop being sold on this sale, not the old one.' }
  }

  let skuForNew: { id: string; sku_description: string | null } | null = null
  if (lookup.kind === 'new') {
    if (!input.sku_id) {
      return { ok: false, status: 400, error_code: 'model_required', error: `Serial ${serial} isn't in the ERP (not a laptop we sold), so pick its model from the catalogue.` }
    }
    const { data: sku } = await supabaseAdmin.from('sku_master').select('id, sku_description, category').eq('id', input.sku_id).maybeSingle()
    if (!sku) return { ok: false, status: 404, error: 'Model not found in the catalogue.' }
    if (NON_SERIALIZED_CATEGORIES.includes(sku.category)) return { ok: false, status: 400, error: 'Pick a laptop / desktop / monitor / tablet model, not an accessory.' }
    skuForNew = sku
  }

  const { data: number, error: numErr } = await supabaseAdmin.rpc('generate_trade_in_number')
  if (numErr || !number) return { ok: false, status: 500, error: `Could not number the trade-in: ${numErr?.message || 'no number'}` }
  const tradeInNumber = number as string
  const createdAt = new Date().toISOString()
  const description = lookup.kind === 'ours' ? lookup.asset.description : skuForNew!.sku_description
  const conditionNotes = input.condition_notes?.trim() || null

  // ---- 1. the unit comes in
  let assetId: string
  let skuId: string
  if (lookup.kind === 'ours') {
    const { data: moved, error } = await supabaseAdmin
      .from('asset_ledger')
      .update({ status: 'qc_pending', qc_status: 'pending', trade_in_value: value, traded_in_at: createdAt })
      .eq('id', lookup.asset.id)
      .eq('status', 'sold')
      .select('id')
      .maybeSingle()
    if (error) return { ok: false, status: 500, error: error.message }
    if (!moved) return { ok: false, status: 409, error: 'That unit changed meanwhile (no longer sold) -- reload and try again.' }
    assetId = lookup.asset.id
    skuId = lookup.asset.sku_id
    await supabaseAdmin.from('stock_movements').insert({
      sku_id: skuId, movement_type: 'adjustment', quantity_change: 1,
      notes: `Trade-in ${tradeInNumber} -- serial ${serial} back from customer`, created_by: actor.id,
    })
  } else {
    const row = {
      ...buildIntakeLedgerRow({ serial_number: serial, condition_notes: conditionNotes, purchased_by_type: sale.payment_account, received_date: date } as any, { skuId: skuForNew!.id, enteredBy: actor.id }),
      cost_price: value, trade_in_value: value, traded_in_at: createdAt, from_trade_in: true,
    }
    const { data: inserted, error } = await supabaseAdmin.from('asset_ledger').insert(row).select('id').single()
    if (error || !inserted) return { ok: false, status: 500, error: error?.message || 'Could not add the unit to stock.' }
    assetId = inserted.id
    skuId = skuForNew!.id
    await supabaseAdmin.from('stock_movements').insert({
      sku_id: skuId, movement_type: 'receipt', quantity_change: 1,
      notes: `Trade-in ${tradeInNumber} -- serial ${serial}`, created_by: actor.id,
    })
  }

  const undoUnit = async () => {
    if (lookup.kind === 'ours') {
      await supabaseAdmin.from('asset_ledger').update({
        status: 'sold', qc_status: lookup.asset.qc_status,
        trade_in_value: lookup.asset.trade_in_value, traded_in_at: lookup.asset.traded_in_at,
      }).eq('id', assetId)
    } else {
      await supabaseAdmin.from('asset_ledger').delete().eq('id', assetId)
    }
    await supabaseAdmin.from('stock_movements').insert({
      sku_id: skuId, movement_type: 'adjustment', quantity_change: -1,
      notes: `Trade-in ${tradeInNumber} rolled back -- not saved`, created_by: actor.id,
    })
  }

  // ---- 2. the record
  const { data: tradeIn, error: tiErr } = await supabaseAdmin
    .from('trade_ins')
    .insert({
      trade_in_number: tradeInNumber, trade_in_date: date, customer_id: sale.customer_id, asset_id: assetId,
      was_our_unit: lookup.kind === 'ours',
      previous_sale_id: lookup.kind === 'ours' ? lookup.previous_sale?.id ?? null : null,
      previous_qc_status: lookup.kind === 'ours' ? lookup.asset.qc_status : null,
      sale_id: sale.id, value, payment_account: sale.payment_account,
      condition_notes: conditionNotes, accessories_included: input.accessories_included?.trim() || null,
      id_proof_type: idType, id_proof_last4: last4, notes: input.notes?.trim() || null,
      entered_by: actor.id, created_at: createdAt,
    })
    .select('id')
    .single()
  if (tiErr || !tradeIn) {
    await undoUnit()
    return { ok: false, status: 500, error: `Could not save the trade-in: ${tiErr?.message}. Nothing was changed.` }
  }

  // ---- 3. the value settles part of the new sale
  const { data: payment, error: payErr } = await supabaseAdmin
    .from('sale_payments')
    .insert({
      sale_id: sale.id, amount: value, payment_account: TRADE_IN_ACCOUNT,
      note: `Trade-in ${tradeInNumber}: ${description || 'old unit'} (${serial})`,
      recorded_by: actor.id, recorded_at: `${date}T12:00:00.000Z`,
    })
    .select('id')
    .single()
  if (payErr || !payment) {
    await supabaseAdmin.from('trade_ins').delete().eq('id', tradeIn.id)
    await undoUnit()
    return { ok: false, status: 500, error: `Could not record the trade-in against the sale: ${payErr?.message}. Nothing was changed.` }
  }
  await supabaseAdmin.from('trade_ins').update({ sale_payment_id: payment.id }).eq('id', tradeIn.id)

  await logAuditEvent({
    actor: { id: actor.id, email: actor.email ?? undefined, role: actor.role as any },
    actionType: 'create',
    module: 'sales',
    tableName: 'trade_ins',
    recordId: tradeIn.id,
    recordLabel: `${tradeInNumber} -- ${serial} for ${rupees(value)}`,
    metadata: { sale_id: sale.id, asset_id: assetId, was_our_unit: lookup.kind === 'ours', value, entity: sale.payment_account },
  })

  return { ok: true, id: tradeIn.id, trade_in_number: tradeInNumber }
}

// Owner-only undo: only while the unit is still with us and hasn't been sold
// again -- otherwise its later sale would lose the cost it was sold against.
export async function voidTradeIn(id: string, actor: Actor, reason: string): Promise<{ ok: true } | Fail> {
  const { data: t } = await supabaseAdmin.from('trade_ins').select('*').eq('id', id).maybeSingle()
  if (!t) return { ok: false, status: 404, error: 'Trade-in not found.' }
  if (t.voided_at) return { ok: false, status: 400, error: 'This trade-in was already undone.' }

  const { data: asset } = await supabaseAdmin.from('asset_ledger').select('id, status, sku_id, serial_number').eq('id', t.asset_id).maybeSingle()
  if (!asset) return { ok: false, status: 404, error: 'The traded-in unit is missing.' }
  const { data: laterSales } = await supabaseAdmin
    .from('sales').select('id').eq('asset_ledger_id', asset.id).eq('is_deleted', false).gt('created_at', t.created_at).limit(1)
  if (laterSales?.length) return { ok: false, status: 409, error: `${asset.serial_number} has been sold again since this trade-in -- void that sale first.` }
  if (!UNDOABLE_STATUSES.includes(asset.status)) {
    return { ok: false, status: 409, error: `${asset.serial_number} is now "${asset.status}" -- bring it back into stock before undoing the trade-in.` }
  }

  if (t.sale_payment_id) {
    const { error } = await supabaseAdmin.from('sale_payments').delete().eq('id', t.sale_payment_id)
    if (error) return { ok: false, status: 500, error: `Could not remove the trade-in payment: ${error.message}` }
  }

  if (t.was_our_unit) {
    const { data: prev } = await supabaseAdmin
      .from('trade_ins').select('value, created_at')
      .eq('asset_id', asset.id).is('voided_at', null).lt('created_at', t.created_at)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    await supabaseAdmin.from('asset_ledger').update({
      status: 'sold', qc_status: t.previous_qc_status || 'passed',
      trade_in_value: prev ? prev.value : null, traded_in_at: prev ? prev.created_at : null,
    }).eq('id', asset.id)
  } else {
    await supabaseAdmin.from('asset_ledger').update({ is_deleted: true, deleted_at: new Date().toISOString() }).eq('id', asset.id)
  }
  await supabaseAdmin.from('stock_movements').insert({
    sku_id: asset.sku_id, movement_type: 'adjustment', quantity_change: -1,
    notes: `Trade-in ${t.trade_in_number} undone -- ${reason}`, created_by: actor.id,
  })

  await supabaseAdmin.from('trade_ins').update({ voided_at: new Date().toISOString(), voided_by: actor.id, void_reason: reason }).eq('id', id)
  await logAuditEvent({
    actor: { id: actor.id, email: actor.email ?? undefined, role: actor.role as any },
    actionType: 'void',
    module: 'sales',
    tableName: 'trade_ins',
    recordId: id,
    recordLabel: t.trade_in_number,
    reason,
  })
  return { ok: true }
}

// The 'Trade-in' payment row of an active trade-in, if this payment is one --
// such a row is changed only by undoing the trade-in, never edited directly.
export async function activeTradeInForPayment(paymentId: string) {
  const { data } = await supabaseAdmin.from('trade_ins').select('id, trade_in_number')
    .eq('sale_payment_id', paymentId).is('voided_at', null).maybeSingle()
  return data
}

export async function activeTradeInsForSale(saleId: string) {
  const { data } = await supabaseAdmin.from('trade_ins').select('id, trade_in_number')
    .eq('sale_id', saleId).is('voided_at', null)
  return data || []
}

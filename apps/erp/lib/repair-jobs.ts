import { supabaseAdmin } from './supabase/service'
import { resolveEntityKey } from './invoice-finalize'
import { reverseSaleInventoryEffects } from './sales-entry'
import { CartItemInput, BaseSaleFields, validateCartItems, processSingleSaleItem } from './sales-cart'

export async function generateRepairJobNumber(): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc('generate_repair_job_number')
  if (error) throw error
  return data as string
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// GST applies exactly when the resolved entity is GST-registered (Digitalbluez
// today) -- same resolveEntityKey()/business_profiles.is_gst_registered check used
// for the repair labor charge (finalize/route.ts) and now shared with part sales
// (below) so both compute GST identically instead of duplicating this lookup.
export async function resolveRepairGstPercent(paymentAccount: string | null, requestedGstPercent: number | null): Promise<number> {
  const entityKey = resolveEntityKey(paymentAccount)
  const { data: entity } = await supabaseAdmin.from('business_profiles').select('is_gst_registered').eq('key', entityKey).single()
  return entity?.is_gst_registered ? (requestedGstPercent ?? 18) : 0
}

export type RepairPartInput = { sku_id: string; quantity: number; unit_price: number }

// A part consumed during a repair is functionally a standalone accessory sale --
// same shape (accessory_id/accessory_quantity/sale_base_price) as a normal accessory
// line in the Sell form -- so this reuses the exact same cart machinery
// (lib/sales-cart.ts) that already handles stock validation, the stock_movements
// decrement (via insertAccessoryMovement), GST math, and sales-row creation, rather
// than hand-rolling a second accessory-sale code path. The only addition is
// stamping repair_job_id onto the resulting sale and recording a repair_job_parts
// row linking the part to it, so the part shows up when the job is reopened.
//
// Called both at intake (POST /api/repair-jobs) and later
// (POST /api/repair-jobs/[id]/parts) -- immediately real either way, matching the
// app-wide rule that stock-affecting operational entries are never deferred.
export async function consumeRepairParts(input: {
  jobId: string
  jobNumber: string
  customerId: string
  customerName: string | null
  paymentAccount: string
  gstPercent: number
  saleDate: string
  parts: RepairPartInput[]
  sessionUserId: string
}): Promise<
  | { ok: true; saleIds: string[] }
  | { ok: false; status: number; message: string; itemErrors?: Array<{ index: number; error: string }> }
> {
  const { jobId, jobNumber, customerId, customerName, paymentAccount, gstPercent, saleDate, parts, sessionUserId } = input
  if (parts.length === 0) return { ok: true, saleIds: [] }

  const cartItems: CartItemInput[] = parts.map((p) => ({
    accessory_id: p.sku_id,
    accessory_quantity: p.quantity,
    sale_base_price: p.unit_price,
  }))

  const validation = await validateCartItems(cartItems)
  if (!validation.ok) {
    return { ok: false, status: 400, message: 'One or more parts could not be added.', itemErrors: validation.itemErrors }
  }

  const saleDateObj = new Date(`${saleDate}T12:00:00.000Z`)
  const base: BaseSaleFields = {
    sale_date: saleDate,
    sale_month: MONTHS[saleDateObj.getUTCMonth()],
    sale_year: saleDateObj.getUTCFullYear(),
    customer_id: customerId,
    customer_name: customerName,
    sale_type: gstPercent > 0 ? 'GST' : 'Cash',
    entered_by: sessionUserId,
    sold_by: null,
    payment_account: paymentAccount,
    notes: `Part used in repair job ${jobNumber}`,
    finalized: false,
  }

  const committed: Array<{ id: string; saleRow: any }> = []

  for (let index = 0; index < cartItems.length; index++) {
    const result = await processSingleSaleItem(cartItems[index], base, gstPercent, sessionUserId)
    if (!result.ok) {
      for (const c of committed.reverse()) {
        await reverseSaleInventoryEffects(c.saleRow, {
          reason: `Repair part rollback -- a later part in the same request for job ${jobNumber} could not be added`,
          userId: sessionUserId,
        })
        await supabaseAdmin.from('sales').delete().eq('id', c.id)
        await supabaseAdmin.from('repair_job_parts').delete().eq('sale_id', c.id)
      }
      return { ok: false, status: result.status, message: result.message }
    }
    committed.push({ id: result.saleRow.id, saleRow: result.saleRow })
  }

  const saleIds = committed.map((c) => c.id)
  await supabaseAdmin.from('sales').update({ repair_job_id: jobId }).in('id', saleIds)

  for (let i = 0; i < committed.length; i++) {
    await supabaseAdmin.from('repair_job_parts').insert({
      repair_job_id: jobId,
      sku_id: parts[i].sku_id,
      quantity: parts[i].quantity,
      sale_id: committed[i].id,
    })
  }

  return { ok: true, saleIds }
}

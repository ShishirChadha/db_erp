import { supabaseAdmin } from './supabase/service'
import { resolveEntityKey } from './invoice-finalize'
import { SELLABLE_STATUSES } from './sales-entry'

// Rentals take units out of ordinary sellable stock -- there is no separate rental
// fleet. A unit goes out, comes back through QC, and is sellable again.
//
// The money side deliberately has NO ledger of its own: each billing cycle becomes a
// real `sales` row carrying rental_agreement_id (the fourth discriminator FK,
// alongside asset_ledger_id / accessory_id / repair_job_id). That is what makes
// sale_payments, the sync_sale_payment_totals trigger, createInvoiceFromSales,
// finalize-batch and every report_* RPC work here with no change at all -- exactly
// the precedent repair jobs set with repair_job_id.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export const RENTAL_STATUSES = ['draft', 'active', 'closed', 'cancelled'] as const
export const RENTAL_ITEM_STATUSES = ['on_rent', 'returned', 'bought_out', 'lost_damaged'] as const
export const BILLING_INTERVALS = ['one_time', 'monthly', 'quarterly'] as const
export const PAYMENT_ACCOUNTS = ['Digitalbluez', 'Techtenth', 'Cash'] as const

// Leasing goods is a supply of SERVICE under GST (SAC 997313) at the rate of the
// underlying goods -- 18% for computers.
export const RENTAL_SAC_CODE = '997313'

export async function generateRentalAgreementNumber(): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc('generate_rental_agreement_number')
  if (error) throw error
  return data as string
}

// Identical rule to resolveRepairGstPercent: GST applies exactly when the resolved
// entity is GST-registered, never hardcoded to an account name. Cash/Techtenth rentals
// stay untaxed even if gst_percentage is set on the agreement.
export async function resolveRentalGstPercent(
  paymentAccount: string | null,
  requestedGstPercent: number | null
): Promise<number> {
  const entityKey = resolveEntityKey(paymentAccount)
  const { data: entity } = await supabaseAdmin
    .from('business_profiles')
    .select('is_gst_registered')
    .eq('key', entityKey)
    .single()
  return entity?.is_gst_registered ? (requestedGstPercent ?? 18) : 0
}

export function addInterval(date: string, interval: string): string {
  const d = new Date(`${date}T12:00:00.000Z`)
  if (interval === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1)
  else if (interval === 'quarterly') d.setUTCMonth(d.getUTCMonth() + 3)
  return d.toISOString().slice(0, 10)
}

export function subtractDay(date: string): string {
  const d = new Date(`${date}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// An agreement is overdue when its expected return date has passed and at least one
// unit is still out. Never stored -- derived here and in report_rentals/scan_rental_cycles
// from the same three facts, matching this app's "paperwork completeness is always
// derived" rule.
export function isAgreementOverdue(agreement: {
  status: string
  expected_return_date: string | null
  rental_agreement_items?: Array<{ item_status: string }> | null
}): boolean {
  if (agreement.status !== 'active' || !agreement.expected_return_date) return false
  const stillOut = (agreement.rental_agreement_items || []).some((i) => i.item_status === 'on_rent')
  if (!stillOut) return false
  return agreement.expected_return_date < new Date().toISOString().slice(0, 10)
}

// ---------- Inventory transitions ----------
//
// Handover  : sellable -> on_rent, stock_movements -1
// Return    : on_rent  -> qc_pending, stock_movements +1   (net 0 across the round trip)
// Buyout    : on_rent  -> sold,      NO movement           (net -1, same as a sale)
//
// 'adjustment' is the movement_type on purpose rather than a new enum value: it is
// exactly what sale-void (lib/sales-entry.ts) and customer-return (lib/rma.ts) already
// use for the same "a unit moved without being a receipt or a sale" case.

export async function handOverUnit(
  assetId: string,
  agreementNumber: string,
  userId: string
): Promise<{ error?: string; status?: number; priorStatus?: string; skuId?: string }> {
  const { data: asset } = await supabaseAdmin
    .from('asset_ledger')
    .select('id, status, sku_id, serial_number')
    .eq('id', assetId)
    .single()
  if (!asset) return { error: 'Unit not found.', status: 404 }
  if (!SELLABLE_STATUSES.includes(asset.status)) {
    return { error: `This unit is not available to rent (status: ${asset.status}).`, status: 409 }
  }

  // Atomic claim -- if this affects 0 rows, someone sold or rented the unit between
  // our read and this write. Same guard idiom as lib/sales-cart.ts's lock-to-sold.
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('asset_ledger')
    .update({ status: 'on_rent' })
    .eq('id', assetId)
    .in('status', SELLABLE_STATUSES)
    .select('id')
    .maybeSingle()
  if (claimErr) return { error: claimErr.message, status: 500 }
  if (!claimed) return { error: 'This unit was just taken by someone else -- refresh and retry.', status: 409 }

  const { error: moveErr } = await supabaseAdmin.from('stock_movements').insert({
    sku_id: asset.sku_id,
    movement_type: 'adjustment',
    quantity_change: -1,
    notes: `Out on rent -- ${agreementNumber}`,
    created_by: userId,
  })
  if (moveErr) {
    await supabaseAdmin.from('asset_ledger').update({ status: asset.status }).eq('id', assetId)
    return { error: moveErr.message, status: 500 }
  }

  return { priorStatus: asset.status, skuId: asset.sku_id }
}

export async function returnUnit(
  assetId: string,
  agreementNumber: string,
  userId: string
): Promise<{ error?: string; status?: number }> {
  const { data: asset } = await supabaseAdmin
    .from('asset_ledger')
    .select('id, status, sku_id')
    .eq('id', assetId)
    .single()
  if (!asset) return { error: 'Unit not found.', status: 404 }

  // Straight back into the QC funnel, not to ready_for_sale -- a unit that has been
  // in a customer's hands for months gets re-checked before it is sold or re-rented.
  const { data: reverted, error: revertErr } = await supabaseAdmin
    .from('asset_ledger')
    .update({ status: 'qc_pending', qc_status: 'pending' })
    .eq('id', assetId)
    .eq('status', 'on_rent')
    .select('id')
    .maybeSingle()
  if (revertErr) return { error: revertErr.message, status: 500 }
  if (!reverted) return { error: `This unit is no longer out on rent (status: ${asset.status}).`, status: 409 }

  const { error: moveErr } = await supabaseAdmin.from('stock_movements').insert({
    sku_id: asset.sku_id,
    movement_type: 'adjustment',
    quantity_change: 1,
    notes: `Returned from rent -- ${agreementNumber}`,
    created_by: userId,
  })
  if (moveErr) {
    await supabaseAdmin.from('asset_ledger').update({ status: 'on_rent' }).eq('id', assetId)
    return { error: moveErr.message, status: 500 }
  }

  return {}
}

// ---------- Billing ----------

export interface RentalChargeInput {
  agreement: {
    id: string
    agreement_number: string
    customer_id: string
    rent_amount: number
    gst_percentage: number | null
    payment_account: string | null
  }
  periodStart: string
  periodEnd: string
  amount?: number | null
  saleDate?: string | null
  soldBy?: string | null
  unitCount: number
  userId: string
}

// Creates the `sales` row for one billing cycle. Mirrors the repair-job finalize
// precedent field for field, including the two easy-to-miss parts: sale_month/
// sale_year must be derived (Reports filters read them), and any money already in
// hand goes in as a sale_payments leg -- writing sales.amount_paid/payment_status
// directly is silently undone by the sync_sale_payment_totals trigger.
export async function createRentalCharge(input: RentalChargeInput): Promise<{
  error?: string
  saleId?: string
}> {
  const { agreement, periodStart, periodEnd, unitCount, userId } = input
  const baseAmount = input.amount ?? agreement.rent_amount
  if (!baseAmount || baseAmount <= 0) return { error: 'Rent amount must be greater than zero.' }
  if (!agreement.payment_account) return { error: 'Set a payment account on the agreement before billing.' }

  const saleDate = input.saleDate || new Date().toISOString().slice(0, 10)
  const saleDateObj = new Date(`${saleDate}T12:00:00.000Z`)

  const gstPct = await resolveRentalGstPercent(agreement.payment_account, agreement.gst_percentage)
  const gstAmount = gstPct > 0 ? Math.round(baseAmount * gstPct) / 100 : 0
  const saleTotal = baseAmount + gstAmount

  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('customer_name')
    .eq('id', agreement.customer_id)
    .single()

  const periodLabel = `${fmtDay(periodStart)} to ${fmtDay(periodEnd)}`
  const description =
    `Laptop rental -- ${agreement.agreement_number}, ` +
    `${unitCount} unit${unitCount === 1 ? '' : 's'}, ${periodLabel}`

  const { data: sale, error: saleErr } = await supabaseAdmin
    .from('sales')
    .insert({
      // rental_agreement_id set, asset_ledger_id deliberately NULL: a rent charge is
      // pure revenue with no inventory effect. Setting the asset id here would make
      // the unit read as "sold" on the Sold Stock tabs and would charge its full
      // purchase cost as COGS against one month of rent in v_report_sale_lines.
      rental_agreement_id: agreement.id,
      rental_period_start: periodStart,
      rental_period_end: periodEnd,
      customer_id: agreement.customer_id,
      customer_name: customer?.customer_name || null,
      sale_date: saleDate,
      sale_month: MONTHS[saleDateObj.getUTCMonth()],
      sale_year: saleDateObj.getUTCFullYear(),
      sale_type: gstPct > 0 ? 'GST' : 'Cash',
      sale_base_price: baseAmount,
      sale_gst: gstAmount,
      sale_total: saleTotal,
      payment_account: agreement.payment_account,
      sold_by: input.soldBy || null,
      asset_description: description,
      entered_by: userId,
      finalized: false,
    })
    .select('id')
    .single()

  if (saleErr) return { error: saleErr.message }
  return { saleId: sale.id }
}

function fmtDay(d: string): string {
  const dt = new Date(`${d}T12:00:00.000Z`)
  return `${String(dt.getUTCDate()).padStart(2, '0')} ${MONTHS[dt.getUTCMonth()].slice(0, 3)} ${dt.getUTCFullYear()}`
}

export { fmtDay as formatRentalDay }

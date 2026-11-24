import { supabaseAdmin } from '@/lib/supabase/service'
import { activeTradeInsForSale } from '@/lib/trade-ins'
import { spellBack } from './stock-in'

// DB's side of a customer return: a laptop/desktop we sold comes back and the
// customer does not take another unit. She checks the unit and its sale, works
// out what she must raise, and builds the body POST /api/rma takes
// (direction from_customer) -- the same door the RMA page uses, so the unit
// going to QC pending, the stock +1, the bundled accessories coming back, the
// sale being cancelled and the refund / credit note are all the ERP's own code
// (lib/rma.ts processCustomerReturn), not repeated here.

export const REFUND_ACCOUNTS = ['Digitalbluez', 'Techtenth', 'Cash'] as const

export interface CustomerReturnProposal {
  serial_number: string
  reason: string
  return_date?: string | null
  resolution?: 'refund' | 'credit_note' | null
  amount?: number | null
  refund_account?: (typeof REFUND_ACCOUNTS)[number] | null
  notes?: string | null
}

const money = (n: number) => `₹${Math.round(n * 100) / 100}`
const esc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export type PreparedReturn =
  | { ok: true; body: Record<string, unknown>; title: string; summary: string; warnings: string[]; extra: Record<string, unknown> }
  | { ok: false; result: unknown; isError: boolean }

export async function prepareCustomerReturn(t: CustomerReturnProposal, today: string): Promise<PreparedReturn> {
  const serial = t.serial_number.trim().toUpperCase()
  const reason = t.reason.trim()
  if (!reason) return { ok: false, result: 'Ask Shishir why the customer returned it.', isError: true }
  if (t.return_date && (!/^\d{4}-\d{2}-\d{2}$/.test(t.return_date) || t.return_date > today)) {
    return { ok: false, result: 'The return date must be today or earlier (YYYY-MM-DD).', isError: true }
  }

  const { data: units } = await supabaseAdmin.from('asset_ledger')
    .select('id, serial_number, status, sku_master!purchase_order_asset_mapping_sku_id_fkey(sku_description)')
    .ilike('serial_number', esc(serial)).not('is_deleted', 'is', true).limit(2)
  if (!units?.length) {
    return { ok: false, isError: true, result: `No laptop/desktop with serial ${serial} in the ERP. Ask him to check or type it. (An accessory-only return is done on the RMA page -- offer to open it.)` }
  }
  if (units.length > 1) return { ok: false, result: `Serial ${serial} is on two stock records -- ask Shishir to fix it on the Stock page first.`, isError: true }
  const unit = units[0] as any
  const description = unit.sku_master?.sku_description || 'unit'

  if (unit.status !== 'sold') {
    const why: Record<string, string> = {
      on_rent: 'it is out on rent -- a rental return is done on the Rentals page, not as a customer return',
      qc_pending: 'it is already back with us, waiting for QC',
      ready_for_sale: 'it is in our stock, not sold',
      reserved_web: 'it is held for a website order, not sold',
    }
    return { ok: false, isError: true, result: `${serial} (${description}) can't be returned: ${why[unit.status] || `its status is ${unit.status}, not sold`}. Tell Shishir.` }
  }

  const { data: sale } = await supabaseAdmin.from('sales')
    .select('id, customer_name, sale_date, sale_total, amount_paid, payment_account, finalized, invoice_number, bundled_accessories, sold_by')
    .eq('asset_ledger_id', unit.id).eq('is_deleted', false).order('created_at', { ascending: false }).limit(1).maybeSingle()

  const warnings: string[] = []
  const paid = Number(sale?.amount_paid) || 0
  if (sale) {
    const tradeIns = await activeTradeInsForSale(sale.id)
    if (tradeIns.length) {
      return { ok: false, isError: true, result: `This sale has trade-in ${tradeIns.map((x) => x.trade_in_number).join(', ')} on it (the customer's old laptop was taken as part-payment). Only Shishir can undo that trade-in on the Trade-ins page; the return can be recorded after. Tell him.` }
    }
  } else {
    warnings.push(`No sale is linked to ${serial} in the ERP (an old record from before the ERP?). The unit will still come back to QC, but there is no sale to cancel and no refund can be recorded here.`)
  }

  // Money: a refund or a credit note is required once anything was paid.
  let resolution: Record<string, unknown> | undefined
  let moneyLine = 'Nothing was paid, so nothing goes back.'
  if (sale && paid > 0.5) {
    if (!t.resolution) {
      return {
        ok: false, isError: false,
        result: {
          status: 'refund_or_credit_needed',
          paid_on_sale: paid,
          sale_entity: sale.payment_account,
          instruction: `${money(paid)} was paid on this sale. Ask: refund (how much, and from which account: Digitalbluez, Techtenth or Cash) or store credit (credit note) for the customer? Then propose again.`,
        },
      }
    }
    const amount = t.amount != null ? Number(t.amount) : paid
    if (!(amount > 0) || amount > paid + 0.5) {
      return { ok: false, result: `The amount must be more than ₹0 and at most the ${money(paid)} paid on this sale.`, isError: true }
    }
    if (t.resolution === 'refund' && !t.refund_account) {
      return { ok: false, result: `Ask from which account the refund is paid (Digitalbluez, Techtenth or Cash). The sale was on ${sale.payment_account || 'no entity'}.`, isError: true }
    }
    if (t.resolution === 'refund' && t.refund_account !== sale.payment_account) {
      warnings.push(`Refund from ${t.refund_account}, but the sale was on ${sale.payment_account}.`)
    }
    if (amount < paid - 0.5) {
      warnings.push(`${money(paid - amount)} of the ${money(paid)} paid is kept (not ${t.resolution === 'refund' ? 'refunded' : 'credited'}). The ERP cancels the whole sale, so that ${money(paid - amount)} will not show as a sale anywhere -- record it separately if it should count.`)
    }
    resolution = {
      type: t.resolution, amount,
      ...(t.resolution === 'refund' ? { payment_account: t.refund_account } : {}),
      note: t.notes || null,
    }
    moneyLine = t.resolution === 'refund'
      ? `Refund ${money(amount)} from ${t.refund_account} (paid on the sale: ${money(paid)})`
      : `Store credit (credit note) of ${money(amount)} for the customer (paid on the sale: ${money(paid)})`
  } else if (sale && Number(sale.sale_total) - paid > 0.5) {
    moneyLine = `Nothing was paid on it (${money(Number(sale.sale_total))} was due); the due amount goes away with the sale.`
  }

  if (sale?.finalized) {
    warnings.push(`This sale is already invoiced${sale.invoice_number ? ` (${sale.invoice_number})` : ''}. The return cancels the sale but not the invoice: the invoice needs a credit note or cancellation on the Invoices page${sale.payment_account === 'Digitalbluez' ? ', because it is a GST invoice' : ''}.`)
  }
  const bundled = ((sale?.bundled_accessories as any[]) || []).filter((b) => b?.accessory_id && b?.quantity)
  if (bundled.length) {
    const { data: accs } = await supabaseAdmin.from('sku_master').select('id, sku_description').in('id', bundled.map((b) => b.accessory_id))
    const names = bundled.map((b) => `${b.quantity} x ${accs?.find((a) => a.id === b.accessory_id)?.sku_description || 'accessory'}`)
    warnings.push(`The accessories sold with it go back into stock too (${names.join(', ')}). Check they actually came back.`)
  }

  const saleLine = sale
    ? `Sold ${sale.sale_date} to ${sale.customer_name || 'a customer'} for ${money(Number(sale.sale_total) || 0)} incl GST (${sale.payment_account || 'no entity'}${sale.sold_by ? `, by ${sale.sold_by}` : ''})`
    : 'No linked sale'
  return {
    ok: true,
    title: `Return from ${sale?.customer_name || 'customer'}`,
    body: {
      asset_id: unit.id, direction: 'from_customer', reason,
      notes: t.notes || null,
      ...(t.return_date ? { event_date: t.return_date } : {}),
      ...(resolution ? { resolution } : {}),
    },
    summary: [
      `${description} (serial ${unit.serial_number}) comes back: QC pending, stock +1`,
      `${saleLine} -- this sale gets cancelled`,
      moneyLine,
      `Reason: ${reason}${t.return_date ? ` | Date: ${t.return_date}` : ''}`,
    ].join('\n'),
    warnings,
    extra: {
      unit: { model: description, serial: unit.serial_number, spell_back: spellBack(unit.serial_number) },
      return_instruction: 'Say the serial back character by character (spell_back), the customer and sale date, and the refund or credit amount, then ask for the go-ahead.',
    },
  }
}

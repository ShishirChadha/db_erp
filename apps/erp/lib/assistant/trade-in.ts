import { supabaseAdmin } from '@/lib/supabase/service'
import { NON_SERIALIZED_CATEGORIES } from '@/lib/sku-categories'
import { lookupTradeInSerial, ID_PROOF_TYPES } from '@/lib/trade-ins'
import { spellBack } from './stock-in'

// DB's side of a trade-in (upgrade): check the old laptop's serial, work out
// what she must raise, and build the body POST /api/trade-ins takes. Used both
// inside propose_sale (sale + trade-in on one card) and by propose_trade_in
// (against a sale already saved).

export interface TradeInProposal {
  serial_number: string
  sku_id?: string | null
  value: number
  condition_notes?: string | null
  accessories_included?: string | null
  id_proof_type?: (typeof ID_PROOF_TYPES)[number] | null
  id_proof_last4?: string | null
  trade_in_date?: string | null
  notes?: string | null
}

const money = (n: number) => `₹${Math.round(n * 100) / 100}`

export type PreparedTradeIn =
  | { ok: true; body: Record<string, unknown>; line: string; warnings: string[]; extra: Record<string, unknown> }
  | { ok: false; result: unknown; isError: boolean }

export async function prepareTradeIn(t: TradeInProposal, ctx: { customerId: string; entity: string }): Promise<PreparedTradeIn> {
  const serial = t.serial_number.trim().toUpperCase()
  if (!(t.value > 0)) return { ok: false, result: 'Ask Shishir what value he is giving for the old laptop.', isError: true }
  const last4 = t.id_proof_last4?.trim().toUpperCase() || null
  if (last4 && !/^[A-Z0-9]{4}$/.test(last4)) return { ok: false, result: 'For the ID proof keep only its last 4 letters/digits -- never the full Aadhaar or PAN number.', isError: true }

  const found = await lookupTradeInSerial(serial)
  if (found.kind === 'blocked') return { ok: false, result: `${found.reason} Tell Shishir.`, isError: true }

  const warnings: string[] = []
  let description: string
  let skuId: string
  let history = ''
  if (found.kind === 'ours') {
    description = found.asset.description || 'unit'
    skuId = found.asset.sku_id
    const prev = found.previous_sale
    if (prev) {
      history = `, sold ${prev.sale_date} to ${prev.customer_name || 'a customer'} for ${money(prev.sale_total)} incl GST`
      if (prev.customer_id && prev.customer_id !== ctx.customerId) warnings.push(`${serial} was sold to ${prev.customer_name}, not to this customer -- check it is the right laptop.`)
      if (t.value > prev.sale_total + 0.5) warnings.push(`Trade-in value ${money(t.value)} is MORE than they paid for it (${money(prev.sale_total)} on ${prev.sale_date}).`)
    }
  } else {
    if (!t.sku_id) {
      return {
        ok: false, isError: false,
        result: {
          status: 'model_needed',
          instruction: `Serial ${serial} is not in the ERP, so it is not a laptop we sold. Ask which model it is, find it with find_products (tracked_per_unit: true) and propose again with its sku_id. If the model is not in the catalogue it must be added in SKU Master first; say so.`,
        },
      }
    }
    const { data: sku } = await supabaseAdmin.from('sku_master').select('id, sku_description, category').eq('id', t.sku_id).maybeSingle()
    if (!sku) return { ok: false, result: 'That model was not found -- use find_products.', isError: true }
    if (NON_SERIALIZED_CATEGORIES.includes(sku.category)) return { ok: false, result: 'Pick the laptop/desktop model (tracked_per_unit: true), not an accessory.', isError: true }
    description = sku.sku_description || 'unit'
    skuId = sku.id
    history = ', new to us (not a laptop we sold)'
  }

  // Something to judge the value against: what this model sells for now.
  const { data: sku } = await supabaseAdmin.from('sku_master').select('selling_price_default').eq('id', skuId).maybeSingle()
  const listPrice = sku?.selling_price_default != null ? Number(sku.selling_price_default) : null
  if (listPrice && t.value >= listPrice * 0.9) warnings.push(`Trade-in value ${money(t.value)} is close to what this model sells for (${money(listPrice)} list price) -- little room left when it is resold.`)

  return {
    ok: true,
    body: {
      serial_number: serial, sku_id: found.kind === 'new' ? skuId : undefined, value: t.value,
      condition_notes: t.condition_notes || null, accessories_included: t.accessories_included || null,
      id_proof_type: t.id_proof_type || null, id_proof_last4: last4, trade_in_date: t.trade_in_date || null, notes: t.notes || null,
    },
    line: `Trade-in: ${description} (serial ${serial}${history}) bought back by ${ctx.entity} for ${money(t.value)}${t.accessories_included ? `, with ${t.accessories_included}` : ''}`,
    warnings,
    extra: {
      old_laptop: { model: description, serial, spell_back: spellBack(serial), ours: found.kind === 'ours', list_price_now: listPrice },
      trade_in_instruction: 'Say the old laptop\'s serial back character by character (spell_back) and the trade-in value. Its own old sale stays as it is; the old laptop goes back into stock with the trade-in value as its cost.',
    },
  }
}

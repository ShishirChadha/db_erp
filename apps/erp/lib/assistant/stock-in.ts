// DB's stock-in skill (2026-11-23): the same two doors staff use, nothing new.
//   Laptops / desktops / monitors / tablets -> POST /api/stock-intake, one call
//     per serial number: live at once as qc_pending, no cost / vendor / asset
//     number (the owner attaches a PO later), duplicate serials hard-blocked.
//   Accessories (quantity-tracked) -> POST /api/sku-master/[id]/stock-movement
//     (movement 'receipt'), with the optional vendor / price / GST / date /
//     payment account the Accessories "Receive stock" form takes.
// Serial numbers are the risky part by voice (B/D/P, 0/O, 8/H), so every one is
// spelled back on the card and aloud, and doubtful characters are flagged.
import { supabaseAdmin } from '@/lib/supabase/service'
import { NON_SERIALIZED_CATEGORIES } from '@/lib/sku-categories'
import { TYPE_TO_CATEGORY } from '@/lib/sku-category-map'
import { findDuplicateSerial } from '@/lib/duplicate-serial'
import { findProducts } from './data'

export const STOCK_TYPES = ['Laptop', 'Desktop', 'Monitor', 'Tablet', 'Tiny'] as const
export const BUYERS = ['Digitalbluez', 'Techtenth', 'Cash', 'Other'] as const
export const PAY_ACCOUNTS = ['Digitalbluez', 'Techtenth', 'Cash'] as const

export interface StockInInput {
  sku_id?: string | null
  new_model?: { type: typeof STOCK_TYPES[number]; brand: string; model: string; specs?: Record<string, string> | null } | null
  units: { serial_number: string; condition_notes?: string | null }[]
  purchased_by: typeof BUYERS[number]
  condition_notes?: string | null
  received_date?: string | null
  bundled_accessories?: { accessory_id: string; quantity: number }[] | null
}
export interface AccessoryInInput {
  sku_id: string
  quantity: number
  total_price?: number | null
  gst_percentage?: number | null
  vendor?: string | null
  purchase_date?: string | null
  payment_account?: typeof PAY_ACCOUNTS[number] | null
  notes?: string | null
}

type Prepared = { ok: true; body: any; title: string; summary: string; warnings: string[]; extra?: Record<string, unknown> }
type Problem = { ok: false; result: unknown; isError?: boolean }

const money = (n: number) => `₹${Math.round(n * 100) / 100}`
const normSerial = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '')

// "5CD0O1" -> "5 C D zero letter-O 1": what she reads aloud and shows on the card.
export function spellBack(serial: string) {
  return [...serial].map((c) => (c === '0' ? 'zero' : c === 'O' ? 'letter-O' : c === '1' ? 'one' : c === 'I' ? 'letter-I' : c === '-' ? 'dash' : c)).join(' ')
}
function serialDoubts(serial: string): string[] {
  const out: string[] = []
  if (serial.length < 6) out.push(`${serial} is short for a serial number`)
  if (serial.length > 22) out.push(`${serial} is unusually long for a serial number`)
  if (/O/.test(serial) && /\d/.test(serial)) out.push(`${serial} has a letter O: check it isn't a zero`)
  if (/I/.test(serial) && /\d/.test(serial)) out.push(`${serial} has a letter I: check it isn't a one`)
  if (/[^A-Z0-9-]/.test(serial)) out.push(`${serial} has a character that isn't a letter, number or dash`)
  return out
}

async function templateFields(category: string): Promise<{ name: string; label: string; required?: boolean }[]> {
  const { data } = await supabaseAdmin.from('sku_category_templates').select('field_schema').eq('category', category).maybeSingle()
  let schema: any = data?.field_schema
  if (typeof schema === 'string') { try { schema = JSON.parse(schema) } catch { schema = null } }
  return Array.isArray(schema?.fields) ? schema.fields : []
}

export async function prepareStockIn(input: StockInInput, today: string): Promise<Prepared | Problem> {
  const units = input.units.map((u) => ({ serial_number: normSerial(u.serial_number), condition_notes: u.condition_notes?.trim() || null }))
  const serials = units.map((u) => u.serial_number)
  const repeated = serials.filter((s, i) => serials.indexOf(s) !== i)
  if (repeated.length) return { ok: false, isError: true, result: `The same serial is listed twice: ${[...new Set(repeated)].join(', ')}. Ask him which is right.` }
  const existing: string[] = []
  for (const s of serials) {
    const dup = await findDuplicateSerial(s)
    if (dup) existing.push(`${s} (already ${dup.asset_number || 'an untagged unit'}, ${dup.status})`)
  }
  if (existing.length) {
    return { ok: false, isError: true, result: `These serials are already in the ERP and can't be entered again: ${existing.join('; ')}. Read them back to him -- maybe one was misheard -- and ask for the right serial.` }
  }

  let body: Record<string, unknown>
  let label: string
  const warnings: string[] = []
  if (input.sku_id) {
    const { data: sku } = await supabaseAdmin.from('sku_master').select('id, full_sku_code, sku_description, category, status').eq('id', input.sku_id).maybeSingle()
    if (!sku) return { ok: false, isError: true, result: 'That model is not in the catalogue -- search again with find_products.' }
    if (NON_SERIALIZED_CATEGORIES.includes(sku.category)) {
      return { ok: false, isError: true, result: `${sku.sku_description} is counted by quantity (an accessory), not by serial number -- use propose_accessory_in.` }
    }
    body = { sku_id: sku.id }
    label = `${sku.sku_description} (${sku.full_sku_code})`
  } else if (input.new_model) {
    const m = input.new_model
    const category = TYPE_TO_CATEGORY[m.type] || 'OTHER'
    const specs: Record<string, string> = { ...(m.specs || {}), brand: m.brand.trim(), model: m.model.trim() }
    const missing = (await templateFields(category)).filter((f) => f.required && !String(specs[f.name] ?? '').trim()).map((f) => f.label)
    if (missing.length) {
      return { ok: false, result: { status: 'missing_fields', missing, instruction: `A new ${m.type} model needs: ${missing.join(', ')}. Ask him for these, then call propose_stock_in again.` } }
    }
    const similar = (await findProducts(`${m.brand} ${m.model}`)).filter((p) => p.tracked_per_unit).slice(0, 3)
    if (similar.length) warnings.push(`The catalogue already has similar models: ${similar.map((p) => `${p.description} (${p.code})`).join('; ')}. Use one of them unless this really is a different model.`)
    body = { type: m.type, brand: m.brand.trim(), model: m.model.trim(), specifications: specs }
    label = `NEW model ${m.brand} ${m.model} (${m.type})`
  } else {
    return { ok: false, isError: true, result: 'Find the model first with find_products (or give new_model for one not in the catalogue).' }
  }

  let bundleText = ''
  const bundled = (input.bundled_accessories || []).filter((b) => b.accessory_id && b.quantity > 0)
  if (bundled.length) {
    const { data: accs } = await supabaseAdmin.from('sku_master').select('id, sku_description, full_sku_code, category').in('id', bundled.map((b) => b.accessory_id))
    const byId = new Map((accs || []).map((a) => [a.id, a]))
    const bad = bundled.filter((b) => !byId.get(b.accessory_id) || !NON_SERIALIZED_CATEGORIES.includes(byId.get(b.accessory_id)!.category))
    if (bad.length) return { ok: false, isError: true, result: 'A bundled item is not an accessory in the catalogue -- find it with find_products (tracked_per_unit: false).' }
    bundleText = bundled.map((b) => { const a = byId.get(b.accessory_id)!; return `${String(a.sku_description || '').replace(/\s+/g, ' ').trim()} (${a.full_sku_code}) ×${b.quantity}` }).join(', ')
  }

  for (const s of serials) warnings.push(...serialDoubts(s))
  const date = input.received_date || today
  if (date > today) warnings.push(`The received date ${date} is in the future.`)
  const lines = units.map((u, i) => `${i + 1}. ${u.serial_number}  —  ${spellBack(u.serial_number)}${u.condition_notes ? `  (${u.condition_notes})` : ''}`)
  const summary = [
    `${label} × ${units.length}, bought by ${input.purchased_by}, received ${date}`,
    ...lines,
    ...(input.condition_notes ? [`Condition: ${input.condition_notes}`] : []),
    ...(bundleText ? [`With each unit: ${bundleText}`] : []),
    'Goes into stock as QC pending; no asset number until you attach a PO.',
  ].join('\n')
  return {
    ok: true,
    body: {
      ...body,
      units,
      purchased_by_type: input.purchased_by,
      condition_notes: input.condition_notes?.trim() || null,
      received_date: date,
      ...(bundled.length ? { bundled_accessories: bundled } : {}),
    },
    title: `Stock in: ${units.length} unit${units.length > 1 ? 's' : ''}`,
    summary,
    warnings,
    extra: {
      spell_back: units.map((u) => ({ serial: u.serial_number, say: spellBack(u.serial_number) })),
      instruction: 'Read EVERY serial back to him character by character from spell_back (it says zero / letter-O, one / letter-I), with the model and count, raise each warning, and ask him to check the card and say yes. If any character is wrong, fix it and propose again.',
    },
  }
}

export async function prepareAccessoryIn(input: AccessoryInInput, today: string): Promise<Prepared | Problem> {
  const { data: sku } = await supabaseAdmin.from('sku_master').select('id, full_sku_code, sku_description, category').eq('id', input.sku_id).maybeSingle()
  if (!sku) return { ok: false, isError: true, result: 'That accessory is not in the catalogue -- search again with find_products.' }
  if (!NON_SERIALIZED_CATEGORIES.includes(sku.category)) {
    return { ok: false, isError: true, result: `${sku.sku_description} is tracked by serial number -- use propose_stock_in with each serial.` }
  }
  const warnings: string[] = []
  let vendorId: string | null = null
  let vendorName: string | null = null
  if (input.vendor?.trim()) {
    const words = input.vendor.trim().replace(/[%_\\]/g, '').split(/\s+/).filter(Boolean).slice(0, 4)
    let q = supabaseAdmin.from('vendors').select('id, company_name, supplies_accessories').eq('is_deleted', false).limit(6)
    for (const w of words) q = q.ilike('company_name', `%${w}%`)
    const { data: vendors } = await q
    const list = vendors || []
    if (!list.length) return { ok: false, result: { status: 'vendor_not_found', asked: input.vendor, instruction: 'No vendor by that name. Ask him for the exact name, or save without a vendor.' } }
    const exact = list.find((v) => v.company_name.trim().toLowerCase() === input.vendor!.trim().toLowerCase())
    if (!exact && list.length > 1) return { ok: false, result: { status: 'several_vendors', matches: list.map((v) => v.company_name), instruction: 'Ask which vendor, then call again with the full name.' } }
    const v = exact || list[0]
    vendorId = v.id
    vendorName = v.company_name
  }
  const unit = input.total_price != null ? input.total_price / input.quantity : null
  if (unit != null) {
    const { data: past } = await supabaseAdmin.from('stock_movements').select('unit_price')
      .eq('sku_id', sku.id).eq('movement_type', 'receipt').not('unit_price', 'is', null)
      .order('created_at', { ascending: false }).limit(5)
    const prices = (past || []).map((p) => Number(p.unit_price)).filter((n) => n > 0)
    if (prices.length) {
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length
      if (unit > avg * 1.5 || unit < avg * 0.5) warnings.push(`${money(unit)} each is far from the usual ${money(avg)} each (last ${prices.length} receipts).`)
    }
  }
  const date = input.purchase_date || today
  if (date > today) warnings.push(`The purchase date ${date} is in the future.`)
  const summary = [
    `Receive ${input.quantity} × ${sku.sku_description} (${sku.full_sku_code})`,
    vendorName ? `From ${vendorName}` : 'No vendor',
    input.total_price != null ? `${money(input.total_price)} total (${money(unit!)} each)${input.gst_percentage != null ? `, GST ${input.gst_percentage}%` : ''}` : 'No price',
    `Purchased ${date}${input.payment_account ? `, paid from ${input.payment_account}` : ''}`,
    ...(input.notes ? [`Note: ${input.notes}`] : []),
  ].join('\n')
  return {
    ok: true,
    body: {
      sku_id: sku.id,
      movement_type: 'receipt',
      quantity_change: input.quantity,
      notes: input.notes?.trim() || 'Stock received (via DB)',
      vendor_id: vendorId || undefined,
      unit_price: unit ?? undefined,
      gst_percentage: input.gst_percentage ?? undefined,
      purchase_date: date,
      payment_account: input.payment_account || undefined,
    },
    title: `Receive ${input.quantity} × ${sku.sku_description}`,
    summary,
    warnings,
  }
}

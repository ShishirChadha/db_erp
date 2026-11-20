import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/service'
import { logAuditEvent } from '@/lib/audit-log'
import { istToday } from '@/lib/attendance'
import { checkDuplicateCustomer } from '@/lib/customer-dedupe'
import { getOwnerOnlyExpenseTypes, isOwnerOnlyType } from '@/lib/owner-only-expense-types'
import { NON_SERIALIZED_CATEGORIES } from '@/lib/sku-categories'
import { callRouteAsDb, type RouteKey } from './call-route'
import { getDbAccessToken, DB_DISPLAY_NAME } from './identity'
import {
  findCustomers, findProducts, findSellableUnits, findUnitBySerial, priceContext, priceChecks,
  getOptions, recallNotes, recentDocumentsFor, expenseChecks,
} from './data'
import { shareSalesDocument } from './share'

// DB's tools. Reads run straight away. Writes never do: a propose_* tool
// checks the input, works out the warnings DB must raise, and parks the write
// as the thread's pending action. confirm_pending_action runs it only in a
// LATER turn than the one that proposed it -- so the model can never propose
// and save in the same breath; the owner has to have said yes (or tapped
// Confirm) in between.

export interface PendingAction {
  id: string
  kind: RouteKey | 'customer' | 'note'
  body: any
  summary: string
  warnings: string[]
  created_turn: number
}

export interface ToolContext {
  ownerId: string
  ownerEmail: string | undefined
  turn: number
  pending: PendingAction | null
  db: { profileId: string; sessionId: string }
}

export interface ToolOutcome {
  result: unknown
  isError?: boolean
  pending?: PendingAction | null // undefined = unchanged, null = cleared
  card?: AssistantCard
}

// What the panel shows next to DB's words.
export type AssistantCard =
  | { type: 'confirm'; action_id: string; title: string; summary: string; warnings: string[] }
  | { type: 'done'; title: string; detail: string; link?: string | null }
  | { type: 'share'; title: string; pdf_url: string; whatsapp_to_customer: string | null; whatsapp_pick_chat: string }

const money = (n: number) => `₹${Math.round(n * 100) / 100}`
const exclusive = (price: number, gst: number) => Math.round((price / (1 + gst / 100)) * 100) / 100

// ---------------------------------------------------------------- schemas

const S = {
  find_customer: z.object({ query: z.string().describe('Name, part of a name, or phone number.') }),
  find_products: z.object({ query: z.string().describe('Model words as spoken, e.g. "elitebook 840 g6 8 256", "bag", "mouse".') }),
  find_sellable_units: z.object({ sku_id: z.string() }),
  find_unit_by_serial: z.object({ serial_number: z.string() }),
  price_context: z.object({ sku_id: z.string(), customer_id: z.string().nullish() }),
  get_options: z.object({}),
  find_recent_documents: z.object({ customer_id: z.string() }),
  recall_notes: z.object({ customer_id: z.string().nullish().describe('Omit for general notes.') }),
  propose_customer: z.object({
    customer_name: z.string(),
    type: z.enum(['Business', 'Individual']),
    phone: z.string().describe('10-digit mobile.'),
    email: z.string().nullish(),
    gst_number: z.string().nullish(),
    city: z.string().nullish(),
  }),
  propose_sales_document: z.object({
    doc_type: z.enum(['proforma', 'quotation']).describe('PI = proforma.'),
    customer_id: z.string(),
    entity_key: z.string().describe('From get_options().entities, e.g. "digitalbluez" (GST) or "techtenth".'),
    lines: z.array(z.object({
      sku_id: z.string().nullish().describe('From find_products. Omit only for a custom line.'),
      description: z.string().nullish().describe('Only for a custom line.'),
      hsn_code: z.string().nullish().describe('Only for a custom line on a GST entity.'),
      quantity: z.number().int().positive(),
      price: z.number().min(0).describe('Per unit, as the owner said it. 0 for a free item.'),
      price_includes_gst: z.boolean().describe('True if the owner\'s price already includes GST.'),
      gst_rate: z.number().min(0).max(28).nullish().describe('Default 18.'),
    })).min(1),
    valid_until: z.string().nullish().describe('YYYY-MM-DD.'),
    notes: z.string().nullish(),
  }),
  propose_expense: z.object({
    description: z.string(),
    amount: z.number().positive(),
    type: z.string().nullish().describe('One of get_options().expense_types.'),
    payment_account: z.enum(['Digitalbluez', 'Techtenth', 'Cash']),
    expense_date: z.string().nullish().describe('YYYY-MM-DD, default today.'),
    paid_by_staff: z.string().nullish().describe('Staff name if a staff member paid from their own pocket.'),
    remarks: z.string().nullish(),
    gst_percentage: z.number().nullish().describe('Only if the bill has GST.'),
  }),
  propose_sale: z.object({
    customer_id: z.string(),
    sale_type: z.enum(['GST', 'Cash']).describe('GST when billed from Digitalbluez.'),
    payment_account: z.enum(['Digitalbluez', 'Techtenth', 'Cash']).describe('The billing entity.'),
    gst_percentage: z.number().nullish().describe('Default 18.'),
    items: z.array(z.object({
      asset_ledger_id: z.string().nullish().describe('A specific unit, from find_sellable_units / find_unit_by_serial.'),
      accessory_sku_id: z.string().nullish().describe('For a stand-alone accessory sold by quantity.'),
      quantity: z.number().int().positive().nullish(),
      price: z.number().min(0),
      price_includes_gst: z.boolean(),
      free_accessories: z.array(z.object({ sku_id: z.string(), quantity: z.number().int().positive() })).nullish()
        .describe('Accessories bundled free with this unit (bag, mouse).'),
    })).min(1),
    payments: z.array(z.object({ amount: z.number().positive(), payment_account: z.enum(['Digitalbluez', 'Techtenth', 'Cash']) }))
      .describe('Money received now. Empty if nothing paid yet.'),
    sold_by: z.string().describe('One of get_options().staff_names.'),
    sale_date: z.string().nullish(),
    notes: z.string().nullish(),
  }),
  propose_repair_job: z.object({
    customer_id: z.string().nullish(),
    is_own_stock: z.boolean(),
    asset_id: z.string().nullish().describe('Our unit, if own stock.'),
    customer_device_description: z.string().nullish().describe('If the customer\'s own device, e.g. "Dell Latitude 5410".'),
    customer_device_serial: z.string().nullish(),
    problem_description: z.string(),
    amount_charged: z.number().min(0).nullish().describe('Before GST.'),
    payment_account: z.enum(['Digitalbluez', 'Techtenth', 'Cash']).nullish(),
    gst_percentage: z.number().nullish(),
    job_date: z.string().nullish(),
  }),
  propose_replacement_job: z.object({
    customer_id: z.string(),
    is_own_stock: z.boolean(),
    asset_id: z.string().nullish().describe('The returned unit, if it was ours.'),
    customer_device_description: z.string().nullish(),
    customer_device_serial: z.string().nullish(),
    replacement_asset_id: z.string().describe('The unit going out, from find_sellable_units.'),
    problem_description: z.string(),
    amount_charged: z.number().min(0).nullish(),
    additional_amount_paid: z.number().min(0).nullish(),
    payment_account: z.enum(['Digitalbluez', 'Techtenth', 'Cash']).nullish(),
    sale_type: z.enum(['GST', 'Cash']).nullish(),
    gst_percentage: z.number().nullish(),
    sold_by: z.string().nullish(),
    job_date: z.string().nullish(),
  }),
  propose_note: z.object({
    customer_id: z.string().nullish().describe('Omit for a general note.'),
    note: z.string(),
  }),
  confirm_pending_action: z.object({ action_id: z.string() }),
  cancel_pending_action: z.object({ action_id: z.string() }),
  share_document_on_whatsapp: z.object({ document_id: z.string() }),
} as const

type ToolName = keyof typeof S

const DESCRIPTIONS: Record<ToolName, string> = {
  find_customer: 'Find existing customers by name or phone. Returns notes you were asked to remember about each.',
  find_products: 'Search the SKU catalogue (laptops, desktops, accessories). Returns stock on hand and list price.',
  find_sellable_units: 'List the individual units of a SKU that can be sold now (serial numbers, cost).',
  find_unit_by_serial: 'Look up one unit by its serial number.',
  price_context: 'Price history for a SKU: what this customer was quoted/charged before, recent sale prices, list price, cost. Call this BEFORE suggesting or accepting a price.',
  get_options: 'Staff names, expense types, payment accounts and billing entities.',
  find_recent_documents: 'The customer\'s latest PIs and quotations (number, date, total), newest first.',
  recall_notes: 'Notes the owner asked you to remember (general, or about one customer).',
  propose_customer: 'Prepare a new customer record. Shows the owner a confirmation card; nothing is saved yet.',
  propose_sales_document: 'Prepare a proforma invoice (PI) or quotation. Returns warnings you must raise. Nothing is saved yet.',
  propose_expense: 'Prepare an expense entry. Returns warnings you must raise. Nothing is saved yet.',
  propose_sale: 'Prepare a sale (moves stock when confirmed). Returns warnings you must raise. Nothing is saved yet.',
  propose_repair_job: 'Prepare a repair job. Nothing is saved yet.',
  propose_replacement_job: 'Prepare a replacement job (a unit goes out to the customer). Nothing is saved yet.',
  propose_note: 'Offer to remember a preference. Saved only after the owner agrees.',
  confirm_pending_action: 'Save the pending action. ONLY after the owner clearly said yes to it in their latest message.',
  cancel_pending_action: 'Drop the pending action when the owner says no or wants to start over.',
  share_document_on_whatsapp: 'For a saved PI/quotation: make a PDF link and a ready-to-send WhatsApp message to the customer.',
}

export const ASSISTANT_TOOLS: Anthropic.Beta.BetaTool[] = (Object.keys(S) as ToolName[]).map((name) => ({
  name,
  description: DESCRIPTIONS[name],
  input_schema: z.toJSONSchema(S[name], { target: 'draft-7' }) as Anthropic.Beta.BetaTool.InputSchema,
}))

// ---------------------------------------------------------------- executor

export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  if (!(name in S)) return { result: `Unknown tool ${name}`, isError: true }
  const parsed = S[name as ToolName].safeParse(rawInput)
  if (!parsed.success) return { result: `Invalid input: ${parsed.error.message}`, isError: true }
  const input: any = parsed.data
  try {
    switch (name as ToolName) {
      case 'find_customer': return { result: await findCustomers(input.query) }
      case 'find_products': return { result: await findProducts(input.query) }
      case 'find_sellable_units': return { result: await findSellableUnits(input.sku_id) }
      case 'find_unit_by_serial': return { result: await findUnitBySerial(input.serial_number) }
      case 'price_context': return { result: await priceContext(input.sku_id, input.customer_id) }
      case 'get_options': return { result: await getOptions() }
      case 'find_recent_documents': {
        const { data } = await supabaseAdmin.from('sales_documents')
          .select('id, doc_type, document_number, document_date, grand_total, status')
          .eq('customer_id', input.customer_id).not('is_deleted', 'is', true)
          .order('document_date', { ascending: false }).order('created_at', { ascending: false }).limit(5)
        return { result: data || [] }
      }
      case 'recall_notes': return { result: await recallNotes(input.customer_id) }
      case 'propose_customer': return proposeCustomer(input, ctx)
      case 'propose_sales_document': return proposeSalesDocument(input, ctx)
      case 'propose_expense': return proposeExpense(input, ctx)
      case 'propose_sale': return proposeSale(input, ctx)
      case 'propose_repair_job': return proposeRepair(input, ctx)
      case 'propose_replacement_job': return proposeReplacement(input, ctx)
      case 'propose_note': return proposeNote(input, ctx)
      case 'confirm_pending_action': return confirmPending(input.action_id, ctx)
      case 'cancel_pending_action':
        return ctx.pending?.id === input.action_id
          ? { result: 'Cancelled. Nothing was saved.', pending: null }
          : { result: 'There is no such pending action.', isError: true }
      case 'share_document_on_whatsapp': {
        const share = await shareSalesDocument(input.document_id)
        return {
          result: { ...share, note: share.customer_has_phone ? 'Ready. The owner taps the button to send.' : 'Customer has no mobile number on file -- the owner can pick the chat.' },
          card: { type: 'share', title: `Send ${share.document_number} on WhatsApp`, pdf_url: share.pdf_url, whatsapp_to_customer: share.whatsapp_to_customer, whatsapp_pick_chat: share.whatsapp_pick_chat },
        }
      }
    }
  } catch (err) {
    return { result: `Failed: ${err instanceof Error ? err.message : String(err)}`, isError: true }
  }
  return { result: 'Unhandled tool', isError: true }
}

function park(kind: PendingAction['kind'], body: any, title: string, summary: string, warnings: string[], ctx: ToolContext): ToolOutcome {
  const pending: PendingAction = { id: randomUUID(), kind, body, summary, warnings, created_turn: ctx.turn }
  return {
    pending,
    card: { type: 'confirm', action_id: pending.id, title, summary, warnings },
    result: {
      action_id: pending.id,
      status: 'waiting_for_owner_yes',
      summary,
      warnings,
      instruction: warnings.length
        ? 'Raise each warning with the owner in your own words, then ask for a yes before confirming.'
        : 'Read the summary back briefly and ask for a yes.',
    },
  }
}

async function getCustomer(id: string) {
  const { data } = await supabaseAdmin.from('customers').select('id, customer_name, type, phone, gst_number').eq('id', id).maybeSingle()
  if (!data) throw new Error('Customer not found -- use find_customer first.')
  return data
}

async function proposeCustomer(input: z.infer<typeof S.propose_customer>, ctx: ToolContext): Promise<ToolOutcome> {
  const phone = input.phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '')
  if (phone.length !== 10) return { result: 'Need a 10-digit mobile number.', isError: true }
  const dup = await checkDuplicateCustomer(supabaseAdmin, { customer_name: input.customer_name, phone })
  if (dup.blockingMatch) return { result: `A customer with this mobile already exists: "${dup.blockingMatch.customer_name}" (id ${dup.blockingMatch.id}). Use that one.`, isError: true }
  const gst = input.gst_number?.trim().toUpperCase() || ''
  const warnings = dup.nameWarningMatch ? [`A customer named "${dup.nameWarningMatch.customer_name}" already exists with a different number.`] : []
  const body = {
    customer_name: input.customer_name.trim(), type: input.type, phone, email: input.email?.trim() || '',
    gst_number: gst, has_gst: !!gst, gst_treatment: gst ? 'registered_regular' : input.type === 'Business' ? 'unregistered_business' : 'consumer',
    state_code: gst ? gst.slice(0, 2) : null, city: input.city?.trim() || null,
  }
  return park('customer', body, `New customer: ${body.customer_name}`,
    `${body.customer_name} (${body.type}), ${phone}${gst ? `, GSTIN ${gst}` : ''}${body.city ? `, ${body.city}` : ''}`, warnings, ctx)
}

async function proposeSalesDocument(input: z.infer<typeof S.propose_sales_document>, ctx: ToolContext): Promise<ToolOutcome> {
  const customer = await getCustomer(input.customer_id)
  const { data: entity } = await supabaseAdmin.from('business_profiles').select('key, is_gst_registered').eq('key', input.entity_key).maybeSingle()
  if (!entity) return { result: `Unknown entity "${input.entity_key}" -- see get_options().entities.`, isError: true }

  const warnings: string[] = []
  const items: any[] = []
  const summaryLines: string[] = []
  const skuIds = input.lines.map((l) => l.sku_id).filter(Boolean) as string[]
  const { data: skus } = skuIds.length
    ? await supabaseAdmin.from('sku_master').select('id, sku_description, full_sku_code, hsn_code, category, quantity_in_stock').in('id', skuIds)
    : { data: [] as any[] }

  for (const line of input.lines) {
    const gstRate = line.gst_rate ?? 18
    const rate = entity.is_gst_registered && line.price_includes_gst ? exclusive(line.price, gstRate) : line.price
    if (line.sku_id) {
      const sku = (skus || []).find((s) => s.id === line.sku_id)
      if (!sku) return { result: `SKU ${line.sku_id} not found -- use find_products.`, isError: true }
      if (entity.is_gst_registered && !sku.hsn_code) return { result: `${sku.sku_description} has no HSN code in SKU Master; a GST PI needs one. Ask the owner for the HSN.`, isError: true }
      items.push({ item_type: 'sku', sku_id: sku.id, description: sku.sku_description || sku.full_sku_code, hsn_code: sku.hsn_code, quantity: line.quantity, rate, gst_rate: gstRate })
      summaryLines.push(`${line.quantity} × ${sku.sku_description} @ ${rate === 0 ? 'FREE' : `${money(rate)}${entity.is_gst_registered ? ' + GST' : ''}`}`)
      if (rate > 0) warnings.push(...await priceChecks(sku.id, customer.id, rate))
      if (!NON_SERIALIZED_CATEGORIES.includes(sku.category)) {
        const units = await findSellableUnits(sku.id)
        if (units.length < line.quantity) warnings.push(`Only ${units.length} sellable unit(s) of ${sku.sku_description} in stock right now.`)
      } else if ((Number(sku.quantity_in_stock) || 0) < line.quantity) {
        warnings.push(`Only ${Number(sku.quantity_in_stock) || 0} of ${sku.sku_description} in stock.`)
      }
    } else {
      if (!line.description) return { result: 'A custom line needs a description.', isError: true }
      if (entity.is_gst_registered && !line.hsn_code) return { result: `Custom line "${line.description}" needs an HSN code for a GST PI.`, isError: true }
      items.push({ item_type: 'custom', description: line.description, hsn_code: line.hsn_code || null, quantity: line.quantity, rate, gst_rate: gstRate })
      summaryLines.push(`${line.quantity} × ${line.description} @ ${money(rate)}`)
    }
  }

  const recent = await recentDocumentsFor(customer.id, skuIds)
  if (recent.length) warnings.push(`${customer.customer_name} already has ${recent.map((r) => `${r.number} (${r.date}, ${money(r.rate)})`).join(', ')} for this item in the last week.`)
  if (customer.type === 'Business' && entity.is_gst_registered && !customer.gst_number) warnings.push(`${customer.customer_name} has no GSTIN on file, so they can't claim input credit.`)

  const subtotal = items.reduce((s, i) => s + i.quantity * i.rate, 0)
  const gst = entity.is_gst_registered ? items.reduce((s, i) => s + i.quantity * i.rate * i.gst_rate / 100, 0) : 0
  const label = input.doc_type === 'proforma' ? 'PI' : 'Quotation'
  const body = {
    doc_type: input.doc_type, entity_key: entity.key, customer_id: customer.id, items,
    valid_until: input.valid_until || null, notes: input.notes || null,
  }
  return park('sales_document', body, `${label} for ${customer.customer_name} (${entity.key})`,
    `${summaryLines.join('\n')}\nTotal ${money(subtotal + gst)}${gst ? ` (incl. GST ${money(gst)})` : ''}`, warnings, ctx)
}

async function proposeExpense(input: z.infer<typeof S.propose_expense>, ctx: ToolContext): Promise<ToolOutcome> {
  if (isOwnerOnlyType(input.type, await getOwnerOnlyExpenseTypes())) {
    return { result: `"${input.type}" is an owner-only expense type, so ${DB_DISPLAY_NAME} cannot record it. Ask the owner to enter it in Expenses themselves.`, isError: true }
  }
  const date = input.expense_date || istToday()
  const warnings = await expenseChecks(input.type ?? null, input.amount, date)
  const body = {
    expense_date: date, description: input.description, type: input.type || null, amount: input.amount,
    payment_account: input.payment_account, paid_by_staff: input.paid_by_staff || null, remarks: input.remarks || null,
    gst_percentage: input.gst_percentage ?? null,
  }
  return park('expense', body, `Expense ${money(input.amount)}`,
    `${input.description}${input.type ? ` (${input.type})` : ''}, ${money(input.amount)} from ${input.payment_account}, ${date}${input.paid_by_staff ? `, paid by ${input.paid_by_staff}` : ''}`,
    warnings, ctx)
}

async function proposeSale(input: z.infer<typeof S.propose_sale>, ctx: ToolContext): Promise<ToolOutcome> {
  const customer = await getCustomer(input.customer_id)
  const gstPct = input.sale_type === 'GST' ? input.gst_percentage ?? 18 : 0
  const warnings: string[] = []
  const items: any[] = []
  const summary: string[] = []
  let total = 0

  for (const it of input.items) {
    const base = input.sale_type === 'GST' && it.price_includes_gst ? exclusive(it.price, gstPct) : it.price
    const bundled = (it.free_accessories || []).map((a) => ({ accessory_id: a.sku_id, quantity: a.quantity, unit_price: 0 }))
    if (it.asset_ledger_id) {
      const { data: unit } = await supabaseAdmin.from('asset_ledger')
        .select('id, serial_number, status, sku_id, current_sku_id')
        .eq('id', it.asset_ledger_id).maybeSingle()
      if (!unit) return { result: 'Unit not found -- use find_unit_by_serial or find_sellable_units.', isError: true }
      const { data: unitSku } = await supabaseAdmin.from('sku_master').select('sku_description').eq('id', unit.current_sku_id || unit.sku_id).maybeSingle()
      const desc = unitSku?.sku_description || 'unit'
      items.push({ asset_ledger_id: unit.id, sale_base_price: base, bundled_accessories: bundled })
      summary.push(`${desc}, serial ${unit.serial_number} @ ${money(base)}${gstPct ? ' + GST' : ''}${bundled.length ? ` + ${bundled.length} free accessory` : ''}`)
      if (base > 0) warnings.push(...await priceChecks(unit.current_sku_id || unit.sku_id, customer.id, base))
    } else if (it.accessory_sku_id) {
      const qty = it.quantity ?? 1
      const { data: sku } = await supabaseAdmin.from('sku_master').select('id, sku_description').eq('id', it.accessory_sku_id).maybeSingle()
      if (!sku) return { result: 'Accessory SKU not found.', isError: true }
      items.push({ accessory_id: sku.id, accessory_quantity: qty, sale_base_price: base })
      summary.push(`${qty} × ${sku.sku_description} @ ${money(base)}`)
    } else {
      return { result: 'Each item needs asset_ledger_id (a unit) or accessory_sku_id.', isError: true }
    }
    total += base * (1 + gstPct / 100) * (it.accessory_sku_id ? it.quantity ?? 1 : 1)
  }

  const paid = input.payments.reduce((s, p) => s + p.amount, 0)
  if (paid + 0.5 < total) warnings.push(`Only ${money(paid)} of ${money(total)} received -- ${money(total - paid)} will show as balance due.`)
  if (paid > total + 0.5) warnings.push(`Payments (${money(paid)}) are more than the total (${money(total)}).`)

  const body = {
    customer_id: customer.id, sale_type: input.sale_type, gst_percentage: gstPct, payment_account: input.payment_account,
    sold_by: input.sold_by, sale_date: input.sale_date || istToday(), notes: input.notes || null, items,
    payment_legs: input.payments,
  }
  return park('sale', body, `Sale to ${customer.customer_name}`,
    `${summary.join('\n')}\n${input.sale_type} sale via ${input.payment_account}, total ${money(total)}, received ${money(paid)}, sold by ${input.sold_by}`,
    warnings, ctx)
}

async function proposeRepair(input: z.infer<typeof S.propose_repair_job>, ctx: ToolContext): Promise<ToolOutcome> {
  const customer = input.customer_id ? await getCustomer(input.customer_id) : null
  const warnings: string[] = []
  if (customer && input.customer_device_serial) {
    const { data: prior } = await supabaseAdmin.from('repair_jobs').select('job_number, job_date')
      .eq('customer_id', customer.id).ilike('customer_device_serial', input.customer_device_serial).limit(3)
    if (prior?.length) warnings.push(`This device already came in before: ${prior.map((p) => `${p.job_number} (${p.job_date})`).join(', ')}.`)
  }
  const body = { ...input, job_date: input.job_date || istToday() }
  return park('repair_job', body, `Repair job${customer ? ` for ${customer.customer_name}` : ''}`,
    `${input.is_own_stock ? 'Our unit' : input.customer_device_description || 'Customer device'}${input.customer_device_serial ? ` (${input.customer_device_serial})` : ''}: ${input.problem_description}${input.amount_charged != null ? `, charge ${money(input.amount_charged)}` : ''}`,
    warnings, ctx)
}

async function proposeReplacement(input: z.infer<typeof S.propose_replacement_job>, ctx: ToolContext): Promise<ToolOutcome> {
  const customer = await getCustomer(input.customer_id)
  const { data: unit } = await supabaseAdmin.from('asset_ledger').select('serial_number, status').eq('id', input.replacement_asset_id).maybeSingle()
  if (!unit) return { result: 'Replacement unit not found.', isError: true }
  const body = { ...input, job_date: input.job_date || istToday() }
  return park('replacement_job', body, `Replacement for ${customer.customer_name}`,
    `Returned: ${input.is_own_stock ? 'our unit' : input.customer_device_description || 'customer device'}. Going out: serial ${unit.serial_number}. Reason: ${input.problem_description}`,
    [], ctx)
}

async function proposeNote(input: z.infer<typeof S.propose_note>, ctx: ToolContext): Promise<ToolOutcome> {
  const who = input.customer_id ? (await getCustomer(input.customer_id)).customer_name : 'general'
  return park('note', { customer_id: input.customer_id || null, note: input.note }, `Remember (${who})`, input.note, [], ctx)
}

async function confirmPending(actionId: string, ctx: ToolContext): Promise<ToolOutcome> {
  const p = ctx.pending
  if (!p || p.id !== actionId) return { result: 'There is no such pending action -- propose it again.', isError: true }
  if (p.created_turn >= ctx.turn) {
    return { result: 'You proposed this in this same turn. Wait for the owner to say yes in their next message.', isError: true }
  }

  if (p.kind === 'note') {
    const { error } = await supabaseAdmin.from('assistant_notes').insert({
      subject_type: p.body.customer_id ? 'customer' : 'general', subject_id: p.body.customer_id, note: p.body.note, created_by: ctx.ownerId,
    })
    if (error) return { result: error.message, isError: true }
    return { result: 'Noted. I will remember that.', pending: null, card: { type: 'done', title: 'Remembered', detail: p.body.note } }
  }

  if (p.kind === 'customer') {
    const { data, error } = await supabaseAdmin.from('customers').insert([{ ...p.body, communication_channels: ['whatsapp'] }]).select('id, customer_name').single()
    if (error) return { result: error.code === '23505' ? 'A customer with this mobile already exists.' : error.message, isError: true }
    await logAuditEvent({
      actor: { id: ctx.db.profileId, email: `${DB_DISPLAY_NAME} (assistant)`, role: 'manager' },
      actionType: 'create', module: 'customers', tableName: 'customers', recordId: data.id, recordLabel: data.customer_name,
      metadata: { via: 'assistant', requested_by: ctx.ownerEmail },
    })
    return { result: { saved: true, customer_id: data.id }, pending: null, card: { type: 'done', title: 'Customer added', detail: data.customer_name } }
  }

  const token = await getDbAccessToken(ctx.db.profileId)
  const res = await callRouteAsDb(p.kind, p.body, { token, sessionId: ctx.db.sessionId })
  if (!res.ok) {
    return { result: `The ERP refused it (${res.status}): ${res.data?.error || 'unknown error'}. Nothing was saved. Tell the owner plainly and ask how to fix it.`, isError: true }
  }
  const d = res.data || {}
  const titles: Record<RouteKey, string> = {
    sales_document: `${d.doc_type === 'quotation' ? 'Quotation' : 'PI'} ${d.document_number || ''} created`,
    expense: 'Expense recorded',
    sale: 'Sale recorded',
    repair_job: `Repair job ${d.job_number || ''} opened`,
    replacement_job: `Replacement ${d.job_number || ''} recorded`,
  }
  return {
    result: { saved: true, ...pickIds(d), next: p.kind === 'sales_document' ? 'Offer to share it on WhatsApp (share_document_on_whatsapp).' : undefined },
    pending: null,
    card: { type: 'done', title: titles[p.kind as RouteKey], detail: p.summary },
  }
}

function pickIds(d: any) {
  const out: Record<string, unknown> = {}
  for (const k of ['id', 'document_number', 'job_number', 'sale_ids', 'grand_total', 'parts_warning']) if (d[k] != null) out[k] = d[k]
  return out
}

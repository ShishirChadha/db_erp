import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/service'
import { logAuditEvent } from '@/lib/audit-log'
import { istToday } from '@/lib/attendance'
import { checkDuplicateCustomer } from '@/lib/customer-dedupe'
import { NON_SERIALIZED_CATEGORIES } from '@/lib/sku-categories'
import { callRouteAsDb, type RouteKey } from './call-route'
import { getDbAccessToken, DB_DISPLAY_NAME } from './identity'
import {
  findCustomers, findProducts, findSellableUnits, findUnitBySerial, priceContext, priceChecks,
  getOptions, recallNotes, recentDocumentsFor, expenseChecks,
  expenseTypes, similarExpenseTypes, sameExpenseType, expenseCountByType,
} from './data'
import { shareSalesDocument } from './share'
import { TAP_ONLY_KINDS, ALWAYS_TAP_KINDS } from './approval'
import { prepareStockIn, prepareAccessoryIn, STOCK_TYPES, BUYERS, PAY_ACCOUNTS } from './stock-in'
import { prepareTradeIn } from './trade-in'
import { prepareCustomerReturn, REFUND_ACCOUNTS } from './customer-return'
import { ID_PROOF_TYPES } from '@/lib/trade-ins'
import {
  ALL_READ_MODULES, type ReadModule, stockOverview, soldStock, salesReport, paymentsDue, customerHistory,
  repairJobs, rentalsStatus, purchasesReport, expensesReport, tasksList,
} from './reports'
import { ALL_WRITE_SKILLS, WRITE_SKILLS, getAssistantSettings, saveAssistantSettings, type WriteSkill } from './settings'
import { syncDbPageGrants, skillPagesLine } from './identity'

// DB's tools. Reads run straight away. Writes never do: a propose_* tool
// checks the input, works out the warnings DB must raise, and parks the write
// as the thread's pending action. confirm_pending_action runs it only in a
// LATER turn than the one that proposed it -- so the model can never propose
// and save in the same breath; the owner has to have said yes (or tapped
// Confirm) in between.

export interface PendingAction {
  id: string
  kind: RouteKey | 'customer' | 'note' | 'merge_expense_types' | 'enable_skill'
  body: any
  // Done just before the route call on confirm (e.g. create the new expense type).
  prepare?: { new_expense_type?: { value: string; owner_only: boolean }; reactivate_type_id?: string }
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
  modules?: readonly ReadModule[] // read modules switched on; omitted = all
  skills?: readonly WriteSkill[] // write skills switched on; omitted = all
  // The owner's approval in his latest message, checked in code (approval.ts):
  // the card he tapped Confirm on, and whether his words were a plain yes.
  // Omitted = no approval at all (nothing can be confirmed).
  approval?: { tappedActionId: string | null; saidYes: boolean; tapOnlyMoney: boolean }
}

export interface ToolOutcome {
  result: unknown
  isError?: boolean
  pending?: PendingAction | null // undefined = unchanged, null = cleared
  card?: AssistantCard
  // Her switches changed (a skill was allowed): the loop reloads her tools and
  // instructions so she can carry on in the same turn.
  settingsChanged?: boolean
}

// What the panel shows next to DB's words.
export type AssistantCard =
  | { type: 'confirm'; action_id: string; title: string; summary: string; warnings: string[]; confirm_label?: string }
  | { type: 'done'; title: string; detail: string; link?: string | null }
  | { type: 'share'; title: string; pdf_url: string; whatsapp_to_customer: string | null; whatsapp_pick_chat: string }
  // The panel navigates the ERP to href (and gets out of the way on a phone).
  | { type: 'open'; href: string; label: string }

const money = (n: number) => `₹${Math.round(n * 100) / 100}`
// An accessory on a card: its full catalogue name and SKU code, so the exact
// item is unmistakable ("Lenovo USB-A 65W (SKU-ADP-LENOVO-65W-USB-A-001)").
export const accessoryLabel = (sku: { sku_description?: string | null; full_sku_code?: string | null } | null | undefined) => {
  const name = (sku?.sku_description || '').replace(/\s+/g, ' ').trim()
  return sku?.full_sku_code ? `${name || 'Accessory'} (${sku.full_sku_code})` : name || 'accessory'
}
const exclusive = (price: number, gst: number) => Math.round((price / (1 + gst / 100)) * 100) / 100

// ---------------------------------------------------------------- pages DB can open
// Only these ERP routes (never a URL from the conversation). `q`: the page keeps
// its search box in the address as ?q= (useUrlState), so DB can pre-fill it.
const PAGES = {
  home: { path: '/dashboard/home', label: 'Home' },
  pending_tasks: { path: '/dashboard/pending-tasks', label: 'Pending tasks' },
  activities: { path: '/dashboard/activities', label: 'Activities' },
  sell: { path: '/dashboard/entry/sell', label: 'New sale' },
  stock_in: { path: '/dashboard/entry/intake', label: 'Stock in' },
  service_entry: { path: '/dashboard/entry/service', label: 'Service entry' },
  sales: { path: '/dashboard/sales', label: 'Sales Ledger', q: 'q' },
  quotations: { path: '/dashboard/quotations', label: 'PIs & quotations', q: 'q' },
  invoices: { path: '/dashboard/invoices', label: 'Invoices', q: 'q' },
  customers: { path: '/dashboard/customers', label: 'Customers', q: 'q' },
  leads: { path: '/dashboard/leads', label: 'Leads', q: 'q' },
  live_stock: { path: '/dashboard/live-stock', label: 'Live Stock', q: 'q' },
  stock: { path: '/dashboard/stock', label: 'Stock', q: 'q' },
  sku_master: { path: '/dashboard/sku-master', label: 'SKU Master', q: 'search' },
  pricing: { path: '/dashboard/pricing', label: 'Price Board', q: 'q' },
  accessories: { path: '/dashboard/accessories', label: 'Accessories', q: 'q' },
  repair_jobs: { path: '/dashboard/repair-jobs', label: 'Repair jobs', q: 'q' },
  replacement_jobs: { path: '/dashboard/replacement-jobs', label: 'Replacement jobs' },
  rma: { path: '/dashboard/rma', label: 'RMA' },
  rentals: { path: '/dashboard/rentals', label: 'Rentals' },
  purchase_orders: { path: '/dashboard/purchase-orders', label: 'Purchase orders', q: 'q' },
  purchase_invoices: { path: '/dashboard/purchase-invoices', label: 'Purchase invoices' },
  purchases: { path: '/dashboard/purchases', label: 'Purchases' },
  vendors: { path: '/dashboard/vendors', label: 'Vendors', q: 'q' },
  expenses: { path: '/dashboard/expenses', label: 'Expenses' },
  reports: { path: '/dashboard/reports', label: 'Reports' },
  gst: { path: '/dashboard/gst', label: 'GST' },
  bank_recon: { path: '/dashboard/recon/bank', label: 'Bank reconciliation' },
  attendance: { path: '/dashboard/attendance', label: 'Attendance' },
  web_orders: { path: '/dashboard/web-orders', label: 'Website orders' },
  marketing: { path: '/dashboard/marketing', label: 'Marketing' },
  settings: { path: '/dashboard/settings', label: 'Settings' },
  audit_log: { path: '/dashboard/settings/audit-log', label: 'Audit log' },
  help: { path: '/dashboard/help', label: 'Help' },
} as const satisfies Record<string, { path: string; label: string; q?: string }>
type PageKey = keyof typeof PAGES

// One record's own page, found by the number he says (exact, else ending in it).
const RECORDS = {
  quotation: { table: 'sales_documents', cols: ['document_number'], path: '/dashboard/quotations/', label: 'PI/quotation' },
  invoice: { table: 'invoices', cols: ['invoice_number'], path: '/dashboard/invoices/', label: 'Invoice' },
  purchase_order: { table: 'purchase_orders', cols: ['po_number'], path: '/dashboard/purchase-orders/', label: 'PO' },
  rental: { table: 'rental_agreements', cols: ['agreement_number'], path: '/dashboard/rentals/', label: 'Rental' },
  stock_unit: { table: 'asset_ledger', cols: ['asset_number', 'serial_number'], path: '/dashboard/stock/', label: 'Unit' },
} as const

async function openPage(input: { page: PageKey; search?: string | null; record?: { type: keyof typeof RECORDS; number: string } | null }): Promise<ToolOutcome> {
  if (input.record) {
    const rec = RECORDS[input.record.type]
    const num = input.record.number.trim().replace(/[%_\\]/g, '')
    if (!num) return { result: 'Which number? Ask him.', isError: true }
    const find = async (pattern: string) => {
      const hits: { id: string; label: string }[] = []
      for (const col of rec.cols) {
        const { data } = await supabaseAdmin.from(rec.table).select(`id, ${col}`).ilike(col, pattern).limit(6)
        for (const row of (data || []) as unknown as Record<string, string>[]) hits.push({ id: row.id, label: row[col] })
      }
      return hits
    }
    let hits = await find(num)
    if (!hits.length) hits = await find(`%${num}`)
    if (!hits.length) return { result: `No ${rec.label} with a number like "${input.record.number}". Ask him to check the number.`, isError: true }
    if (hits.length > 1) return { result: { status: 'several_match', matches: hits.slice(0, 6).map((h) => h.label), instruction: 'Ask which one, then call open_page again with the full number.' } }
    const href = `${rec.path}${hits[0].id}`
    return { result: { opened: `${rec.label} ${hits[0].label}` }, card: { type: 'open', href, label: `${rec.label} ${hits[0].label}` } }
  }
  const page = PAGES[input.page] as { path: string; label: string; q?: string }
  const q = input.search?.trim()
  const href = q && page.q ? `${page.path}?${page.q}=${encodeURIComponent(q)}` : page.path
  return {
    result: { opened: page.label, ...(q && !page.q ? { note: `${page.label} has no search box to fill; opened the page only.` } : {}) },
    card: { type: 'open', href, label: q && page.q ? `${page.label}: “${q}”` : page.label },
  }
}

// ---------------------------------------------------------------- schemas

// The customer's OLD laptop given towards a new one (upgrade / exchange).
const TRADE_IN = z.object({
  serial_number: z.string().min(3).max(40).describe('The OLD laptop\'s serial exactly as he said or typed it -- never guessed or completed.'),
  sku_id: z.string().nullish().describe('Only when the old laptop is not one we sold: its model from find_products (tracked_per_unit: true).'),
  value: z.number().positive().describe('What we give the customer for the old laptop, in rupees.'),
  condition_notes: z.string().max(300).nullish(),
  accessories_included: z.string().max(120).nullish().describe('What came back with it, e.g. "charger, bag".'),
  id_proof_type: z.enum(ID_PROOF_TYPES).nullish().describe('Customer ID shown, for the buyback slip.'),
  id_proof_last4: z.string().max(4).nullish().describe('Only the LAST 4 characters of that ID -- never the full Aadhaar/PAN number.'),
  trade_in_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().describe('YYYY-MM-DD; default today.'),
  notes: z.string().max(200).nullish(),
})

const S = {
  find_customer: z.object({ query: z.string().describe('Name, part of a name, or phone number.') }),
  find_products: z.object({ query: z.string().describe('Model words as spoken, e.g. "elitebook 840 g6 8 256", "bag", "mouse".') }),
  find_sellable_units: z.object({ sku_id: z.string() }),
  find_unit_by_serial: z.object({ serial_number: z.string() }),
  price_context: z.object({ sku_id: z.string(), customer_id: z.string().nullish() }),
  get_options: z.object({}),
  propose_stock_in: z.object({
    sku_id: z.string().nullish().describe('The model from find_products (tracked_per_unit: true). Leave out only for a model not in the catalogue, and give new_model instead.'),
    new_model: z.object({
      type: z.enum(STOCK_TYPES),
      brand: z.string().min(1),
      model: z.string().min(1),
      specs: z.record(z.string(), z.string()).nullish().describe('Other spec fields by name as on the New Entry form, e.g. cpu, generation, ram, ssd, screen_size.'),
    }).nullish(),
    units: z.array(z.object({
      serial_number: z.string().min(3).max(40).describe('Exactly as he said or typed it -- never guessed or completed.'),
      condition_notes: z.string().max(300).nullish(),
    })).min(1).max(20).describe('One per physical unit.'),
    purchased_by: z.enum(BUYERS),
    condition_notes: z.string().max(300).nullish().describe('Applies to every unit unless a unit has its own.'),
    received_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().describe('YYYY-MM-DD; default today.'),
    bundled_accessories: z.array(z.object({ accessory_id: z.string(), quantity: z.number().int().min(1).max(10) })).max(5).nullish()
      .describe('Accessories that came with EACH unit (charger, bag), from find_products (tracked_per_unit: false); their stock goes up too.'),
  }),
  propose_accessory_in: z.object({
    sku_id: z.string().describe('The accessory from find_products (tracked_per_unit: false).'),
    quantity: z.number().int().min(1).max(5000),
    total_price: z.number().min(0).nullish().describe('Total paid for all of them, as on the Receive stock form.'),
    gst_percentage: z.number().min(0).max(28).nullish(),
    vendor: z.string().max(120).nullish().describe('Vendor name as he said it.'),
    purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().describe('YYYY-MM-DD; default today.'),
    payment_account: z.enum(PAY_ACCOUNTS).nullish(),
    notes: z.string().max(200).nullish(),
  }),
  open_page: z.object({
    page: z.enum(Object.keys(PAGES) as [PageKey, ...PageKey[]]),
    search: z.string().max(80).nullish().describe('Pre-fills the page search box (list pages that have one): a name, phone, model, serial, number.'),
    record: z.object({
      type: z.enum(['quotation', 'invoice', 'purchase_order', 'rental', 'stock_unit']),
      number: z.string().max(60).describe('As he said it: PI/quotation number, invoice number, PO number, rental agreement number, or a unit\'s asset or serial number. A partial number ("245") is fine.'),
    }).nullish().describe('Open one record\'s own page instead of a list.'),
  }),
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
    create_new_type: z.boolean().nullish().describe('Only after Shishir agreed to create `type` as a NEW expense category (no existing one fits).'),
    new_type_private: z.boolean().nullish().describe('With create_new_type: true = owner-only, hidden from staff.'),
  }),
  propose_merge_expense_types: z.object({
    merge: z.array(z.string()).min(1).describe('Existing expense types to fold into `into` (they disappear from the dropdown).'),
    into: z.string().describe('The type to keep (existing, or a new name).'),
    make_private: z.boolean().nullish().describe('True = the kept type becomes owner-only (hidden from staff).'),
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
    trade_in: TRADE_IN.nullish().describe('Upgrade: the customer\'s old laptop given towards this sale. The sale is at the new laptop\'s FULL price; the trade-in value counts as part of the payment, and `payments` is only the money paid on top.'),
  }),
  propose_trade_in: TRADE_IN.extend({
    sale_unit_serial: z.string().min(3).max(40).describe('Serial of the NEW laptop on the sale that is already saved (the one the customer bought).'),
  }),
  propose_customer_return: z.object({
    serial_number: z.string().describe('The returned laptop/desktop\'s serial.'),
    reason: z.string().describe('Why it came back, in his words.'),
    return_date: z.string().nullish().describe('YYYY-MM-DD if not today.'),
    resolution: z.enum(['refund', 'credit_note']).nullish().describe('Required when money was paid on the sale: refund, or store credit (credit note).'),
    amount: z.number().positive().nullish().describe('Refund or credit amount. Default: all that was paid on the sale.'),
    refund_account: z.enum(REFUND_ACCOUNTS).nullish().describe('Account the refund is paid from.'),
    notes: z.string().nullish(),
  }),
  enable_skill: z.object({
    skill: z.enum(ALL_WRITE_SKILLS as [WriteSkill, ...WriteSkill[]]),
    why: z.string().describe('What he asked for that needs it, in one short line.'),
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
  // ---- module-wise reads (each switchable in Settings -> DB Assistant)
  stock_overview: z.object({
    which: z.enum(['live', 'main', 'all']).nullish().describe('live = Live Stock (staff intake), main = main ERP stock (purchase orders / legacy), all = both. Default all.'),
    query: z.string().nullish().describe('Model words, serial or asset number to narrow down, e.g. "840 g6".'),
    status: z.string().nullish().describe('One status only, e.g. ready_for_sale, qc_pending, faulty, on_rent.'),
  }),
  sold_stock: z.object({
    from: z.string().nullish().describe('YYYY-MM-DD, default first of this month.'),
    to: z.string().nullish().describe('YYYY-MM-DD, default today.'),
    query: z.string().nullish().describe('Model words, brand, serial or customer name.'),
    customer_id: z.string().nullish(),
    sold_by: z.string().nullish().describe('Staff name.'),
    limit: z.number().int().nullish().describe('Lines to list, default 25, max 50.'),
  }),
  sales_report: z.object({
    from: z.string().nullish(),
    to: z.string().nullish(),
    group_by: z.enum(['day', 'month', 'entity', 'model', 'brand', 'category', 'salesperson', 'customer', 'kind']).nullish().describe('Default day.'),
  }),
  payments_due: z.object({ min_amount: z.number().nullish() }),
  customer_history: z.object({ customer_id: z.string() }),
  repair_jobs: z.object({
    status: z.enum(['open', 'done', 'all']).nullish().describe('Default open.'),
    from: z.string().nullish(), to: z.string().nullish(),
    query: z.string().nullish().describe('Job number, customer, device or serial.'),
  }),
  rentals_status: z.object({}),
  purchases_report: z.object({ from: z.string().nullish(), to: z.string().nullish() }),
  expenses_report: z.object({
    from: z.string().nullish(), to: z.string().nullish(),
    group_by: z.enum(['type', 'account', 'month', 'staff']).nullish().describe('Default type.'),
  }),
  tasks: z.object({ status: z.enum(['open', 'overdue', 'done_recent']).nullish().describe('Default open.') }),
} as const

type ToolName = keyof typeof S

const DESCRIPTIONS: Record<ToolName, string> = {
  find_customer: 'Find existing customers by name or phone. Returns notes you were asked to remember about each.',
  find_products: 'Search the SKU catalogue (laptops, desktops, accessories). Returns stock on hand and list price.',
  find_sellable_units: 'List the individual units of a SKU that can be sold now (serial numbers, cost).',
  find_unit_by_serial: 'Look up one unit by its serial number.',
  price_context: 'Price history for a SKU: what this customer was quoted/charged before, recent sale prices, list price, cost. Call this BEFORE suggesting or accepting a price.',
  get_options: 'Staff names, expense types, payment accounts and billing entities.',
  propose_stock_in: 'Stock in laptops / desktops / monitors / tablets he received (the New Entry form). Find the model with find_products first. Ask only for what is missing: each serial number (he may say or type it -- if it was fast or unclear, ask him to repeat it slowly or type it; never guess or complete one), who bought it (Digitalbluez, Techtenth, Cash, Other). Condition and charger/bag only if he mentions them -- never ask. Units go live as QC pending without cost or asset number. Then read every serial back character by character and get his yes.',
  propose_accessory_in: 'Accessories he received, counted by quantity (the Accessories "Receive stock" form): which accessory (find_products), how many, and -- if he says them -- vendor, total price, GST %, purchase date, payment account.',
  open_page: 'Open an ERP page on his screen so he can work on it himself -- "Sales Ledger kholo", "Ramesh ka customer dikhao", "PI 245 kholo", "stock mein 840 G6 dikhao". Saves nothing, needs no confirmation. Use search to pre-fill a list page\'s search box, or record to open one PI/quotation, invoice, PO, rental or stock unit by its number. Afterwards say one short line (e.g. "Khol diya"); she stops listening so he can work.',
  find_recent_documents: 'The customer\'s latest PIs and quotations (number, date, total), newest first.',
  recall_notes: 'Notes the owner asked you to remember (general, or about one customer).',
  propose_customer: 'Prepare a new customer record. Shows the owner a confirmation card; nothing is saved yet.',
  propose_sales_document: 'Prepare a proforma invoice (PI) or quotation. Returns warnings you must raise. Nothing is saved yet.',
  propose_expense: 'Prepare an expense entry. Matches the type to an existing category (private ones included). If the type is new it returns similar existing types and asks you to check with Shishir first. Returns warnings you must raise. Nothing is saved yet.',
  propose_merge_expense_types: 'Prepare merging duplicate expense categories (e.g. "Petrol" + "Petrol Exp" into "Petrol"): past expenses are re-labelled and the merged types leave the dropdown. Shows counts. Nothing changes until Shishir confirms.',
  propose_sale: 'Prepare a sale (moves stock when confirmed). Returns warnings you must raise. Nothing is saved yet. For an upgrade where the customer gives an old laptop towards this one, add trade_in (one card saves both).',
  propose_trade_in: 'Trade-in against a sale ALREADY saved: the customer\'s old laptop taken back as part-payment (upgrade). For a new sale use propose_sale with trade_in instead. The old laptop\'s own sale stays; it goes back into stock with the trade-in value as its cost.',
  propose_customer_return: 'A customer gives back a laptop/desktop we sold and does not take another unit: it comes back to QC pending (stock +1), the sale is cancelled, and a refund or credit note is recorded if money was paid. Not for a warranty swap (replacement job) or an upgrade (trade-in). Nothing is saved yet.',
  enable_skill: 'One of your abilities is switched off and Shishir just asked for something that needs it: ask him to allow it. Shows an Allow card; only his tap on it switches the skill on (a spoken yes is not enough). Then carry on with what he asked.',
  propose_repair_job: 'Prepare a repair job. Nothing is saved yet.',
  propose_replacement_job: 'Prepare a replacement job: a faulty unit swapped under warranty. Whatever the customer paid on the old unit carries over to the new one automatically; additional_amount_paid is only NEW money. Not for an upgrade where we buy the old laptop back at a lower price -- that is a trade-in (propose_sale with trade_in). Nothing is saved yet.',
  propose_note: 'Offer to remember a preference. Saved only after the owner agrees.',
  confirm_pending_action: 'Save the pending action. ONLY after the owner clearly said yes to it in their latest message. The server also checks that his message is a plain yes (or a tap on Confirm) and refuses otherwise.',
  cancel_pending_action: 'Drop the pending action when the owner says no or wants to start over.',
  share_document_on_whatsapp: 'For a saved PI/quotation: make a PDF link and a ready-to-send WhatsApp message to the customer.',
  stock_overview: 'Units in stock right now: totals by status, by model (units, sellable, average cost, oldest age in days), and the units themselves when narrowed down. Use for "kitne laptop hain", "840 G6 stock", "sabse purana stock", "faulty units".',
  sold_stock: 'Sold items in a date range: each line with date, item, serial, customer, price before/incl GST, profit (where cost is known), payment status, salesperson; plus totals.',
  sales_report: 'Sales summary for a date range grouped by day, month, entity, model, brand, category, salesperson, customer or kind: revenue before GST, GST, units, gross profit, margin %, outstanding.',
  payments_due: 'Money customers still owe on sales, grouped by customer, largest first, with how old the oldest unpaid sale is.',
  customer_history: 'One customer\'s full picture: all-time and this-financial-year purchases and profit, outstanding, last purchase, recent lines, repair jobs, rentals, recent PIs.',
  repair_jobs: 'Repair and replacement jobs (open by default) with customer, device, problem, charge, payment and age.',
  rentals_status: 'Active rentals: units on rent, overdue returns, next billing dates, deposits held.',
  purchases_report: 'Purchase orders in a date range (count, total, by vendor) and what is still payable to vendors.',
  expenses_report: 'Expenses in a date range grouped by type, account, month or staff, the largest ones, and reimbursements pending to staff.',
  tasks: 'Activities (tasks): open, overdue, or done in the last week, with who they are assigned to.',
}

// Which Settings switch each module-read tool belongs to. Tools not listed here
// (lookups and the propose_* writes) are always available.
const TOOL_MODULE: Partial<Record<ToolName, ReadModule>> = {
  stock_overview: 'stock', sold_stock: 'sold', sales_report: 'reports', payments_due: 'payments',
  customer_history: 'customers', repair_jobs: 'repairs', rentals_status: 'rentals',
  purchases_report: 'purchases', expenses_report: 'expenses', tasks: 'tasks',
}

// Which "What DB can do" switch each write tool belongs to.
const TOOL_SKILL: Partial<Record<ToolName, WriteSkill>> = {
  propose_sales_document: 'pi', share_document_on_whatsapp: 'pi', find_recent_documents: 'pi',
  propose_expense: 'expense', propose_merge_expense_types: 'expense', propose_sale: 'sale', propose_repair_job: 'repair',
  propose_replacement_job: 'replacement', propose_customer: 'customer', propose_note: 'learn',
  propose_stock_in: 'stock_in', propose_accessory_in: 'stock_in',
  propose_trade_in: 'trade_in',
  propose_customer_return: 'return',
}

const toolDef = (name: ToolName): Anthropic.Beta.BetaTool => ({
  name,
  description: DESCRIPTIONS[name],
  input_schema: z.toJSONSchema(S[name], { target: 'draft-7' }) as Anthropic.Beta.BetaTool.InputSchema,
})

// The tool list for a turn. It only changes when the owner changes the
// switches, so it stays in the prompt cache between turns.
export function assistantTools(modules: readonly ReadModule[], skills: readonly WriteSkill[] = ALL_WRITE_SKILLS): Anthropic.Beta.BetaTool[] {
  const allOn = ALL_WRITE_SKILLS.every((k) => skills.includes(k))
  return (Object.keys(S) as ToolName[])
    .filter((n) => n !== 'enable_skill' || !allOn)
    .filter((n) => !TOOL_MODULE[n] || modules.includes(TOOL_MODULE[n]!))
    .filter((n) => !TOOL_SKILL[n] || skills.includes(TOOL_SKILL[n]!))
    .map(toolDef)
}
export const ASSISTANT_TOOLS = assistantTools(ALL_READ_MODULES)

// ---------------------------------------------------------------- executor

export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  if (!(name in S)) return { result: `Unknown tool ${name}`, isError: true }
  const parsed = S[name as ToolName].safeParse(rawInput)
  if (!parsed.success) return { result: `Invalid input: ${parsed.error.message}`, isError: true }
  const input: any = parsed.data
  const mod = TOOL_MODULE[name as ToolName]
  if (mod && ctx.modules && !ctx.modules.includes(mod)) {
    return { result: `Reading ${mod} is switched off in Settings -> DB Assistant -> What DB can read. Tell Shishir he can switch it on there.`, isError: true }
  }
  const skill = TOOL_SKILL[name as ToolName]
  if (skill && ctx.skills && !ctx.skills.includes(skill)) {
    return { result: `The "${skill}" skill is switched off in Settings -> DB Assistant -> What DB can do. Tell Shishir he can switch it on there, or do it from the ERP page.`, isError: true }
  }
  try {
    switch (name as ToolName) {
      case 'stock_overview': return { result: await stockOverview(input) }
      case 'sold_stock': return { result: await soldStock(input) }
      case 'sales_report': return { result: await salesReport(input) }
      case 'payments_due': return { result: await paymentsDue(input) }
      case 'customer_history': return { result: await customerHistory(input) }
      case 'repair_jobs': return { result: await repairJobs(input) }
      case 'rentals_status': return { result: await rentalsStatus() }
      case 'purchases_report': return { result: await purchasesReport(input) }
      case 'expenses_report': return { result: await expensesReport(input) }
      case 'tasks': return { result: await tasksList(input) }
      case 'find_customer': return { result: await findCustomers(input.query) }
      case 'find_products': return { result: await findProducts(input.query) }
      case 'find_sellable_units': return { result: await findSellableUnits(input.sku_id) }
      case 'find_unit_by_serial': return { result: await findUnitBySerial(input.serial_number) }
      case 'price_context': return { result: await priceContext(input.sku_id, input.customer_id) }
      case 'get_options': return { result: await getOptions() }
      case 'propose_stock_in': {
        const prep = await prepareStockIn(input, istToday())
        if (!prep.ok) return { result: prep.result, isError: prep.isError }
        const out = park('stock_intake', prep.body, prep.title, prep.summary, prep.warnings, ctx)
        return { ...out, result: { ...(out.result as object), ...prep.extra } }
      }
      case 'propose_accessory_in': {
        const prep = await prepareAccessoryIn(input, istToday())
        if (!prep.ok) return { result: prep.result, isError: prep.isError }
        return park('accessory_receipt', prep.body, prep.title, prep.summary, prep.warnings, ctx)
      }
      case 'open_page': return await openPage(input)
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
      case 'propose_merge_expense_types': return proposeMergeExpenseTypes(input, ctx)
      case 'propose_sale': return proposeSale(input, ctx)
      case 'propose_trade_in': return proposeTradeIn(input, ctx)
      case 'propose_customer_return': return proposeCustomerReturn(input, ctx)
      case 'enable_skill': return proposeEnableSkill(input, ctx)
      case 'propose_repair_job': return proposeRepair(input, ctx)
      case 'propose_replacement_job': return proposeReplacement(input, ctx)
      case 'propose_note': return proposeNote(input, ctx)
      case 'confirm_pending_action': return confirmPending(input.action_id, ctx)
      case 'cancel_pending_action':
        return ctx.pending?.id === input.action_id
          ? { result: 'Cancelled. Nothing was saved.', pending: null }
          : { result: 'There is no such pending action.', isError: true }
      case 'share_document_on_whatsapp': {
        const share = await shareSalesDocument(input.document_id, ctx.db.profileId)
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

function park(kind: PendingAction['kind'], body: any, title: string, summary: string, warnings: string[], ctx: ToolContext, prepare?: PendingAction['prepare']): ToolOutcome {
  const pending: PendingAction = { id: randomUUID(), kind, body, summary, warnings, created_turn: ctx.turn, ...(prepare ? { prepare } : {}) }
  return {
    pending,
    card: { type: 'confirm', action_id: pending.id, title, summary, warnings },
    result: {
      action_id: pending.id,
      status: 'waiting_for_owner_yes',
      summary,
      warnings,
      // The card on his screen shows every detail; speaking it again is what
      // made DB slow (2026-11-24). Total + ask, warnings first in a few words.
      instruction: warnings.length
        ? 'Say each warning in a few words, then only the total and "Confirm kar dijiye". Do not read the card back.'
        : 'Say only the total and "Confirm kar dijiye" (one short line). Do not read the card back -- it is on his screen.',
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
  const gst = input.gst_number?.trim().toUpperCase() || ''
  const dup = await checkDuplicateCustomer(supabaseAdmin, { customer_name: input.customer_name, phone, gst_number: gst })
  if (dup.blockingMatch) return { result: `A customer with this mobile already exists: "${dup.blockingMatch.customer_name}" (id ${dup.blockingMatch.id}). Use that one, or give this company its own GSTIN if it is a separate business.`, isError: true }
  const warnings = [
    ...dup.sharedPhoneMatches.map((m) => `This mobile is also used by "${m.customer_name}" (different GSTIN).`),
    ...(dup.nameWarningMatch ? [`A customer named "${dup.nameWarningMatch.customer_name}" already exists with a different number.`] : []),
  ]
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
      summaryLines.push(`${line.quantity} × ${NON_SERIALIZED_CATEGORIES.includes(sku.category) ? accessoryLabel(sku) : sku.sku_description} @ ${rate === 0 ? 'FREE' : `${money(rate)}${entity.is_gst_registered ? ' + GST' : ''}`}`)
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
  const settings = await getAssistantSettings()
  const types = await expenseTypes()
  let type: string | null = input.type?.trim() || null
  let isPrivate = false
  let prepare: PendingAction['prepare']
  const extraWarnings: string[] = []
  if (type) {
    const exact = types.find((t) => sameExpenseType(t.value, type!))
    if (exact) {
      type = exact.value // the dropdown's own spelling
      isPrivate = exact.owner_only
      if (!exact.is_active) prepare = { reactivate_type_id: exact.id }
    } else {
      const similar = similarExpenseTypes(type, types.filter((t) => t.is_active))
      if (!input.create_new_type) {
        return {
          result: {
            status: 'type_not_found',
            asked_type: type,
            similar_existing: similar.map((t) => ({ type: t.value, private: t.owner_only })),
            all_existing: types.filter((t) => t.is_active).map((t) => t.value), // spot same-meaning ones too (Petrol -> Fuel)
            instruction: similar.length
              ? `There is no expense type "${type}", but similar ones exist (also check all_existing for one that means the same, e.g. Petrol -> Fuel). Ask Shishir whether to use one of them (to avoid duplicate categories) or create "${type}" as a new one (and whether it should be private, hidden from staff). Then call propose_expense again.`
              : `There is no expense type "${type}". If one in all_existing means the same thing (e.g. Petrol -> Fuel), suggest it. Otherwise ask Shishir whether to create it as a new category (and whether it should be private, hidden from staff), or which existing type to use. Then call propose_expense again with create_new_type: true or the existing type.`,
          },
        }
      }
      if (!settings.expense_full_access) return { result: 'Creating expense categories is switched off in Settings -> DB Assistant -> What DB can do (Full expense access).', isError: true }
      type = type.replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60)
      isPrivate = !!input.new_type_private
      prepare = { new_expense_type: { value: type, owner_only: isPrivate } }
      if (similar.length) extraWarnings.push(`Similar categories already exist: ${similar.map((t) => t.value).join(', ')} -- creating "${type}" may duplicate one.`)
    }
  }
  if (isPrivate && !prepare?.new_expense_type && !settings.expense_full_access) {
    return { result: `"${type}" is a private (owner-only) expense type and full expense access is switched off in Settings -> DB Assistant -> What DB can do. Ask Shishir to switch it on, or enter it in Expenses himself.`, isError: true }
  }
  const date = input.expense_date || istToday()
  const warnings = [...extraWarnings, ...(await expenseChecks(type, input.amount, date))]
  const body = {
    expense_date: date, description: input.description, type, amount: input.amount,
    payment_account: input.payment_account, paid_by_staff: input.paid_by_staff || null, remarks: input.remarks || null,
    gst_percentage: input.gst_percentage ?? null,
  }
  const typeNote = type
    ? ` (${type}${prepare?.new_expense_type ? `: NEW category${isPrivate ? ', private' : ''}` : isPrivate ? ', private' : ''})`
    : ''
  return park('expense', body, `Expense ${money(input.amount)}`,
    `${input.description}${typeNote}, ${money(input.amount)} from ${input.payment_account}, ${date}${input.paid_by_staff ? `, paid by ${input.paid_by_staff}` : ''}`,
    warnings, ctx, prepare)
}

// Fold duplicate expense categories into one: re-label past expenses, retire
// the merged dropdown entries. Owner-confirmed like every other write.
async function proposeMergeExpenseTypes(input: z.infer<typeof S.propose_merge_expense_types>, ctx: ToolContext): Promise<ToolOutcome> {
  const settings = await getAssistantSettings()
  if (!settings.expense_full_access) return { result: 'Merging expense categories is switched off in Settings -> DB Assistant -> What DB can do (Full expense access).', isError: true }
  const types = await expenseTypes()
  const target = types.find((t) => sameExpenseType(t.value, input.into))
  const into = target?.value || input.into.trim().replace(/\s+/g, ' ').slice(0, 60)
  const merge: { value: string; owner_only: boolean; count: number }[] = []
  for (const name of input.merge) {
    if (sameExpenseType(name, into)) continue
    const t = types.find((x) => sameExpenseType(x.value, name))
    merge.push({ value: t?.value || name.trim(), owner_only: !!t?.owner_only, count: await expenseCountByType(t?.value || name) })
  }
  if (!merge.length) return { result: 'Nothing to merge: every name is already the target type.', isError: true }
  const intoPrivate = input.make_private ?? target?.owner_only ?? merge.some((m) => m.owner_only)
  const warnings: string[] = []
  const nowPublic = merge.filter((m) => m.owner_only && !intoPrivate)
  if (nowPublic.length) warnings.push(`${nowPublic.map((m) => m.value).join(', ')} ${nowPublic.length > 1 ? 'are' : 'is'} private, but "${into}" is visible to staff -- those ${nowPublic.reduce((a, m) => a + m.count, 0)} expenses would become visible to staff.`)
  const nowPrivate = merge.filter((m) => !m.owner_only && intoPrivate)
  if (nowPrivate.length) warnings.push(`${nowPrivate.map((m) => m.value).join(', ')} expenses (${nowPrivate.reduce((a, m) => a + m.count, 0)}) would become private, hidden from staff.`)
  const total = merge.reduce((a, m) => a + m.count, 0)
  return park('merge_expense_types', { merge: merge.map((m) => m.value), into, into_private: intoPrivate, create_into: !target },
    'Merge expense categories',
    `${merge.map((m) => `"${m.value}" (${m.count})`).join(', ')} -> "${into}"${!target ? ' (new category)' : ''}${intoPrivate ? ', private' : ''}. ${total} past expense${total === 1 ? '' : 's'} re-labelled; the merged categories leave the dropdown.`,
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
      // Name every free accessory on the card (2026-11-24: "+ 2 free accessory"
      // hid a Type-C charger going out where a USB-A one was meant).
      let freeLine = ''
      if (bundled.length) {
        const { data: accs } = await supabaseAdmin.from('sku_master').select('id, sku_description, full_sku_code').in('id', bundled.map((b) => b.accessory_id))
        freeLine = ` + free: ${bundled.map((b) => `${b.quantity > 1 ? `${b.quantity} × ` : ''}${accessoryLabel(accs?.find((a) => a.id === b.accessory_id))}`).join(', ')}`
      }
      summary.push(`${desc}, serial ${unit.serial_number} @ ${money(base)}${gstPct ? ' + GST' : ''}${freeLine}`)
      if (base > 0) warnings.push(...await priceChecks(unit.current_sku_id || unit.sku_id, customer.id, base))
    } else if (it.accessory_sku_id) {
      const qty = it.quantity ?? 1
      const { data: sku } = await supabaseAdmin.from('sku_master').select('id, sku_description, full_sku_code').eq('id', it.accessory_sku_id).maybeSingle()
      if (!sku) return { result: 'Accessory SKU not found.', isError: true }
      items.push({ accessory_id: sku.id, accessory_quantity: qty, sale_base_price: base })
      summary.push(`${qty} × ${accessoryLabel(sku)} @ ${money(base)}`)
    } else {
      return { result: 'Each item needs asset_ledger_id (a unit) or accessory_sku_id.', isError: true }
    }
    total += base * (1 + gstPct / 100) * (it.accessory_sku_id ? it.quantity ?? 1 : 1)
  }

  // Upgrade: the old laptop's value is part of the payment (saved right after the sale).
  let tradeIn: Awaited<ReturnType<typeof prepareTradeIn>> | null = null
  if (input.trade_in) {
    if (ctx.skills && !ctx.skills.includes('trade_in')) {
      return { result: 'The "trade_in" skill is switched off in Settings -> DB Assistant -> What DB can do. Tell Shishir he can switch it on there, or add the trade-in on the sale in the Sales Ledger.', isError: true }
    }
    if (input.items.filter((it) => it.asset_ledger_id).length !== 1) {
      return { result: 'A trade-in goes with exactly one laptop in the sale -- the one the customer is upgrading to.', isError: true }
    }
    tradeIn = await prepareTradeIn(input.trade_in, { customerId: customer.id, entity: input.payment_account })
    if (!tradeIn.ok) return { result: tradeIn.result, isError: tradeIn.isError }
    if (input.trade_in.value > total + 0.5) return { result: `Trade-in value ${money(input.trade_in.value)} is more than the sale total ${money(total)}. Check both with Shishir.`, isError: true }
    warnings.push(...tradeIn.warnings)
  }
  const tradeInValue = tradeIn?.ok ? input.trade_in!.value : 0

  const paid = input.payments.reduce((s, p) => s + p.amount, 0)
  const received = paid + tradeInValue
  if (received + 0.5 < total) warnings.push(`Only ${money(received)} of ${money(total)} covered${tradeInValue ? ` (trade-in ${money(tradeInValue)} + ${money(paid)} paid)` : ''} -- ${money(total - received)} will show as balance due.`)
  if (received > total + 0.5) warnings.push(`Payments${tradeInValue ? ' plus trade-in' : ''} (${money(received)}) are more than the total (${money(total)}).`)

  const body = {
    customer_id: customer.id, sale_type: input.sale_type, gst_percentage: gstPct, payment_account: input.payment_account,
    sold_by: input.sold_by, sale_date: input.sale_date || istToday(), notes: input.notes || null, items,
    payment_legs: input.payments,
    ...(tradeIn?.ok ? { trade_in: tradeIn.body } : {}),
  }
  const out = park('sale', body, `${tradeIn?.ok ? 'Upgrade' : 'Sale'} for ${customer.customer_name}`,
    [
      ...summary,
      ...(tradeIn?.ok ? [tradeIn.line] : []),
      `${input.sale_type} sale via ${input.payment_account}, total ${money(total)}${tradeInValue ? `, trade-in ${money(tradeInValue)}, customer pays ${money(Math.max(total - tradeInValue, 0))}` : ''}, received now ${money(paid)}, sold by ${input.sold_by}`,
    ].join('\n'),
    warnings, ctx)
  return tradeIn?.ok ? { ...out, result: { ...(out.result as object), ...tradeIn.extra } } : out
}

async function proposeTradeIn(input: z.infer<typeof S.propose_trade_in>, ctx: ToolContext): Promise<ToolOutcome> {
  const { sale_unit_serial: newSerial, ...tradeInInput } = input
  const { data: unit } = await supabaseAdmin.from('asset_ledger').select('id, serial_number')
    .ilike('serial_number', newSerial.trim().replace(/[\\%_]/g, (c) => `\\${c}`)).not('is_deleted', 'is', true).limit(2)
  if (!unit?.length) return { result: `No unit with serial ${newSerial} -- ask which laptop the customer bought.`, isError: true }
  if (unit.length > 1) return { result: `Serial ${newSerial} is on two stock records -- ask Shishir to fix it on the Stock page first.`, isError: true }
  const { data: sale } = await supabaseAdmin.from('sales')
    .select('id, customer_id, customer_name, sale_date, sale_total, amount_paid, payment_account')
    .eq('asset_ledger_id', unit[0].id).eq('is_deleted', false).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!sale) return { result: `${newSerial} has no saved sale. Make the sale with propose_sale and put the trade-in on it.`, isError: true }
  if (!sale.customer_id) return { result: 'That sale has no customer; a trade-in needs one.', isError: true }
  if (!['Digitalbluez', 'Techtenth', 'Cash'].includes(sale.payment_account || '')) return { result: 'That sale has no billing entity set -- it has to be set in the Sales Ledger first.', isError: true }

  const prep = await prepareTradeIn(tradeInInput, { customerId: sale.customer_id, entity: sale.payment_account! })
  if (!prep.ok) return { result: prep.result, isError: prep.isError }
  const total = Number(sale.sale_total) || 0
  const paid = Number(sale.amount_paid) || 0
  const warnings = [...prep.warnings]
  if (paid + input.value > total + 0.5) {
    return { result: `Already paid ${money(paid)} + trade-in ${money(input.value)} is more than the sale total ${money(total)}. Ask Shishir which number is wrong.`, isError: true }
  }
  const due = total - paid - input.value
  if (due > 0.5) warnings.push(`After the trade-in ${money(due)} is still due on this sale.`)
  const out = park('trade_in', { ...prep.body, sale_id: sale.id }, `Trade-in for ${sale.customer_name}`,
    `${prep.line}\nAgainst the sale of ${newSerial} (${sale.sale_date}, ${money(total)}, paid so far ${money(paid)})`, warnings, ctx)
  return { ...out, result: { ...(out.result as object), ...prep.extra } }
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

async function proposeCustomerReturn(input: z.infer<typeof S.propose_customer_return>, ctx: ToolContext): Promise<ToolOutcome> {
  const prep = await prepareCustomerReturn(input, istToday())
  if (!prep.ok) return { result: prep.result, isError: prep.isError }
  const out = park('customer_return', prep.body, prep.title, prep.summary, prep.warnings, ctx)
  return { ...out, result: { ...(out.result as object), ...prep.extra } }
}

// Asking him to switch one of her skills on. Nothing changes until he taps
// Allow (ALWAYS_TAP_KINDS); the skill then gets exactly the ERP pages it needs.
function proposeEnableSkill(input: z.infer<typeof S.enable_skill>, ctx: ToolContext): ToolOutcome {
  const skill = WRITE_SKILLS.find((k) => k.key === input.skill)!
  if ((ctx.skills ?? ALL_WRITE_SKILLS).includes(input.skill)) return { result: `${skill.label} is already on -- just do it.`, isError: true }
  const out = park('enable_skill', { skill: input.skill }, `Allow DB: ${skill.label}`,
    `${skill.hint}\nFor: ${input.why}\n${skillPagesLine(input.skill)}\nYou can switch it off again in Settings -> DB Assistant.`, [], ctx)
  if (out.card?.type === 'confirm') out.card.confirm_label = 'Allow'
  return { ...out, result: { ...(out.result as object), instruction: 'Tell him in one line what you need switched on and why, and ask him to tap Allow on the card. A spoken yes does not switch it on.' } }
}

async function proposeReplacement(input: z.infer<typeof S.propose_replacement_job>, ctx: ToolContext): Promise<ToolOutcome> {
  const customer = await getCustomer(input.customer_id)
  const { data: unit } = await supabaseAdmin.from('asset_ledger').select('serial_number, status').eq('id', input.replacement_asset_id).maybeSingle()
  if (!unit) return { result: 'Replacement unit not found.', isError: true }
  // The same sum the ERP checks on save, done now so a wrong card never reaches his yes.
  const gstPct = input.sale_type === 'Cash' ? 0 : input.gst_percentage ?? 18
  const newTotal = (input.amount_charged || 0) * (1 + gstPct / 100)
  const topUp = input.additional_amount_paid || 0
  let carried = 0
  if (input.is_own_stock && input.asset_id) {
    const { data: old } = await supabaseAdmin.from('sales').select('amount_paid').eq('asset_ledger_id', input.asset_id)
      .eq('is_deleted', false).order('created_at', { ascending: false }).limit(1).maybeSingle()
    carried = Number(old?.amount_paid) || 0
  }
  if (carried + topUp > newTotal + 0.5) {
    return {
      isError: true,
      result: `Not proposed: the old unit's sale already has ${money(carried)} paid, which carries over to the new unit automatically. ${money(carried)} + top-up ${money(topUp)} = ${money(carried + topUp)}, more than the new unit's ${money(newTotal)} -- the ERP would refuse it. additional_amount_paid must be only NEW money. If this is an upgrade where we buy the old laptop back at a lower price, it is a trade-in (propose_sale with trade_in), not a replacement -- ask him.`,
    }
  }
  const body = { ...input, job_date: input.job_date || istToday() }
  return park('replacement_job', body, `Replacement for ${customer.customer_name}`,
    `Returned: ${input.is_own_stock ? 'our unit' : input.customer_device_description || 'customer device'}. Going out: serial ${unit.serial_number}. Reason: ${input.problem_description}\nNew unit ${money(newTotal)}${carried ? `, ${money(carried)} carried over from the old sale` : ''}${topUp ? `, top-up ${money(topUp)}` : ''}`,
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
  // The yes is checked here, not by you: a tap on this card's Confirm, or a
  // latest message that is only a plain yes. Text from ERP records can't do it.
  const tapped = ctx.approval?.tappedActionId === p.id
  const alwaysTap = ALWAYS_TAP_KINDS.has(p.kind)
  const tapOnly = alwaysTap || (!!ctx.approval?.tapOnlyMoney && TAP_ONLY_KINDS.has(p.kind))
  if (!tapped && (tapOnly || !ctx.approval?.saidYes)) {
    return {
      result: alwaysTap
        ? 'Not switched on: giving you a new ability needs his tap on Allow on the card, a spoken yes is not enough. Ask him to tap it.'
        : tapOnly
        ? 'Not saved: for money entries Shishir confirms by tapping Confirm on the card (his setting). Ask him to tap it.'
        : 'Not saved: his latest message is not a plain yes (the server checks this, not you). Ask him to confirm with a simple "haan" or the Confirm button. If he asked for a change, propose again with the change.',
      isError: true,
    }
  }

  if (p.kind === 'note') {
    const { error } = await supabaseAdmin.from('assistant_notes').insert({
      subject_type: p.body.customer_id ? 'customer' : 'general', subject_id: p.body.customer_id, note: p.body.note, created_by: ctx.ownerId,
    })
    if (error) return { result: error.message, isError: true }
    return { result: 'Noted. I will remember that.', pending: null, card: { type: 'done', title: 'Remembered', detail: p.body.note } }
  }

  if (p.kind === 'enable_skill') {
    const skill = p.body.skill as WriteSkill
    const current = await getAssistantSettings()
    const next = current.write_skills.includes(skill) ? current.write_skills : [...current.write_skills, skill]
    await saveAssistantSettings({ write_skills: next, skills_offered: [...ALL_WRITE_SKILLS] }, ctx.ownerId)
    await syncDbPageGrants(next)
    const label = WRITE_SKILLS.find((k) => k.key === skill)!.label
    await logAuditEvent({
      actor: { id: ctx.ownerId, email: ctx.ownerEmail, role: 'owner' },
      actionType: 'update', module: 'settings', tableName: 'app_settings', recordLabel: `DB skill allowed: ${label}`,
      metadata: { via: 'assistant', skill, write_skills: next },
    })
    return {
      result: { switched_on: label, next: 'It is on now and your tools for it are available. Carry on with what he asked.' },
      pending: null,
      settingsChanged: true,
      card: { type: 'done', title: `DB can now do: ${label}`, detail: 'Switch it off any time in Settings -> DB Assistant -> What DB can do.' },
    }
  }

  if (p.kind === 'merge_expense_types') {
    const b = p.body as { merge: string[]; into: string; into_private: boolean; create_into: boolean }
    const types = await expenseTypes()
    let moved = 0
    for (const name of b.merge) {
      const { data } = await supabaseAdmin.from('expenses').update({ type: b.into }).ilike('type', name.replace(/[\\%_]/g, (c) => `\\${c}`)).select('id')
      moved += data?.length || 0
      const opt = types.find((t) => sameExpenseType(t.value, name))
      if (opt) await supabaseAdmin.from('custom_options').update({ is_active: false }).eq('id', opt.id)
    }
    const target = types.find((t) => sameExpenseType(t.value, b.into))
    if (target) await supabaseAdmin.from('custom_options').update({ is_active: true, owner_only: b.into_private }).eq('id', target.id)
    else await supabaseAdmin.from('custom_options').insert({ category: 'expense_types', value: b.into, owner_only: b.into_private, is_active: true })
    await logAuditEvent({
      actor: { id: ctx.db.profileId, email: `${DB_DISPLAY_NAME} (assistant)`, role: 'manager' },
      actionType: 'update', module: 'expenses', tableName: 'custom_options', recordLabel: `Merged expense types into ${b.into}`,
      metadata: { via: 'assistant', requested_by: ctx.ownerEmail, merged: b.merge, into: b.into, private: b.into_private, expenses_relabelled: moved },
    })
    return { result: { saved: true, expenses_relabelled: moved }, pending: null, card: { type: 'done', title: 'Categories merged', detail: `${b.merge.join(', ')} -> ${b.into} (${moved} expenses re-labelled)` } }
  }

  // Expense with a category that has to exist first (new, or re-activated).
  if (p.prepare?.new_expense_type) {
    const t = p.prepare.new_expense_type
    const existing = (await expenseTypes()).find((x) => sameExpenseType(x.value, t.value))
    if (existing) await supabaseAdmin.from('custom_options').update({ is_active: true }).eq('id', existing.id)
    else {
      const { error } = await supabaseAdmin.from('custom_options').insert({ category: 'expense_types', value: t.value, owner_only: t.owner_only, is_active: true })
      if (error) return { result: `Could not create the category "${t.value}": ${error.message}. Nothing was saved.`, isError: true }
    }
    await logAuditEvent({
      actor: { id: ctx.db.profileId, email: `${DB_DISPLAY_NAME} (assistant)`, role: 'manager' },
      actionType: 'create', module: 'expenses', tableName: 'custom_options', recordLabel: `Expense type: ${t.value}`,
      metadata: { via: 'assistant', requested_by: ctx.ownerEmail, owner_only: t.owner_only },
    })
  }
  if (p.prepare?.reactivate_type_id) await supabaseAdmin.from('custom_options').update({ is_active: true }).eq('id', p.prepare.reactivate_type_id)

  if (p.kind === 'customer') {
    const { data, error } = await supabaseAdmin.from('customers').insert([{ ...p.body, communication_channels: ['whatsapp'] }]).select('id, customer_name').single()
    if (error) return { result: error.code === '23505' ? 'A customer with this mobile and GSTIN already exists.' : error.message, isError: true }
    await logAuditEvent({
      actor: { id: ctx.db.profileId, email: `${DB_DISPLAY_NAME} (assistant)`, role: 'manager' },
      actionType: 'create', module: 'customers', tableName: 'customers', recordId: data.id, recordLabel: data.customer_name,
      metadata: { via: 'assistant', requested_by: ctx.ownerEmail },
    })
    return { result: { saved: true, customer_id: data.id }, pending: null, card: { type: 'done', title: 'Customer added', detail: data.customer_name } }
  }

  const token = await getDbAccessToken(ctx.db.profileId)

  // Stock in: the New Entry route takes one serial per call.
  if (p.kind === 'stock_intake') {
    const { units, ...common } = p.body as { units: { serial_number: string; condition_notes: string | null }[]; condition_notes?: string | null }
    const saved: string[] = []
    const failed: string[] = []
    for (const u of units) {
      const r = await callRouteAsDb('stock_intake', { ...common, serial_number: u.serial_number, condition_notes: u.condition_notes || common.condition_notes || null }, { token, sessionId: ctx.db.sessionId })
      if (r.ok) saved.push(u.serial_number)
      else failed.push(`${u.serial_number}: ${r.data?.error || `error ${r.status}`}`)
    }
    if (!saved.length) return { result: `Nothing was saved -- the ERP refused: ${failed.join('; ')}. Tell him plainly.`, isError: true }
    return {
      result: { saved: true, units_saved: saved, failed, next: failed.length ? 'Tell him which serials were not saved and why.' : undefined },
      pending: null,
      card: {
        type: 'done',
        title: `${saved.length} unit${saved.length > 1 ? 's' : ''} in stock (QC pending)`,
        detail: [`Saved: ${saved.join(', ')}`, ...(failed.length ? [`Not saved: ${failed.join('; ')}`] : [])].join('\n'),
      },
    }
  }

  // Upgrade: the sale first, then the trade-in on the unit it sold.
  if (p.kind === 'sale' && p.body.trade_in) {
    const { trade_in: tradeInBody, ...saleBody } = p.body
    const saleRes = await callRouteAsDb('sale', saleBody, { token, sessionId: ctx.db.sessionId })
    if (!saleRes.ok) return { result: `The ERP refused the sale (${saleRes.status}): ${saleRes.data?.error || 'unknown error'}. Nothing was saved. Tell him plainly.`, isError: true }
    const unitSale = (saleRes.data?.sales || []).find((x: any) => x.asset_ledger_id)
    const tiRes = unitSale ? await callRouteAsDb('trade_in', { ...tradeInBody, sale_id: unitSale.id }, { token, sessionId: ctx.db.sessionId }) : null
    if (!tiRes?.ok) {
      const why = tiRes?.data?.error || 'the unit sale was not found'
      return {
        result: { saved: 'sale only', sale_ids: saleRes.data?.sale_ids, trade_in_error: why, next: 'Tell him the sale is saved but the trade-in is NOT (say why). It can be added on that sale in the Sales Ledger, or propose_trade_in again once fixed.' },
        pending: null,
        card: { type: 'done', title: 'Sale recorded, trade-in not saved', detail: `${p.summary}\nTrade-in not saved: ${why}` },
      }
    }
    return {
      result: { saved: true, sale_ids: saleRes.data?.sale_ids, trade_in_number: tiRes.data?.trade_in_number, next: 'Tell him to print the buyback slip (link on the card) and get it signed by the customer.' },
      pending: null,
      card: { type: 'done', title: `Upgrade recorded (${tiRes.data?.trade_in_number})`, detail: p.summary, link: `/dashboard/trade-ins/${tiRes.data?.id}/slip` },
    }
  }

  const res = await callRouteAsDb(p.kind, p.body, { token, sessionId: ctx.db.sessionId }, p.kind === 'accessory_receipt' ? { id: p.body.sku_id } : {})
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
    stock_intake: 'Stock entered',
    accessory_receipt: 'Accessories received',
    trade_in: `Trade-in ${d.trade_in_number || ''} recorded`,
    customer_return: 'Return recorded -- unit in QC pending',
  }
  return {
    result: {
      saved: true, ...pickIds(d),
      next: p.kind === 'sales_document' ? 'Offer to share it on WhatsApp (share_document_on_whatsapp).'
        : p.kind === 'trade_in' ? 'Tell him to print the buyback slip (link on the card) and get it signed by the customer.'
        : p.kind === 'customer_return' ? 'Tell him it is done: unit back in QC pending, sale cancelled, refund or credit recorded. If you warned about an invoice, remind him once.' : undefined,
    },
    pending: null,
    card: { type: 'done', title: titles[p.kind as RouteKey], detail: p.summary, ...(p.kind === 'trade_in' && d.id ? { link: `/dashboard/trade-ins/${d.id}/slip` } : {}) },
  }
}

function pickIds(d: any) {
  const out: Record<string, unknown> = {}
  for (const k of ['id', 'document_number', 'job_number', 'sale_ids', 'grand_total', 'parts_warning', 'trade_in_number']) if (d[k] != null) out[k] = d[k]
  return out
}

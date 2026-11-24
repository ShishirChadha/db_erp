import { supabaseAdmin } from '@/lib/supabase/service'
import { SELLABLE_STATUSES } from '@/lib/sales-entry'
import { NON_SERIALIZED_CATEGORIES } from '@/lib/sku-categories'
import { PAYMENT_ACCOUNTS } from '@/lib/rentals'
import { loadRules, loadCostMap, unitCost } from '@/lib/pricing-board'
import { priceWarnings } from '@/lib/pricing'

// Read-only lookups behind DB's tools. Owner-only feature, so cost and margin
// are included where they help her give advice -- never sent anywhere but the
// owner's own assistant panel.

const ilikeSafe = (s: string) => s.replace(/[%_,()]/g, ' ').trim()

// Typo tolerance for the last-resort lookups: what was heard ("Hyperskill",
// "quantum wireless") against how it was typed in the ERP ("HYPERSCALE",
// "Quantrum Wirless"). Candidates come from each word's first 4 letters; each
// spoken word then counts if some word in the record is within ~30% edits.
function editDistance(a: string, b: string) {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}
const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean)
function wordClose(spoken: string, text: string) {
  const all = tokens(text)
  const squashed = all.join('')
  if (squashed.includes(spoken.replace(/-/g, ''))) return true
  const limit = Math.max(1, Math.floor(spoken.length * 0.3))
  // also against two neighbouring words joined ("hyper" + "scale")
  const pairs = all.slice(0, -1).map((w, i) => w + all[i + 1])
  return [...all, ...pairs].some((w) => Math.abs(w.length - spoken.length) <= limit && editDistance(spoken, w) <= limit)
}
export function fuzzyRank<T>(rows: T[], text: (r: T) => string, words: string[], take = 5): T[] {
  const ws = words.filter((w) => w.length >= 3 || /\d/.test(w))
  if (!ws.length) return []
  const need = ws.length === 1 ? 1 : Math.ceil(ws.length * 0.6)
  return rows
    .map((r) => ({ r, hits: ws.filter((w) => wordClose(w, text(r))).length, len: text(r).length }))
    .filter((x) => x.hits >= need)
    .sort((a, b) => b.hits - a.hits || a.len - b.len)
    .slice(0, take).map((x) => x.r)
}
const prefixes = (words: string[]) => [...new Set(words.filter((w) => w.length >= 4).map((w) => w.slice(0, 4)))]

// Spoken names rarely match the record exactly: "Hyper Scale" for
// "HYPERSCALE RELABEL HOSTING", "Sharma ji" for "R K Sharma & Sons". Tried in
// order, cheapest and most exact first; the last step returns the closest
// names marked close_match so DB asks "yahi hai?" instead of asking for a
// mobile number (2026-11-24: a PI took 13 minutes over misses like this).
const CUSTOMER_COLS = 'id, customer_name, type, phone, email, gst_number, city, state_code'
export async function findCustomers(query: string) {
  const digits = query.replace(/\D/g, '')
  const base = () => supabaseAdmin.from('customers').select(CUSTOMER_COLS).not('is_deleted', 'is', true)
  let rows: any[] = []
  let close = false
  if (digits.length >= 5) {
    rows = (await base().ilike('phone', `%${digits.slice(-10)}%`).limit(8)).data || []
  } else {
    const q = ilikeSafe(query)
    const words = q.split(/\s+/).filter(Boolean)
    for (const pattern of [...new Set([`%${q}%`, `%${words.join('')}%`, `%${words.join('%')}%`])]) {
      rows = (await base().ilike('customer_name', pattern).limit(8)).data || []
      if (rows.length) break
    }
    const strong = words.map((w) => w.toLowerCase()).filter((w) => w.length >= 3 && !/^(ji|sir|and|the|pvt|ltd|private|limited|company|co)$/.test(w))
    const pre = prefixes(strong)
    if (!rows.length && pre.length) {
      const { data } = await base().or(pre.map((p) => `customer_name.ilike.%${p}%`).join(',')).limit(60)
      rows = fuzzyRank(data || [], (r: any) => r.customer_name || '', strong)
      close = rows.length > 0
    }
  }
  if (rows.length === 0) return []
  const { data: notes } = await supabaseAdmin
    .from('assistant_notes').select('subject_id, note')
    .eq('subject_type', 'customer').eq('is_active', true)
    .in('subject_id', rows.map((r) => r.id))
  return rows.map((r) => ({
    ...r,
    ...(close ? { close_match: true } : {}),
    remembered: (notes || []).filter((n) => n.subject_id === r.id).map((n) => n.note),
  }))
}

// A product search that tolerates how people say models out loud: every word
// must appear somewhere in the code or description ("840 g6 8 256"). Spoken
// forms are normalised first ("type c" -> type-c, "65 watt" -> 65w) and each
// word may match one of its everyday synonyms (charger = adapter). If every
// word can't match, it tries again without the 1-2 letter fragments.
const PRODUCT_SYNONYMS: Record<string, string[]> = {
  // Most chargers are named just "Lenovo USB-A 65W" / "Dell Patli Pin 65W": the
  // -ADP- in their SKU code (category ADP) is what marks them as chargers.
  charger: ['charger', 'adapter', 'adaptor', '-adp-'], adapter: ['adapter', 'adaptor', 'charger', '-adp-'], adaptor: ['adaptor', 'adapter', 'charger', '-adp-'],
  chargers: ['charger', 'adapter', 'adaptor', '-adp-'], adapters: ['adapter', 'adaptor', 'charger', '-adp-'],
  bag: ['bag', 'backpack', 'sleeve'], backpack: ['backpack', 'bag'], mouse: ['mouse', 'mice'],
  ram: ['ram', 'memory'], ssd: ['ssd', 'nvme', 'storage'], nvme: ['nvme', 'ssd'], hdd: ['hdd', 'hard disk', 'harddisk'],
  monitor: ['monitor', 'display'], keyboard: ['keyboard', 'keypad'],
}
function productWords(query: string) {
  return ilikeSafe(query).toLowerCase()
    .replace(/\b(type|usb)[\s-]*(c|v|si|see|sea|ce)\b/g, 'type-c')
    .replace(/\busb[\s-]*a\b/g, 'usb-a')
    .replace(/\b(\d+)\s*(watt|watts|w)\b/g, '$1w')
    .split(/\s+/).filter(Boolean).slice(0, 6)
}
// The forms a word may take in a description.
function productAlternatives(w: string) {
  if (PRODUCT_SYNONYMS[w]) return PRODUCT_SYNONYMS[w]
  if (w === 'type-c') return ['type-c', 'type c', 'typec', 'usb-c', 'usb c']
  if (w === 'usb-a') return ['usb-a', 'usb a']
  if (w === 'patli' || w === 'pin') return [w]
  const watt = w.match(/^(\d+)w$/)
  if (watt) return [`${watt[1]}w`, `${watt[1]} w`, `${watt[1]} watt`]
  return [w]
}
async function searchProducts(words: string[]) {
  let req = supabaseAdmin
    .from('sku_master')
    .select('id, full_sku_code, sku_description, category, hsn_code, selling_price_default, quantity_in_stock, status')
    .neq('status', 'archived')
    .limit(30)
  for (const w of words) {
    const alts = productAlternatives(w)
    req = req.or(alts.flatMap((a) => [`sku_description.ilike.%${a}%`, `full_sku_code.ilike.%${a}%`, `model_name.ilike.%${a}%`]).join(','))
  }
  return (await req).data || []
}
export async function findProducts(query: string) {
  const words = productWords(query)
  let data = await searchProducts(words)
  const longer = words.filter((w) => w.length > 2 || /\d/.test(w))
  if (!data.length && longer.length && longer.length < words.length) data = await searchProducts(longer)
  let close = false
  const pre = prefixes(longer)
  if (!data.length && pre.length) {
    const { data: cands } = await supabaseAdmin
      .from('sku_master')
      .select('id, full_sku_code, sku_description, category, hsn_code, selling_price_default, quantity_in_stock, status')
      .neq('status', 'archived')
      .or(pre.map((p) => `sku_description.ilike.%${p}%`).join(','))
      .limit(80)
    data = fuzzyRank(cands || [], (r: any) => `${r.sku_description || ''} ${r.full_sku_code || ''}`, longer, 8)
    close = data.length > 0
  }
  const skus = data || []
  const serialized = skus.filter((s) => !NON_SERIALIZED_CATEGORIES.includes(s.category))
  const counts = new Map<string, number>()
  if (serialized.length) {
    const ids = serialized.map((s) => s.id)
    const { data: units } = await supabaseAdmin
      .from('asset_ledger').select('sku_id, current_sku_id')
      .in('status', SELLABLE_STATUSES).not('is_deleted', 'is', true)
      .or(`current_sku_id.in.(${ids.join(',')}),sku_id.in.(${ids.join(',')})`)
    for (const u of units || []) {
      const id = u.current_sku_id || u.sku_id
      counts.set(id, (counts.get(id) || 0) + 1)
    }
  }
  // Laptops/desktops before their spare parts, in-stock first: "lenovo x13"
  // should show the X13s, not its battery and bezel.
  return skus.map((s) => ({
    id: s.id,
    code: s.full_sku_code,
    description: s.sku_description,
    category: s.category,
    hsn_code: s.hsn_code,
    list_price: s.selling_price_default,
    in_stock: NON_SERIALIZED_CATEGORIES.includes(s.category) ? Number(s.quantity_in_stock) || 0 : counts.get(s.id) || 0,
    tracked_per_unit: !NON_SERIALIZED_CATEGORIES.includes(s.category),
    ...(close ? { close_match: true } : {}),
  }))
    .sort((a, b) => Number(b.tracked_per_unit) - Number(a.tracked_per_unit) || Number(b.in_stock > 0) - Number(a.in_stock > 0))
    .slice(0, 10)
}

export async function findSellableUnits(skuId: string) {
  const { data } = await supabaseAdmin
    .from('asset_ledger')
    .select('id, serial_number, asset_number, status, qc_grade, cost_price, trade_in_value, sku_id, current_sku_id, received_at')
    .in('status', SELLABLE_STATUSES).not('is_deleted', 'is', true)
    .or(`current_sku_id.eq.${skuId},and(current_sku_id.is.null,sku_id.eq.${skuId})`)
    .order('received_at', { ascending: true })
    .limit(20)
  return (data || []).map((u) => ({
    id: u.id, serial_number: u.serial_number, asset_number: u.asset_number, status: u.status,
    qc_grade: u.qc_grade, cost_price: unitCost(u), ...(u.trade_in_value != null ? { traded_in: true } : {}),
  }))
}

export async function findUnitBySerial(serial: string) {
  const { data } = await supabaseAdmin
    .from('asset_ledger')
    .select('id, serial_number, asset_number, status, cost_price, trade_in_value, sku_id, current_sku_id, sku_master!purchase_order_asset_mapping_sku_id_fkey(sku_description)')
    .ilike('serial_number', ilikeSafe(serial))
    .not('is_deleted', 'is', true)
    .limit(3)
  return (data || []).map((u: any) => ({
    id: u.id, serial_number: u.serial_number, asset_number: u.asset_number, status: u.status,
    sellable: SELLABLE_STATUSES.includes(u.status), sku_id: u.current_sku_id || u.sku_id,
    description: u.sku_master?.sku_description ?? null, cost_price: unitCost(u), ...(u.trade_in_value != null ? { traded_in: true } : {}),
  }))
}

// Everything DB needs to have an opinion on a price: what this customer was
// quoted or charged before, what the model has sold for recently, the list
// price, and the cost.
export async function priceContext(skuId: string, customerId?: string | null) {
  const [{ data: sku }, costs, rules] = await Promise.all([
    supabaseAdmin.from('sku_master').select('id, sku_description, category, selling_price_default').eq('id', skuId).maybeSingle(),
    loadCostMap([skuId]),
    loadRules(),
  ])
  if (!sku) return null

  const isUnit = !NON_SERIALIZED_CATEGORIES.includes(sku.category)
  let saleFilter: string
  if (isUnit) {
    const { data: units } = await supabaseAdmin
      .from('asset_ledger').select('id')
      .or(`current_sku_id.eq.${skuId},and(current_sku_id.is.null,sku_id.eq.${skuId})`).limit(500)
    const ids = (units || []).map((u) => u.id)
    saleFilter = ids.length ? `asset_ledger_id.in.(${ids.join(',')})` : 'asset_ledger_id.eq.00000000-0000-0000-0000-000000000000'
  } else {
    saleFilter = `accessory_id.eq.${skuId}`
  }

  const { data: recentSales } = await supabaseAdmin
    .from('sales')
    .select('sale_date, sale_base_price, sale_total, customer_id, customer_name')
    .not('is_deleted', 'is', true).or(saleFilter)
    .order('sale_date', { ascending: false }).limit(30)

  let quotedToCustomer: { date: string; doc: string; rate: number }[] = []
  if (customerId) {
    const { data: lines } = await supabaseAdmin
      .from('sales_document_items')
      .select('rate, sales_documents!inner(document_number, document_date, customer_id, is_deleted)')
      .eq('sku_id', skuId)
      .eq('sales_documents.customer_id', customerId)
      .eq('sales_documents.is_deleted', false)
      .limit(5)
    quotedToCustomer = (lines || []).map((l: any) => ({ date: l.sales_documents.document_date, doc: l.sales_documents.document_number, rate: Number(l.rate) }))
  }

  const sales = recentSales || []
  return {
    description: sku.sku_description,
    list_price: sku.selling_price_default,
    cost_price: costs.get(skuId) ?? null,
    min_margin_pct: rules.min_margin_pct,
    sold_to_this_customer: customerId
      ? sales.filter((s) => s.customer_id === customerId).slice(0, 5).map((s) => ({ date: s.sale_date, price_before_gst: Number(s.sale_base_price) }))
      : [],
    quoted_to_this_customer: quotedToCustomer,
    recent_sales: sales.slice(0, 8).map((s) => ({ date: s.sale_date, price_before_gst: Number(s.sale_base_price), customer: s.customer_name })),
  }
}

// Plain-code checks DB must raise before proposing a price. She words them;
// the facts come from here so they are never invented.
export async function priceChecks(skuId: string, customerId: string | null, priceBeforeGst: number): Promise<string[]> {
  const ctx = await priceContext(skuId, customerId)
  if (!ctx) return []
  const out: string[] = []
  for (const w of priceWarnings(ctx.list_price ? Number(ctx.list_price) : null, priceBeforeGst, ctx.cost_price, ctx.min_margin_pct)) {
    if (w === 'below_cost') out.push(`Price ₹${priceBeforeGst} is BELOW cost (₹${ctx.cost_price}).`)
    if (w === 'below_margin') out.push(`Price ₹${priceBeforeGst} is under the ${ctx.min_margin_pct}% minimum margin on cost ₹${ctx.cost_price}.`)
    if (w === 'big_drop') out.push(`Price is far below the list price ₹${ctx.list_price}.`)
    if (w === 'big_rise') out.push(`Price is far above the list price ₹${ctx.list_price}.`)
  }
  const sold = ctx.sold_to_this_customer[0]
  const quoted = ctx.quoted_to_this_customer[0]
  const past = sold ? { price: sold.price_before_gst, date: sold.date, verb: 'charged' } : quoted ? { price: quoted.rate, date: quoted.date, verb: 'quoted' } : null
  if (past && Math.abs(past.price - priceBeforeGst) / Math.max(past.price, 1) > 0.05) {
    out.push(`This customer was ${past.verb} ₹${past.price} (before GST) for this on ${past.date}.`)
  }
  const others = ctx.recent_sales.map((s) => s.price_before_gst).filter((p) => p > 0)
  if (others.length >= 2) {
    const lo = Math.min(...others), hi = Math.max(...others)
    if (priceBeforeGst < lo * 0.95 || priceBeforeGst > hi * 1.05) {
      out.push(`Recent sales of this model were ₹${lo}–₹${hi} before GST.`)
    }
  }
  return out
}

export async function getOptions() {
  const [{ data: opts }, { data: entities }] = await Promise.all([
    supabaseAdmin.from('custom_options').select('category, value, owner_only').eq('is_active', true).in('category', ['staff_names', 'expense_types']),
    supabaseAdmin.from('business_profiles').select('key, legal_name, is_gst_registered').eq('active', true),
  ])
  return {
    staff_names: (opts || []).filter((o) => o.category === 'staff_names').map((o) => o.value),
    expense_types: (opts || []).filter((o) => o.category === 'expense_types').map((o) => o.value),
    // Owner-only types: hidden from staff; DB may use them when Shishir has given her full expense access.
    private_expense_types: (opts || []).filter((o) => o.category === 'expense_types' && o.owner_only).map((o) => o.value),
    payment_accounts: [...PAYMENT_ACCOUNTS],
    // entity_key for a PI/quotation. Digitalbluez is GST-registered; the others issue bills of supply.
    entities: (entities || []).map((e) => ({ key: e.key, name: e.legal_name, gst_registered: e.is_gst_registered })),
  }
}

export async function recallNotes(customerId?: string | null) {
  let req = supabaseAdmin.from('assistant_notes').select('id, subject_type, subject_id, note, created_at').eq('is_active', true)
  req = customerId ? req.eq('subject_id', customerId) : req.eq('subject_type', 'general')
  const { data } = await req.order('created_at', { ascending: false }).limit(30)
  return data || []
}

// Duplicate guard for PIs: the same customer already has a document for the
// same SKU in the last week.
export async function recentDocumentsFor(customerId: string, skuIds: string[]) {
  if (!skuIds.length) return []
  const since = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)
  const { data } = await supabaseAdmin
    .from('sales_document_items')
    .select('sku_id, rate, sales_documents!inner(document_number, document_date, customer_id, is_deleted)')
    .in('sku_id', skuIds)
    .eq('sales_documents.customer_id', customerId)
    .eq('sales_documents.is_deleted', false)
    .gte('sales_documents.document_date', since)
  return (data || []).map((l: any) => ({ number: l.sales_documents.document_number, date: l.sales_documents.document_date, rate: Number(l.rate) }))
}

export async function expenseChecks(type: string | null, amount: number, date: string): Promise<string[]> {
  const out: string[] = []
  const { data: same } = await supabaseAdmin
    .from('expenses').select('id').not('is_deleted', 'is', true).eq('expense_date', date).eq('amount', amount)
    .limit(1)
  if (same?.length) out.push(`An expense of ₹${amount} is already recorded on ${date} -- possible duplicate.`)
  if (type) {
    const since = new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10)
    const { data: hist } = await supabaseAdmin
      .from('expenses').select('amount').not('is_deleted', 'is', true).eq('type', type).gte('expense_date', since).limit(200)
    const amounts = (hist || []).map((h) => Number(h.amount)).filter((a) => a > 0).sort((a, b) => a - b)
    if (amounts.length >= 5) {
      const median = amounts[Math.floor(amounts.length / 2)]
      if (amount > median * 3) out.push(`₹${amount} is much higher than the usual ${type} expense (around ₹${median}).`)
    }
  }
  return out
}


// ------------------------------------------------------------ expense types
// The expense_types dropdown (custom_options). DB matches what Shishir says to
// an existing type before ever creating one, so categories don't multiply.
export interface ExpenseType { id: string; value: string; owner_only: boolean; is_active: boolean }
export async function expenseTypes(): Promise<ExpenseType[]> {
  const { data } = await supabaseAdmin.from('custom_options').select('id, value, owner_only, is_active').eq('category', 'expense_types')
  return (data || []).map((r) => ({ id: r.id, value: r.value, owner_only: !!r.owner_only, is_active: r.is_active !== false }))
}
const normType = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(expenses?|charges?|exp|cost|costs|bill|bills)\b/g, ' ').replace(/\s+/g, ' ').trim()
export function sameExpenseType(a: string, b: string) { return a.trim().toLowerCase() === b.trim().toLowerCase() }
// Existing types that look like the same thing ("Petrol exp" ~ "Petrol",
// "Travelling" ~ "Travel"): shared words, or a near-identical spelling.
export function similarExpenseTypes(name: string, types: ExpenseType[]) {
  const n = normType(name)
  if (!n) return []
  const words = new Set(n.split(' ').filter((w) => w.length > 2))
  return types.filter((t) => {
    const m = normType(t.value)
    if (!m || sameExpenseType(t.value, name)) return false
    if (m === n || m.includes(n) || n.includes(m)) return true
    if (m.split(' ').some((w) => w.length > 2 && words.has(w))) return true
    return editDistance(m, n) <= Math.max(1, Math.floor(Math.min(m.length, n.length) / 4))
  })
}
export async function expenseCountByType(type: string) {
  const { count } = await supabaseAdmin.from('expenses').select('id', { count: 'exact', head: true }).ilike('type', type.replace(/[\\%_]/g, (c) => `\\${c}`))
  return count || 0
}

import { supabaseAdmin } from '@/lib/supabase/service'
import { istToday } from '@/lib/attendance'
import { SELLABLE_STATUSES } from '@/lib/sales-entry'
import { unitCost } from '@/lib/pricing-board'

// Module-wise read access for DB (Settings -> DB Assistant -> "What DB can
// read"). Each function answers one kind of question with a compact summary --
// totals plus at most a few dozen rows -- because everything returned here is
// read by the model and billed as input tokens. Owner-only feature, so cost and
// profit are included.
//
// Sales figures come from v_report_sale_lines, the same view the Reports page
// uses (one row per sale line, GST split, COGS where the unit's cost is known).

export const READ_MODULES = [
  { key: 'stock', label: 'Stock', hint: 'Live Stock and main ERP stock: counts, models, ageing, units by serial.' },
  { key: 'sold', label: 'Sold stock', hint: 'What sold, when, to whom, at what price and profit.' },
  { key: 'reports', label: 'Sales reports', hint: 'Revenue, GST, profit and margin by day, month, entity, model, brand, salesperson or customer.' },
  { key: 'payments', label: 'Payments due', hint: 'Money customers still owe, by customer.' },
  { key: 'customers', label: 'Customer history', hint: 'What a customer has bought, owes, and has open.' },
  { key: 'repairs', label: 'Repairs & replacements', hint: 'Open and finished repair / replacement jobs.' },
  { key: 'rentals', label: 'Rentals', hint: 'Units on rent, overdue returns, deposits held.' },
  { key: 'purchases', label: 'Purchases', hint: 'Purchase orders and what is still payable to vendors.' },
  { key: 'expenses', label: 'Expenses', hint: 'Spending by type, account, month or staff; pending reimbursements.' },
  { key: 'tasks', label: 'Tasks', hint: 'Open and overdue Activities.' },
] as const
export type ReadModule = typeof READ_MODULES[number]['key']
export const ALL_READ_MODULES = READ_MODULES.map((m) => m.key) as ReadModule[]

const CURRENT_STATUSES = ['draft', 'reserved', 'received', 'in_stock', 'qc_pending', 'qc_passed', 'ready_for_sale', 'faulty', 'rma_sent', 'rma_returned', 'on_rent']
const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown) => Number(v) || 0
const monthStart = () => istToday().slice(0, 8) + '01'
const range = (from?: string | null, to?: string | null) => ({ from: from || monthStart(), to: to || istToday() })
const daysSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000)) : null)
const words = (q?: string | null) => (q || '').toLowerCase().split(/\s+/).filter(Boolean)
const matchesAll = (hay: string, ws: string[]) => ws.every((w) => hay.includes(w))

// PostgREST caps a response at 1000 rows; page through for report ranges.
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>, cap = 20000): Promise<T[]> {
  const out: T[] = []
  for (let start = 0; start < cap; start += 1000) {
    const { data, error } = await build(start, start + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

async function customerNames(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter(Boolean))] as string[]
  if (!unique.length) return new Map<string, string>()
  const { data } = await supabaseAdmin.from('customers').select('id, customer_name').in('id', unique.slice(0, 500))
  return new Map((data || []).map((c) => [c.id, c.customer_name as string]))
}

// ------------------------------------------------------------------ stock

export async function stockOverview(p: { which?: 'live' | 'main' | 'all' | null; query?: string | null; status?: string | null }) {
  const which = p.which || 'all'
  const rows = await fetchAll<any>((a, b) => {
    let q = supabaseAdmin.from('asset_ledger')
      .select('id, serial_number, asset_number, status, source, cost_price, trade_in_value, traded_in_at, qc_grade, received_at, created_at, sku_id, current_sku_id')
      .in('status', p.status ? [p.status] : CURRENT_STATUSES).not('is_deleted', 'is', true)
    if (which === 'live') q = q.eq('source', 'employee_intake')
    if (which === 'main') q = q.neq('source', 'employee_intake')
    return q.order('id').range(a, b)
  })
  const skuIds = [...new Set(rows.map((r) => r.current_sku_id || r.sku_id).filter(Boolean))]
  const skus = new Map<string, any>()
  for (let i = 0; i < skuIds.length; i += 300) {
    const { data } = await supabaseAdmin.from('sku_master').select('id, sku_description, selling_price_default').in('id', skuIds.slice(i, i + 300))
    for (const s of data || []) skus.set(s.id, s)
  }
  const ws = words(p.query)
  const units = rows.map((r) => {
    const sku = skus.get(r.current_sku_id || r.sku_id)
    return {
      serial: r.serial_number, asset_number: r.asset_number, status: r.status,
      stock: r.source === 'employee_intake' ? 'live' : 'main',
      model: sku?.sku_description || 'Unknown model', list_price: sku?.selling_price_default ?? null,
      cost: unitCost(r), grade: r.qc_grade, age_days: daysSince(r.traded_in_at || r.received_at || r.created_at),
      ...(r.trade_in_value != null ? { traded_in: true } : {}),
    }
  }).filter((u) => !ws.length || matchesAll(`${u.model} ${u.serial || ''} ${u.asset_number || ''}`.toLowerCase(), ws))

  const byStatus: Record<string, number> = {}
  const models = new Map<string, { model: string; count: number; sellable: number; costSum: number; costN: number; oldest: number; list_price: number | null }>()
  for (const u of units) {
    byStatus[u.status] = (byStatus[u.status] || 0) + 1
    const m = models.get(u.model) || { model: u.model, count: 0, sellable: 0, costSum: 0, costN: 0, oldest: 0, list_price: u.list_price }
    m.count++
    if (SELLABLE_STATUSES.includes(u.status)) m.sellable++
    if (u.cost != null) { m.costSum += u.cost; m.costN++ }
    m.oldest = Math.max(m.oldest, u.age_days || 0)
    models.set(u.model, m)
  }
  const modelRows = [...models.values()].sort((a, b) => b.count - a.count)
  return {
    stock: which, filter: p.query || p.status || null,
    total_units: units.length,
    sellable_units: units.filter((u) => SELLABLE_STATUSES.includes(u.status)).length,
    by_status: byStatus,
    by_stock: { live: units.filter((u) => u.stock === 'live').length, main: units.filter((u) => u.stock === 'main').length },
    total_cost_of_stock: r2(units.reduce((a, u) => a + (u.cost || 0), 0)),
    models: modelRows.slice(0, 30).map((m) => ({
      model: m.model, units: m.count, sellable: m.sellable, avg_cost: m.costN ? r2(m.costSum / m.costN) : null,
      oldest_days: m.oldest, list_price: m.list_price,
    })),
    more_models: Math.max(0, modelRows.length - 30),
    units: units.length <= 40 || ws.length || p.status
      ? units.sort((a, b) => (b.age_days || 0) - (a.age_days || 0)).slice(0, 40)
      : undefined,
    note: 'Laptops/desktops/monitors/tablets only (one row per unit). For accessories by quantity use find_products.',
  }
}

// ------------------------------------------------------------------ sales

type SaleLine = {
  sale_date: string; month_start: string; entity: string | null; sale_type: string | null
  revenue_ex_gst: number; gst: number; revenue_incl: number; units: number
  customer_id: string | null; customer_name_canonical: string | null; sold_by_canonical: string | null
  brand: string | null; category: string | null; line_kind: string | null
  serial_number: string | null; asset_number: string | null; sku_label: string | null
  payment_status: string | null; outstanding: number; amount_paid: number; cogs: number | null; cogs_known: boolean
}
const SALE_COLS = 'sale_date, month_start, entity, sale_type, revenue_ex_gst, gst, revenue_incl, units, customer_id, customer_name_canonical, sold_by_canonical, brand, category, line_kind, serial_number, asset_number, sku_label, payment_status, outstanding, amount_paid, cogs, cogs_known'

async function saleLines(filter: { from?: string; to?: string; customerId?: string | null; outstandingOnly?: boolean }): Promise<SaleLine[]> {
  return fetchAll<SaleLine>((a, b) => {
    let q = supabaseAdmin.from('v_report_sale_lines').select(SALE_COLS)
    if (filter.from) q = q.gte('sale_date', filter.from)
    if (filter.to) q = q.lte('sale_date', filter.to)
    if (filter.customerId) q = q.eq('customer_id', filter.customerId)
    if (filter.outstandingOnly) q = q.gt('outstanding', 0)
    return q.order('sale_date', { ascending: false }).order('created_at', { ascending: false }).range(a, b)
  })
}

// A unit sold for X with a recorded cost over 3X is almost always bad data (a
// ₹1 placeholder sale price from the migration, or a lot price typed on one unit
// in a PO). Profit skips it and
// names it, so one bad cost can't turn a month's profit negative.
const suspectCost = (l: SaleLine) => l.cogs_known && l.line_kind === 'unit' && num(l.revenue_ex_gst) > 0 && num(l.cogs) > num(l.revenue_ex_gst) * 3

function totals(lines: SaleLine[]) {
  const suspect = lines.filter(suspectCost)
  const known = lines.filter((l) => l.cogs_known && !suspectCost(l))
  const knownRevenue = known.reduce((a, l) => a + num(l.revenue_ex_gst), 0)
  const cogs = known.reduce((a, l) => a + num(l.cogs), 0)
  return {
    lines: lines.length,
    units: lines.reduce((a, l) => a + num(l.units), 0),
    revenue_before_gst: r2(lines.reduce((a, l) => a + num(l.revenue_ex_gst), 0)),
    gst: r2(lines.reduce((a, l) => a + num(l.gst), 0)),
    revenue_incl_gst: r2(lines.reduce((a, l) => a + num(l.revenue_incl), 0)),
    gross_profit: known.length ? r2(knownRevenue - cogs) : null,
    margin_pct: knownRevenue > 0 ? r2(((knownRevenue - cogs) / knownRevenue) * 100) : null,
    cost_known_for: `${known.length} of ${lines.length} lines`,
    suspect_costs: suspect.length
      ? suspect.slice(0, 5).map((l) => `${l.sku_label} ${l.serial_number || ''} (${l.asset_number || 'no asset no.'}): sold ₹${r2(num(l.revenue_ex_gst))}, recorded cost ₹${r2(num(l.cogs))} -- left out of profit: the sale price or the purchase cost looks wrong`)
      : undefined,
    outstanding: r2(lines.reduce((a, l) => a + num(l.outstanding), 0)),
  }
}

const lineView = (l: SaleLine) => ({
  date: l.sale_date, item: l.sku_label, serial: l.serial_number, kind: l.line_kind, customer: l.customer_name_canonical,
  price_before_gst: r2(num(l.revenue_ex_gst)), price_incl_gst: r2(num(l.revenue_incl)), entity: l.entity,
  sold_by: l.sold_by_canonical, payment: l.payment_status, outstanding: num(l.outstanding) || undefined,
  profit: l.cogs_known && !suspectCost(l) ? r2(num(l.revenue_ex_gst) - num(l.cogs)) : null,
})

export async function soldStock(p: { from?: string | null; to?: string | null; query?: string | null; customer_id?: string | null; sold_by?: string | null; limit?: number | null }) {
  const { from, to } = range(p.from, p.to)
  const ws = words(p.query)
  const seller = (p.sold_by || '').toLowerCase()
  const lines = (await saleLines({ from, to, customerId: p.customer_id }))
    .filter((l) => !ws.length || matchesAll(`${l.sku_label || ''} ${l.serial_number || ''} ${l.asset_number || ''} ${l.brand || ''} ${l.customer_name_canonical || ''}`.toLowerCase(), ws))
    .filter((l) => !seller || (l.sold_by_canonical || '').toLowerCase().includes(seller))
  const limit = Math.min(Math.max(p.limit || 25, 1), 50)
  return { from, to, totals: totals(lines), lines: lines.slice(0, limit).map(lineView), more_lines: Math.max(0, lines.length - limit) }
}

const GROUPS = {
  day: (l: SaleLine) => l.sale_date,
  month: (l: SaleLine) => l.month_start?.slice(0, 7),
  entity: (l: SaleLine) => l.entity || 'Unknown',
  model: (l: SaleLine) => l.sku_label || 'Other',
  brand: (l: SaleLine) => l.brand || 'Other',
  category: (l: SaleLine) => l.category || 'Other',
  salesperson: (l: SaleLine) => l.sold_by_canonical || 'Unknown',
  customer: (l: SaleLine) => l.customer_name_canonical || 'Walk-in',
  kind: (l: SaleLine) => l.line_kind || 'other',
} as const
export type SalesGroup = keyof typeof GROUPS

export async function salesReport(p: { from?: string | null; to?: string | null; group_by?: SalesGroup | null }) {
  const { from, to } = range(p.from, p.to)
  const lines = await saleLines({ from, to })
  const by = p.group_by || 'day'
  const groups = new Map<string, SaleLine[]>()
  for (const l of lines) {
    const k = GROUPS[by](l) || 'Other'
    groups.set(k, [...(groups.get(k) || []), l])
  }
  const rows = [...groups.entries()].map(([key, ls]) => ({ [by]: key, ...totals(ls) }))
  if (by === 'day' || by === 'month') rows.sort((a: any, b: any) => String(b[by]).localeCompare(String(a[by])))
  else rows.sort((a, b) => b.revenue_before_gst - a.revenue_before_gst)
  return { from, to, group_by: by, totals: totals(lines), rows: rows.slice(0, 31), more_rows: Math.max(0, rows.length - 31) }
}

export async function paymentsDue(p: { min_amount?: number | null }) {
  const lines = await saleLines({ outstandingOnly: true })
  const byCustomer = new Map<string, { customer: string; outstanding: number; lines: number; oldest: string }>()
  for (const l of lines) {
    const k = l.customer_name_canonical || 'Walk-in'
    const c = byCustomer.get(k) || { customer: k, outstanding: 0, lines: 0, oldest: l.sale_date }
    c.outstanding += num(l.outstanding); c.lines++
    if (l.sale_date < c.oldest) c.oldest = l.sale_date
    byCustomer.set(k, c)
  }
  const rows = [...byCustomer.values()].filter((c) => c.outstanding >= (p.min_amount || 0)).sort((a, b) => b.outstanding - a.outstanding)
  return {
    total_outstanding: r2(rows.reduce((a, c) => a + c.outstanding, 0)),
    customers: rows.length,
    by_customer: rows.slice(0, 30).map((c) => ({ ...c, outstanding: r2(c.outstanding), oldest_days: daysSince(c.oldest) })),
  }
}

export async function customerHistory(p: { customer_id: string }) {
  const [{ data: cust }, lines, { data: repairs }, { data: rentals }, { data: docs }] = await Promise.all([
    supabaseAdmin.from('customers').select('id, customer_name, type, phone, city, gst_number, created_at').eq('id', p.customer_id).maybeSingle(),
    saleLines({ customerId: p.customer_id }),
    supabaseAdmin.from('repair_jobs').select('job_number, job_date, status, problem_description, amount_charged').eq('customer_id', p.customer_id).order('job_date', { ascending: false }).limit(5),
    supabaseAdmin.from('rental_agreements').select('agreement_number, status, start_date, expected_return_date, rent_amount').eq('customer_id', p.customer_id).not('is_deleted', 'is', true).limit(5),
    supabaseAdmin.from('sales_documents').select('document_number, doc_type, document_date, grand_total').eq('customer_id', p.customer_id).eq('is_deleted', false).order('document_date', { ascending: false }).limit(5),
  ])
  if (!cust) return { error: 'Customer not found.' }
  const fyStart = (() => { const t = istToday(); const y = Number(t.slice(0, 4)); return Number(t.slice(5, 7)) >= 4 ? `${y}-04-01` : `${y - 1}-04-01` })()
  return {
    customer: cust,
    all_time: totals(lines),
    this_financial_year: totals(lines.filter((l) => l.sale_date >= fyStart)),
    last_purchase: lines[0]?.sale_date ?? null,
    recent_lines: lines.slice(0, 10).map(lineView),
    repair_jobs: repairs || [],
    rentals: rentals || [],
    recent_pi_quotations: docs || [],
  }
}

// ------------------------------------------------------------------ repairs

export async function repairJobs(p: { status?: 'open' | 'done' | 'all' | null; from?: string | null; to?: string | null; query?: string | null }) {
  const status = p.status || 'open'
  let rq = supabaseAdmin.from('repair_jobs')
    .select('job_number, job_date, status, payment_status, amount_charged, amount_paid, is_own_stock, customer_device_description, customer_device_serial, problem_description, solution_description, customer_id')
  let pq = supabaseAdmin.from('replacement_jobs')
    .select('job_number, job_date, status, amount_charged, is_own_stock, customer_device_description, problem_description, solution_description, customer_id')
  if (status === 'open') { rq = rq.neq('status', 'done'); pq = pq.neq('status', 'done') }
  if (status === 'done') { rq = rq.eq('status', 'done'); pq = pq.eq('status', 'done') }
  if (p.from) { rq = rq.gte('job_date', p.from); pq = pq.gte('job_date', p.from) }
  if (p.to) { rq = rq.lte('job_date', p.to); pq = pq.lte('job_date', p.to) }
  const [{ data: rep }, { data: repl }] = await Promise.all([
    rq.order('job_date', { ascending: false }).limit(200),
    pq.order('job_date', { ascending: false }).limit(200),
  ])
  const names = await customerNames([...(rep || []), ...(repl || [])].map((j) => j.customer_id))
  const ws = words(p.query)
  const view = (j: any, kind: string) => ({
    kind, job: j.job_number, date: j.job_date, status: j.status, customer: names.get(j.customer_id) || null,
    device: j.is_own_stock ? 'our stock' : j.customer_device_description, serial: j.customer_device_serial ?? undefined,
    problem: j.problem_description, solution: j.solution_description || undefined,
    charge_before_gst: j.amount_charged == null ? null : num(j.amount_charged), payment: j.payment_status ?? undefined,
    age_days: daysSince(j.job_date),
  })
  const all = [...(rep || []).map((j) => view(j, 'repair')), ...(repl || []).map((j) => view(j, 'replacement'))]
    .filter((j) => !ws.length || matchesAll(`${j.job} ${j.customer || ''} ${j.device || ''} ${j.serial || ''} ${j.problem || ''}`.toLowerCase(), ws))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
  return {
    status, repair_jobs: all.filter((j) => j.kind === 'repair').length, replacement_jobs: all.filter((j) => j.kind === 'replacement').length,
    jobs: all.slice(0, 30), more_jobs: Math.max(0, all.length - 30),
  }
}

// ------------------------------------------------------------------ rentals

export async function rentalsStatus() {
  const today = istToday()
  const { data: agreements } = await supabaseAdmin.from('rental_agreements')
    .select('id, agreement_number, customer_id, status, start_date, expected_return_date, billing_interval, rent_amount, next_billing_date, security_deposit_amount, deposit_refunded_amount')
    .eq('status', 'active').not('is_deleted', 'is', true).limit(100)
  const ids = (agreements || []).map((a) => a.id)
  const { data: items } = ids.length
    ? await supabaseAdmin.from('rental_agreement_items').select('agreement_id, item_status').in('agreement_id', ids)
    : { data: [] as any[] }
  const names = await customerNames((agreements || []).map((a) => a.customer_id))
  const rows = (agreements || []).map((a) => {
    const onRent = (items || []).filter((i) => i.agreement_id === a.id && i.item_status === 'on_rent').length
    return {
      agreement: a.agreement_number, customer: names.get(a.customer_id) || null, start: a.start_date,
      expected_return: a.expected_return_date, units_on_rent: onRent,
      overdue: !!a.expected_return_date && a.expected_return_date < today && onRent > 0,
      rent: num(a.rent_amount), billing: a.billing_interval, next_billing: a.next_billing_date,
      deposit_held: r2(num(a.security_deposit_amount) - num(a.deposit_refunded_amount)),
    }
  })
  return {
    active_agreements: rows.length,
    units_on_rent: rows.reduce((a, r) => a + r.units_on_rent, 0),
    overdue: rows.filter((r) => r.overdue).length,
    deposits_held: r2(rows.reduce((a, r) => a + r.deposit_held, 0)),
    agreements: rows,
  }
}

// ------------------------------------------------------------------ purchases

export async function purchasesReport(p: { from?: string | null; to?: string | null }) {
  const { from, to } = range(p.from, p.to)
  const [inRange, unpaid] = await Promise.all([
    fetchAll<any>((a, b) => supabaseAdmin.from('purchase_orders')
      .select('po_number, po_date, vendor_name, grand_total, payment_status').not('is_deleted', 'is', true)
      .gte('po_date', from).lte('po_date', to).order('po_date', { ascending: false }).range(a, b)),
    fetchAll<any>((a, b) => supabaseAdmin.from('purchase_orders')
      .select('vendor_name, grand_total, amount_paid, po_date').not('is_deleted', 'is', true)
      .neq('payment_status', 'paid').order('id').range(a, b)),
  ])
  const byVendor = new Map<string, { vendor: string; pos: number; amount: number }>()
  for (const po of inRange) {
    const v = byVendor.get(po.vendor_name || 'Unknown') || { vendor: po.vendor_name || 'Unknown', pos: 0, amount: 0 }
    v.pos++; v.amount += num(po.grand_total)
    byVendor.set(v.vendor, v)
  }
  const payable = new Map<string, { vendor: string; due: number; oldest: string }>()
  for (const po of unpaid) {
    const due = num(po.grand_total) - num(po.amount_paid)
    if (due <= 0) continue
    const v = payable.get(po.vendor_name || 'Unknown') || { vendor: po.vendor_name || 'Unknown', due: 0, oldest: po.po_date }
    v.due += due
    if (po.po_date < v.oldest) v.oldest = po.po_date
    payable.set(v.vendor, v)
  }
  const payRows = [...payable.values()].sort((a, b) => b.due - a.due)
  return {
    from, to,
    purchase_orders: inRange.length,
    purchased_incl_gst: r2(inRange.reduce((a, po) => a + num(po.grand_total), 0)),
    by_vendor: [...byVendor.values()].sort((a, b) => b.amount - a.amount).slice(0, 15).map((v) => ({ ...v, amount: r2(v.amount) })),
    payable_to_vendors_total: r2(payRows.reduce((a, v) => a + v.due, 0)),
    payable_by_vendor: payRows.slice(0, 15).map((v) => ({ ...v, due: r2(v.due) })),
    note: 'Payables come from purchase orders not marked paid; many older POs were never marked, so treat a large payable figure with care.',
  }
}

// ------------------------------------------------------------------ expenses

export async function expensesReport(p: { from?: string | null; to?: string | null; group_by?: 'type' | 'account' | 'month' | 'staff' | null }) {
  const { from, to } = range(p.from, p.to)
  const rows = await fetchAll<any>((a, b) => supabaseAdmin.from('expenses')
    .select('expense_date, description, type, amount, payment_account, paid_by_staff, reimbursement_status')
    .not('is_deleted', 'is', true).gte('expense_date', from).lte('expense_date', to)
    .order('expense_date', { ascending: false }).range(a, b))
  const by = p.group_by || 'type'
  const key = (e: any) => by === 'type' ? e.type || 'Other' : by === 'account' ? e.payment_account || 'Unknown' : by === 'month' ? String(e.expense_date).slice(0, 7) : e.paid_by_staff || '(company paid)'
  const groups = new Map<string, { total: number; count: number }>()
  for (const e of rows) {
    const g = groups.get(key(e)) || { total: 0, count: 0 }
    g.total += num(e.amount); g.count++
    groups.set(key(e), g)
  }
  const { data: pending } = await supabaseAdmin.from('expenses').select('paid_by_staff, amount, reimbursed_amount')
    .not('is_deleted', 'is', true).eq('reimbursement_status', 'pending').limit(500)
  const owed = new Map<string, number>()
  for (const e of pending || []) owed.set(e.paid_by_staff || 'Unknown', (owed.get(e.paid_by_staff || 'Unknown') || 0) + num(e.amount) - num(e.reimbursed_amount))
  return {
    from, to, group_by: by,
    total: r2(rows.reduce((a, e) => a + num(e.amount), 0)), count: rows.length,
    rows: [...groups.entries()].map(([k, g]) => ({ [by]: k, total: r2(g.total), count: g.count })).sort((a, b) => b.total - a.total).slice(0, 25),
    largest: rows.slice().sort((a, b) => num(b.amount) - num(a.amount)).slice(0, 5).map((e) => ({ date: e.expense_date, what: e.description, type: e.type, amount: num(e.amount) })),
    reimbursements_pending: [...owed.entries()].map(([staff, amount]) => ({ staff, amount: r2(amount) })).filter((x) => x.amount > 0),
  }
}

// ------------------------------------------------------------------ tasks

export async function tasksList(p: { status?: 'open' | 'overdue' | 'done_recent' | null }) {
  const status = p.status || 'open'
  let q = supabaseAdmin.from('activities').select('title, status, priority, due_date, user_id, related_type, completed_at').not('is_deleted', 'is', true)
  if (status === 'done_recent') q = q.eq('status', 'done').gte('completed_at', new Date(Date.now() - 7 * 86400_000).toISOString()).order('completed_at', { ascending: false })
  else {
    q = q.in('status', ['pending', 'in_progress']).order('due_date', { ascending: true, nullsFirst: false })
    if (status === 'overdue') q = q.lt('due_date', new Date().toISOString())
  }
  const { data } = await q.limit(100)
  const userIds = [...new Set((data || []).map((t) => t.user_id).filter(Boolean))]
  const { data: people } = userIds.length ? await supabaseAdmin.from('profiles').select('id, full_name').in('id', userIds) : { data: [] as any[] }
  const name = new Map((people || []).map((x) => [x.id, x.full_name]))
  const now = Date.now()
  return {
    status, count: (data || []).length,
    tasks: (data || []).slice(0, 30).map((t) => ({
      title: t.title, status: t.status, priority: t.priority, assigned_to: name.get(t.user_id) || null,
      due: t.due_date, overdue: !!t.due_date && new Date(t.due_date).getTime() < now && t.status !== 'done', about: t.related_type,
    })),
  }
}

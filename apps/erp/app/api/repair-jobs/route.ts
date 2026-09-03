import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { generateRepairJobNumber, resolveRepairGstPercent, consumeRepairParts } from '@/lib/repair-jobs'
import { parsePagination } from '@/lib/pagination'
import { logAuditEvent } from '@/lib/audit-log'
import { resolveEntityKey } from '@/lib/invoice-finalize'

// ---------- GET: list repair jobs ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'repair_jobs')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const search = searchParams.get('search')
  const sortKey = searchParams.get('sort') || 'job_date'
  const sortDir = searchParams.get('order') === 'asc'
  const pagination = parsePagination(searchParams)

  let query = supabaseAdmin
    .from('repair_jobs')
    .select('*, customers(customer_name, phone), sales(id, finalized, invoice_id, invoice_number, sale_total, sale_gst, sale_base_price, amount_paid, payment_status, payment_account, is_deleted)', pagination ? { count: 'exact' } : undefined)

  const SORT_COLUMNS: Record<string, { column: string; foreignTable?: string }> = {
    job_date: { column: 'job_date' },
    job_number: { column: 'job_number' },
    status: { column: 'status' },
    payment_status: { column: 'payment_status' },
    amount_charged: { column: 'amount_charged' },
    customer_name: { column: 'customer_name', foreignTable: 'customers' },
  }
  const sortSpec = SORT_COLUMNS[sortKey] || SORT_COLUMNS.job_date
  query = query.order(sortSpec.column, { ascending: sortDir, nullsFirst: false, ...(sortSpec.foreignTable ? { foreignTable: sortSpec.foreignTable } : {}) })
  if (sortKey !== 'job_number') query = query.order('job_number', { ascending: false })

  if (status) query = query.in('status', status.split(',').map(s => s.trim()))

  // Repair jobs don't store a customer_name snapshot (unlike sales) -- resolve matching
  // customer ids first so search can span both the job's own text fields and its customer.
  if (search) {
    const term = `%${search}%`
    const { data: matchingCustomers } = await supabaseAdmin
      .from('customers')
      .select('id')
      .ilike('customer_name', term)
    const customerIds = (matchingCustomers || []).map((c: any) => c.id)
    const orParts = [
      `job_number.ilike.${term}`,
      `problem_description.ilike.${term}`,
      `customer_device_description.ilike.${term}`,
      `customer_device_serial.ilike.${term}`,
    ]
    if (customerIds.length) orParts.push(`customer_id.in.(${customerIds.join(',')})`)
    query = query.or(orParts.join(','))
  }

  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // A job can now have MULTIPLE linked sales -- the labor charge (created at Mark
  // Done) plus one per consumed part (created immediately when the part is added,
  // see lib/repair-jobs.ts's consumeRepairParts) -- so this aggregates across all of
  // them rather than flattening to a single sale. Once a job is billed,
  // repair_jobs.payment_status/amount_paid are a stale intake-time snapshot (see
  // CLAUDE.md) -- these aggregate fields are what the list/Edit dialog must display
  // instead. Also tags the "invoicing entity" mode (erp/external) the Sales Ledger
  // uses, so the Repair Jobs page can offer Generate Invoice / Record Zoho Invoice #
  // directly without a second trip through Sales Ledger.
  const { data: profiles } = await supabaseAdmin.from('business_profiles').select('key, invoicing_mode')
  const modeByKey = new Map((profiles || []).map((p: any) => [p.key, p.invoicing_mode]))
  const withSale = (data || []).map((j: any) => {
    const rawSales: any[] = Array.isArray(j.sales) ? j.sales : j.sales ? [j.sales] : []
    const sales = rawSales.filter((s) => !s.is_deleted)
    const saleCount = sales.length
    const totalCharged = sales.reduce((sum, s) => sum + Number(s.sale_total || 0), 0)
    const totalPaid = sales.reduce((sum, s) => sum + Number(s.amount_paid || 0), 0)
    const allFinalized = saleCount > 0 && sales.every((s) => s.finalized)
    const aggregatePaymentStatus = saleCount === 0
      ? j.payment_status
      : totalPaid <= 0
        ? 'pending'
        : sales.every((s) => s.payment_status === 'paid')
          ? 'paid'
          : 'partial'
    const invoiceMode = sales.length > 0
      ? modeByKey.get(resolveEntityKey(sales[0].payment_account)) === 'external' ? 'external' : 'erp'
      : undefined
    return {
      ...j,
      sales,
      sale_count: saleCount,
      total_charged: totalCharged,
      total_paid: totalPaid,
      all_finalized: allFinalized,
      aggregate_payment_status: aggregatePaymentStatus,
      invoice_mode: invoiceMode,
    }
  })

  if (pagination) return NextResponse.json({ data: withSale, total: count ?? 0 })
  return NextResponse.json(withSale)
}

// ---------- POST: intake a repair job ----------
// Replacement (swapping a customer's unit for another) lives in
// POST /api/replacement-jobs instead -- a genuinely different concept (creates a real sale
// for the new unit, returns the old one), not a variant of a repair.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'new_entry')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const {
    customer_id, is_own_stock, asset_id, customer_device_description, customer_device_serial,
    problem_description, amount_charged, payment_account, gst_percentage, job_date, parts,
  } = body

  if (!customer_id) return NextResponse.json({ error: 'customer_id is required.' }, { status: 400 })
  if (is_own_stock && !asset_id) {
    return NextResponse.json({ error: 'asset_id is required when this is our own stock.' }, { status: 400 })
  }
  if (!is_own_stock && !customer_device_description) {
    return NextResponse.json({ error: 'Device description is required for a customer-owned device.' }, { status: 400 })
  }
  if (job_date && !/^\d{4}-\d{2}-\d{2}$/.test(job_date)) {
    return NextResponse.json({ error: 'job_date must be in YYYY-MM-DD format.' }, { status: 400 })
  }

  // Parts consumed during the repair (accessory sku_master rows -- battery, screen,
  // keyboard, etc.) become real, priced accessory sales (sales.repair_job_id) the
  // moment the job is created -- see lib/repair-jobs.ts's consumeRepairParts, which
  // reuses the same cart machinery (lib/sales-cart.ts) as a normal accessory sale.
  // A priced sale needs an invoicing entity, so payment_account is required whenever
  // parts are present.
  const partsToConsume: Array<{ sku_id: string; quantity: number; unit_price: number }> = Array.isArray(parts)
    ? parts.filter((p: any) => p?.sku_id && p?.quantity > 0).map((p: any) => ({ sku_id: p.sku_id, quantity: p.quantity, unit_price: Number(p.unit_price) || 0 }))
    : []
  if (partsToConsume.length > 0 && !payment_account) {
    return NextResponse.json({ error: '"Received Into" is required to add parts.' }, { status: 400 })
  }

  // Backdate support: an employee logging a job that actually happened earlier can
  // supply job_date; defaults to today.
  const resolvedJobDate: string = job_date || new Date().toISOString().slice(0, 10)

  let jobNumber: string
  try {
    jobNumber = await generateRepairJobNumber()
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to generate job number: ${err.message}` }, { status: 500 })
  }

  const { data: job, error: jobErr } = await supabaseAdmin
    .from('repair_jobs')
    .insert({
      job_number: jobNumber,
      customer_id,
      is_own_stock: !!is_own_stock,
      asset_id: is_own_stock ? asset_id : null,
      customer_device_description: is_own_stock ? null : customer_device_description,
      customer_device_serial: is_own_stock ? null : customer_device_serial,
      job_type: 'repair',
      problem_description,
      amount_charged: amount_charged ?? null,
      payment_account: payment_account || null,
      gst_percentage: gst_percentage ?? null,
      entered_by: sessionUser.id,
      job_date: resolvedJobDate,
    })
    .select('id, job_number')
    .single()

  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'repair_jobs',
    tableName: 'repair_jobs',
    recordId: job.id,
    recordLabel: job.job_number,
  })

  // The device intake itself has already succeeded at this point -- a part
  // consumption problem (e.g. a stock race since the earlier validation) is
  // surfaced back to the caller as a warning rather than rolling back the job.
  let partsWarning: string | undefined
  if (partsToConsume.length > 0) {
    const { data: customer } = await supabaseAdmin.from('customers').select('customer_name').eq('id', customer_id).single()
    const gstPct = await resolveRepairGstPercent(payment_account, gst_percentage)
    const result = await consumeRepairParts({
      jobId: job.id,
      jobNumber: job.job_number,
      customerId: customer_id,
      customerName: customer?.customer_name || null,
      paymentAccount: payment_account,
      gstPercent: gstPct,
      saleDate: resolvedJobDate,
      parts: partsToConsume,
      sessionUserId: sessionUser.id,
    })
    if (!result.ok) partsWarning = result.message
  }

  return NextResponse.json({ success: true, id: job.id, job_number: job.job_number, parts_warning: partsWarning }, { status: 201 })
}

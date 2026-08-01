import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { generateReplacementJobNumber, SELLABLE_STATUSES } from '@/lib/replacement-jobs'
import { parsePagination } from '@/lib/pagination'
import { processCustomerReturn } from '@/lib/rma'
import { reverseSaleInventoryEffects } from '@/lib/sales-entry'
import { BaseSaleFields, CartItemInput, processSingleSaleItem } from '@/lib/sales-cart'
import { logAuditEvent } from '@/lib/audit-log'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// ---------- GET: list replacement jobs ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'replacement_jobs')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const pagination = parsePagination(searchParams)

  let query = supabaseAdmin
    .from('replacement_jobs')
    .select(`
      *, customers(customer_name, phone),
      old_asset:asset_ledger!replacement_jobs_asset_id_fkey(asset_number, serial_number),
      new_asset:asset_ledger!replacement_jobs_replacement_asset_id_fkey(asset_number, serial_number)
    `, pagination ? { count: 'exact' } : undefined)
    .order('created_at', { ascending: false })

  if (status) query = query.in('status', status.split(',').map(s => s.trim()))
  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (pagination) return NextResponse.json({ data, total: count ?? 0 })
  return NextResponse.json(data)
}

// ---------- POST: swap a customer's unit for another one from our stock ----------
// The old unit (asset_id, when is_own_stock) physically comes back -- reversed via the same
// lib/rma.ts helper a plain customer Return uses. The new unit (replacement_asset_id) gets a
// real sale via the same lib/sales-cart.ts function the Sell flow uses, so it shows up
// correctly (customer, amount, bundled accessories) in Sold Stock and everywhere else a sale
// does, with whatever was already paid on the old sale carried over automatically.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'new_entry')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const {
    customer_id, is_own_stock, asset_id, customer_device_description, customer_device_serial,
    replacement_asset_id, problem_description, amount_charged, payment_account, job_date,
    parts, bundled_accessories, sold_by, sale_type, gst_percentage, additional_amount_paid,
  } = body

  if (!customer_id) return NextResponse.json({ error: 'customer_id is required.' }, { status: 400 })
  if (!replacement_asset_id) return NextResponse.json({ error: 'replacement_asset_id is required.' }, { status: 400 })
  if (is_own_stock && !asset_id) {
    return NextResponse.json({ error: 'asset_id is required when this is our own stock.' }, { status: 400 })
  }
  if (!is_own_stock && !customer_device_description) {
    return NextResponse.json({ error: 'Device description is required for a customer-owned device.' }, { status: 400 })
  }
  if (job_date && !/^\d{4}-\d{2}-\d{2}$/.test(job_date)) {
    return NextResponse.json({ error: 'job_date must be in YYYY-MM-DD format.' }, { status: 400 })
  }

  // Parts consumed during the swap (accessory sku_master rows) -- validated up front so a
  // job never gets created only to find out a part is oversold. replacement_job_parts links
  // back to the exact stock_movements row it produced, same idiom as repair_job_parts.
  const partsToConsume: Array<{ sku_id: string; quantity: number }> = Array.isArray(parts)
    ? parts.filter((p: any) => p?.sku_id && p?.quantity > 0)
    : []
  if (partsToConsume.length > 0) {
    const { data: skuRows } = await supabaseAdmin
      .from('sku_master')
      .select('id, full_sku_code, quantity_in_stock')
      .in('id', partsToConsume.map((p) => p.sku_id))
    const skuById = new Map((skuRows || []).map((s) => [s.id, s]))
    for (const part of partsToConsume) {
      const sku = skuById.get(part.sku_id)
      if (!sku) return NextResponse.json({ error: 'Part not found.' }, { status: 404 })
      if (sku.quantity_in_stock < part.quantity) {
        return NextResponse.json({ error: `Only ${sku.quantity_in_stock} of ${sku.full_sku_code} in stock.` }, { status: 400 })
      }
    }
  }

  // Backdate support: an employee logging a job that actually happened earlier can
  // supply job_date; defaults to today.
  const resolvedJobDate: string = job_date || new Date().toISOString().slice(0, 10)

  // Pre-check the replacement unit is currently sellable -- read-only, no lock yet. The
  // actual atomic lock-to-sold happens inside processSingleSaleItem further down (once the
  // job row and the old unit's return are both settled), so a failure here never leaves
  // anything partially committed.
  const { data: replacement } = await supabaseAdmin
    .from('asset_ledger')
    .select('id, status')
    .eq('id', replacement_asset_id)
    .single()
  if (!replacement) return NextResponse.json({ error: 'Replacement unit not found.' }, { status: 404 })
  if (!SELLABLE_STATUSES.includes(replacement.status)) {
    return NextResponse.json({ error: `Replacement unit is '${replacement.status}' and not available.` }, { status: 400 })
  }

  let jobNumber: string
  try {
    jobNumber = await generateReplacementJobNumber()
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to generate job number: ${err.message}` }, { status: 500 })
  }

  // The old unit (asset_id) is physically coming back -- reverse its inventory effects (and
  // any bundled accessories from its own sale) and send it back to QC, the same mechanism a
  // bare customer Return uses (lib/rma.ts). This runs before the job row is created so a
  // failure here leaves nothing committed.
  let carriedOverPaid = 0
  if (is_own_stock && asset_id) {
    const returnResult = await processCustomerReturn(asset_id, {
      reason: 'Replaced with another unit',
      notes: `Replacement job ${jobNumber}`,
      userId: sessionUser.id,
      eventDate: resolvedJobDate,
    })
    if (returnResult.error) {
      return NextResponse.json({ error: returnResult.error }, { status: returnResult.status || 500 })
    }
    carriedOverPaid = returnResult.saleAmountPaid || 0
  }

  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('customer_name')
    .eq('id', customer_id)
    .single()

  const resolvedSaleType = sale_type === 'Cash' ? 'Cash' : 'GST'
  const gstPct = resolvedSaleType === 'GST' ? (gst_percentage ?? 18) : 0
  const saleBasePrice = Number(amount_charged) || 0
  const gstAmount = Math.round(saleBasePrice * gstPct) / 100
  const saleTotal = saleBasePrice + gstAmount
  const topUp = Number(additional_amount_paid) || 0
  const amountPaidForItem = Math.min(carriedOverPaid + topUp, saleTotal)

  const { data: job, error: jobErr } = await supabaseAdmin
    .from('replacement_jobs')
    .insert({
      job_number: jobNumber,
      customer_id,
      is_own_stock: !!is_own_stock,
      asset_id: is_own_stock ? asset_id : null,
      customer_device_description: is_own_stock ? null : customer_device_description,
      customer_device_serial: is_own_stock ? null : customer_device_serial,
      replacement_asset_id,
      problem_description,
      amount_charged: saleTotal,
      payment_account: payment_account || null,
      entered_by: sessionUser.id,
      job_date: resolvedJobDate,
    })
    .select('id, job_number')
    .single()

  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 })

  const saleDateObj = new Date(`${resolvedJobDate}T12:00:00.000Z`)
  const baseSaleFields: BaseSaleFields = {
    sale_date: resolvedJobDate,
    sale_month: MONTHS[saleDateObj.getUTCMonth()],
    sale_year: saleDateObj.getUTCFullYear(),
    customer_id,
    customer_name: customer?.customer_name || null,
    sale_type: resolvedSaleType,
    entered_by: sessionUser.id,
    sold_by: sold_by || null,
    payment_account: payment_account || null,
    notes: null,
    finalized: false,
  }
  const item: CartItemInput = {
    asset_ledger_id: replacement_asset_id,
    sale_base_price: saleBasePrice,
    bundled_accessories: Array.isArray(bundled_accessories) && bundled_accessories.length > 0 ? bundled_accessories : undefined,
  }

  // amount_paid/payment_status are no longer set directly on the sales insert -- see
  // lib/sales-cart.ts. The carried-over amount + any top-up is ledgered as one
  // sale_payments row right after the sale commits, same as the Sell form's cart
  // checkout, so trg_sync_sale_payment_totals derives the summary fields and a later
  // installment never silently wipes this one out.
  const result = await processSingleSaleItem(item, baseSaleFields, gstPct, sessionUser.id)
  if (!result.ok) {
    await supabaseAdmin.from('replacement_jobs').delete().eq('id', job.id)
    return NextResponse.json({ error: result.message }, { status: result.status })
  }

  if (amountPaidForItem > 0) {
    const { error: paymentErr } = await supabaseAdmin.from('sale_payments').insert({
      sale_id: result.saleRow.id,
      amount: amountPaidForItem,
      payment_account: payment_account || 'Digitalbluez',
      note: carriedOverPaid > 0 ? 'Carried over from replaced sale, plus any top-up' : 'Recorded at replacement job creation',
      recorded_by: sessionUser.id,
    })
    if (paymentErr) {
      await reverseSaleInventoryEffects(result.saleRow, {
        reason: 'Replacement job rolled back -- payment ledger insert failed',
        userId: sessionUser.id,
        assetRevertStatus: result.saleRow.priorAssetStatus,
      })
      await supabaseAdmin.from('sales').delete().eq('id', result.saleRow.id)
      await supabaseAdmin.from('replacement_jobs').delete().eq('id', job.id)
      return NextResponse.json({ error: `Job created but recording payment failed: ${paymentErr.message}. Rolled back.` }, { status: 500 })
    }
  }

  // A newly-typed staff name is saved back into custom_options so it shows up in the
  // dropdown next time (same idiom as app/api/sales-entry/route.ts).
  if (typeof sold_by === 'string' && sold_by.trim()) {
    await supabaseAdmin
      .from('custom_options')
      .upsert({ category: 'staff_names', value: sold_by.trim() }, { onConflict: 'category,value', ignoreDuplicates: true })
  }

  for (const part of partsToConsume) {
    const { data: movement, error: moveErr } = await supabaseAdmin
      .from('stock_movements')
      .insert({
        sku_id: part.sku_id,
        movement_type: 'sale',
        quantity_change: -part.quantity,
        notes: `Used in replacement job ${jobNumber}`,
        created_by: sessionUser.id,
      })
      .select('id')
      .single()
    if (!moveErr && movement) {
      await supabaseAdmin.from('replacement_job_parts').insert({
        replacement_job_id: job.id,
        sku_id: part.sku_id,
        quantity: part.quantity,
        stock_movement_id: movement.id,
      })
    }
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'replacement_jobs',
    tableName: 'replacement_jobs',
    recordId: job.id,
    recordLabel: job.job_number,
  })

  return NextResponse.json({ success: true, id: job.id, job_number: job.job_number }, { status: 201 })
}

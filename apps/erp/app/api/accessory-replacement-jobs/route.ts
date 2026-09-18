import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { generateReplacementJobNumber } from '@/lib/accessory-replacement-jobs'
import { processAccessoryFromCustomer } from '@/lib/accessory-rma'
import { BaseSaleFields, CartItemInput, processSingleSaleItem } from '@/lib/sales-cart'
import { logAuditEvent } from '@/lib/audit-log'
import { withRetry } from '@/lib/db-retry'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// ---------- GET: list accessory replacement jobs ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'replacement_jobs')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')

  let query = supabaseAdmin
    .from('accessory_replacement_jobs')
    .select(`
      *, customers(customer_name, phone),
      old_sku:sku_master!accessory_replacement_jobs_old_sku_id_fkey(full_sku_code, sku_description),
      new_sku:sku_master!accessory_replacement_jobs_replacement_sku_id_fkey(full_sku_code, sku_description)
    `)
    .order('created_at', { ascending: false })

  if (status) query = query.in('status', status.split(',').map((s) => s.trim()))

  const { data, error } = await withRetry(() => query)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

// ---------- POST: swap a customer's accessory for another one from our stock ----------
// Mirrors POST /api/replacement-jobs exactly, with sku_id+quantity in place of asset_id
// (accessories are fungible, no per-unit row -- see docs/decisions.md). The old item
// (old_sku_id, when is_own_stock) is reversed via the same lib/accessory-rma.ts helper a
// plain accessory Return uses; the new item (replacement_sku_id) gets a real standalone
// accessory sale via the same lib/sales-cart.ts function the Sell flow already uses for
// accessories. Unlike a serialized unit, an accessory sale can't be traced back to one
// specific prior sale to carry its amount_paid forward -- amount_charged/top-up here are
// always a fresh manual entry, no auto-carry-over.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'new_entry')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const {
    customer_id, is_own_stock, old_sku_id, old_quantity, customer_device_description,
    replacement_sku_id, replacement_quantity, problem_description, amount_charged, payment_account, job_date,
    parts, sold_by, sale_type, gst_percentage, additional_amount_paid,
  } = body

  if (!customer_id) return NextResponse.json({ error: 'customer_id is required.' }, { status: 400 })
  if (!replacement_sku_id || !replacement_quantity || replacement_quantity <= 0) {
    return NextResponse.json({ error: 'replacement_sku_id and a positive replacement_quantity are required.' }, { status: 400 })
  }
  if (is_own_stock && (!old_sku_id || !old_quantity || old_quantity <= 0)) {
    return NextResponse.json({ error: 'old_sku_id and a positive old_quantity are required when this is our own stock.' }, { status: 400 })
  }
  if (!is_own_stock && !customer_device_description) {
    return NextResponse.json({ error: 'Device description is required for a customer-owned item.' }, { status: 400 })
  }
  if (job_date && !/^\d{4}-\d{2}-\d{2}$/.test(job_date)) {
    return NextResponse.json({ error: 'job_date must be in YYYY-MM-DD format.' }, { status: 400 })
  }

  // Parts consumed during the swap -- validated up front so a job never gets created
  // only to find out a part is oversold. Same idiom as repair_job_parts/replacement_job_parts.
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

  const resolvedJobDate: string = job_date || new Date().toISOString().slice(0, 10)

  let jobNumber: string
  try {
    jobNumber = await generateReplacementJobNumber()
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to generate job number: ${err.message}` }, { status: 500 })
  }

  // The old item is physically coming back -- reverse it into stock immediately, the
  // same mechanism a bare accessory Return uses (lib/accessory-rma.ts). Runs before the
  // job row is created so a failure here leaves nothing committed.
  if (is_own_stock && old_sku_id) {
    const returnResult = await processAccessoryFromCustomer(old_sku_id, old_quantity, {
      reason: 'Replaced with another item',
      notes: `Replacement job ${jobNumber}`,
      userId: sessionUser.id,
      eventDate: resolvedJobDate,
    })
    if (returnResult.error) {
      return NextResponse.json({ error: returnResult.error }, { status: returnResult.status || 500 })
    }
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
  const amountPaidForItem = Math.min(topUp, saleTotal)

  const { data: job, error: jobErr } = await supabaseAdmin
    .from('accessory_replacement_jobs')
    .insert({
      job_number: jobNumber,
      customer_id,
      is_own_stock: !!is_own_stock,
      old_sku_id: is_own_stock ? old_sku_id : null,
      old_quantity: is_own_stock ? old_quantity : null,
      customer_device_description: is_own_stock ? null : customer_device_description,
      replacement_sku_id,
      replacement_quantity,
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
    accessory_id: replacement_sku_id,
    accessory_quantity: replacement_quantity,
    sale_base_price: saleBasePrice,
  }

  const result = await processSingleSaleItem(item, baseSaleFields, gstPct, sessionUser.id)
  if (!result.ok) {
    await supabaseAdmin.from('accessory_replacement_jobs').delete().eq('id', job.id)
    return NextResponse.json({ error: result.message }, { status: result.status })
  }

  await supabaseAdmin.from('accessory_replacement_jobs').update({ sale_id: result.saleRow.id }).eq('id', job.id)

  if (amountPaidForItem > 0) {
    const { error: paymentErr } = await supabaseAdmin.from('sale_payments').insert({
      sale_id: result.saleRow.id,
      amount: amountPaidForItem,
      payment_account: payment_account || 'Digitalbluez',
      note: 'Recorded at replacement job creation',
      recorded_by: sessionUser.id,
    })
    if (paymentErr) {
      return NextResponse.json({ error: `Job created but recording payment failed: ${paymentErr.message}.` }, { status: 500 })
    }
  }

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
        notes: `Used in accessory replacement job ${jobNumber}`,
        created_by: sessionUser.id,
      })
      .select('id')
      .single()
    if (!moveErr && movement) {
      await supabaseAdmin.from('accessory_replacement_job_parts').insert({
        accessory_replacement_job_id: job.id,
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
    tableName: 'accessory_replacement_jobs',
    recordId: job.id,
    recordLabel: job.job_number,
  })

  return NextResponse.json({ success: true, id: job.id, job_number: job.job_number }, { status: 201 })
}

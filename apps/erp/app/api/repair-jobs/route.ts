import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { generateRepairJobNumber, SELLABLE_STATUSES } from '@/lib/repair-jobs'
import { parsePagination } from '@/lib/pagination'

// ---------- GET: list repair jobs ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'repair_jobs')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const pagination = parsePagination(searchParams)

  let query = supabaseAdmin
    .from('repair_jobs')
    .select('*, customers(customer_name, phone)', pagination ? { count: 'exact' } : undefined)
    .order('created_at', { ascending: false })

  if (status) query = query.in('status', status.split(',').map(s => s.trim()))
  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (pagination) return NextResponse.json({ data, total: count ?? 0 })
  return NextResponse.json(data)
}

// ---------- POST: intake a repair, replacement, or DB-repair job ----------
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'new_entry')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const {
    customer_id, is_own_stock, asset_id, customer_device_description, customer_device_serial,
    job_type, replacement_asset_id, problem_description, amount_charged, payment_account, job_date,
    parts,
  } = body

  if (!customer_id) return NextResponse.json({ error: 'customer_id is required.' }, { status: 400 })
  if (!['repair', 'replacement'].includes(job_type)) {
    return NextResponse.json({ error: "job_type must be 'repair' or 'replacement'." }, { status: 400 })
  }
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
  // keyboard, etc.) -- validated up front so a job never gets created only to find
  // out a part is oversold. repair_job_parts links back to the exact stock_movements
  // row it produced, same idiom as every other stock-affecting action in this app.
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
  // supply job_date; defaults to today. The replacement unit's sold_at (if any) uses
  // the same date so it's consistent with the job it's tied to.
  const resolvedJobDate: string = job_date || new Date().toISOString().slice(0, 10)
  const jobDateIso = `${resolvedJobDate}T12:00:00.000Z`

  // A replacement swap is final immediately, same as a sale (Part 6/7's "employee entry
  // is real the moment it happens" principle) -- the unit goes straight to 'sold', not a
  // 'pending_replacement' gate waiting on the owner. Nothing else can move this unit's
  // status for this job (see the atomic status-guarded update below).
  let lockedReplacementId: string | null = null
  let replacementSkuId: string | null = null
  if (job_type === 'replacement') {
    if (!replacement_asset_id) {
      return NextResponse.json({ error: 'replacement_asset_id is required for a replacement job.' }, { status: 400 })
    }
    const { data: replacement } = await supabaseAdmin
      .from('asset_ledger')
      .select('id, status, sku_id')
      .eq('id', replacement_asset_id)
      .single()
    if (!replacement) return NextResponse.json({ error: 'Replacement unit not found.' }, { status: 404 })
    if (!SELLABLE_STATUSES.includes(replacement.status)) {
      return NextResponse.json({ error: `Replacement unit is '${replacement.status}' and not available.` }, { status: 400 })
    }
    const { data: locked, error: lockErr } = await supabaseAdmin
      .from('asset_ledger')
      .update({ status: 'sold', sold_at: jobDateIso })
      .eq('id', replacement_asset_id)
      .in('status', SELLABLE_STATUSES)
      .select('id')
      .maybeSingle()
    if (lockErr) return NextResponse.json({ error: lockErr.message }, { status: 500 })
    if (!locked) return NextResponse.json({ error: 'That unit was just taken by someone else. Please pick another.' }, { status: 409 })
    lockedReplacementId = replacement_asset_id
    replacementSkuId = replacement.sku_id
  }

  let jobNumber: string
  try {
    jobNumber = await generateRepairJobNumber()
  } catch (err: any) {
    if (lockedReplacementId) await supabaseAdmin.from('asset_ledger').update({ status: 'ready_for_sale' }).eq('id', lockedReplacementId)
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
      job_type,
      replacement_asset_id: lockedReplacementId,
      problem_description,
      amount_charged: amount_charged ?? null,
      payment_account: payment_account || null,
      entered_by: sessionUser.id,
      job_date: resolvedJobDate,
    })
    .select('id, job_number')
    .single()

  if (jobErr) {
    if (lockedReplacementId) await supabaseAdmin.from('asset_ledger').update({ status: 'ready_for_sale', sold_at: null }).eq('id', lockedReplacementId)
    return NextResponse.json({ error: jobErr.message }, { status: 500 })
  }

  // sku_master.quantity_in_stock is decremented atomically by the existing
  // trg_sync_sku_stock trigger on this insert -- the replacement unit just left stock.
  if (replacementSkuId) {
    await supabaseAdmin.from('stock_movements').insert({
      sku_id: replacementSkuId,
      movement_type: 'sale',
      quantity_change: -1,
      notes: `Given as replacement -- job ${jobNumber}`,
      created_by: sessionUser.id,
    })
  }

  for (const part of partsToConsume) {
    const { data: movement, error: moveErr } = await supabaseAdmin
      .from('stock_movements')
      .insert({
        sku_id: part.sku_id,
        movement_type: 'sale',
        quantity_change: -part.quantity,
        notes: `Used in repair job ${jobNumber}`,
        created_by: sessionUser.id,
      })
      .select('id')
      .single()
    if (!moveErr && movement) {
      await supabaseAdmin.from('repair_job_parts').insert({
        repair_job_id: job.id,
        sku_id: part.sku_id,
        quantity: part.quantity,
        stock_movement_id: movement.id,
      })
    }
  }

  return NextResponse.json({ success: true, id: job.id, job_number: job.job_number }, { status: 201 })
}

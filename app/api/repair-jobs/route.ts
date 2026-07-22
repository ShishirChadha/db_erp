import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser } from '@/lib/auth/session'
import { generateRepairJobNumber, SELLABLE_STATUSES } from '@/lib/repair-jobs'

// ---------- GET: list repair jobs ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')

  let query = supabaseAdmin
    .from('repair_jobs')
    .select('*, customers(customer_name, phone)')
    .order('created_at', { ascending: false })

  if (status) query = query.in('status', status.split(',').map(s => s.trim()))

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

// ---------- POST: intake a repair, replacement, or DB-repair job ----------
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    customer_id, is_own_stock, asset_id, customer_device_description, customer_device_serial,
    job_type, replacement_asset_id, problem_description, amount_charged, payment_account,
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
      .update({ status: 'sold', sold_at: new Date().toISOString() })
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

  return NextResponse.json({ success: true, id: job.id, job_number: job.job_number }, { status: 201 })
}

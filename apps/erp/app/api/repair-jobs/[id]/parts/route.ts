import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, canEditPage } from '@/lib/auth/session'
import { resolveRepairGstPercent, consumeRepairParts } from '@/lib/repair-jobs'

// ---------- POST: add a part to an existing job (after intake) ----------
// Real repairs often discover a needed part mid-job, after diagnosis -- this is the
// same consumeRepairParts machinery intake uses (POST /api/repair-jobs), just scoped
// to a job that already exists. Immediately real: stock leaves and the accessory sale
// is created the moment this is called, same as at intake.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPage(sessionUser, 'repair_jobs')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { sku_id, quantity, unit_price } = body

  if (!sku_id || !(quantity > 0)) {
    return NextResponse.json({ error: 'sku_id and a positive quantity are required.' }, { status: 400 })
  }

  const { data: job } = await supabaseAdmin
    .from('repair_jobs')
    .select('id, job_number, status, customer_id, payment_account, gst_percentage, job_date, customers(customer_name)')
    .eq('id', id)
    .single()
  if (!job) return NextResponse.json({ error: 'Repair job not found' }, { status: 404 })
  if (job.status === 'cancelled') return NextResponse.json({ error: 'This job is cancelled.' }, { status: 400 })
  if (!job.payment_account) {
    return NextResponse.json({ error: 'Set "Received Into" on this job before adding priced parts.' }, { status: 400 })
  }

  const customer = Array.isArray(job.customers) ? job.customers[0] : job.customers
  const gstPct = await resolveRepairGstPercent(job.payment_account, job.gst_percentage)

  const result = await consumeRepairParts({
    jobId: job.id,
    jobNumber: job.job_number,
    customerId: job.customer_id,
    customerName: customer?.customer_name || null,
    paymentAccount: job.payment_account,
    gstPercent: gstPct,
    saleDate: job.job_date || new Date().toISOString().slice(0, 10),
    parts: [{ sku_id, quantity: Number(quantity), unit_price: Number(unit_price) || 0 }],
    sessionUserId: sessionUser.id,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.message, item_errors: result.itemErrors }, { status: result.status })
  }

  return NextResponse.json({ success: true, sale_id: result.saleIds[0] }, { status: 201 })
}

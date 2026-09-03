import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, canEditPage } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { resolveRepairGstPercent } from '@/lib/repair-jobs'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// ---------- POST: marks a repair job done ----------
// Status is an operational field (see PATCH route), so this only requires the
// repair_jobs page-edit grant, not owner -- finalizing is a status flip, not a
// payment edit.
// Inventory for a replacement job -- both the swapped-in unit's sale and the
// swapped-out unit's return to QC -- is already settled at job intake
// (POST /api/repair-jobs) -- this route only closes out the job record.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPage(sessionUser, 'repair_jobs')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params

  const { data: job } = await supabaseAdmin
    .from('repair_jobs')
    .select('id, status, job_number, customer_id, problem_description, amount_charged, amount_paid, payment_account, gst_percentage')
    .eq('id', id)
    .single()

  if (!job) return NextResponse.json({ error: 'Repair job not found' }, { status: 404 })
  if (job.status === 'done') return NextResponse.json({ error: 'Already finalized.' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('repair_jobs')
    .update({ status: 'done', finalized_by: sessionUser.id, finalized_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'status_change',
    module: 'repair_jobs',
    tableName: 'repair_jobs',
    recordId: id,
    recordLabel: job.job_number,
  })

  // Bring the repair charge into the Sales Ledger the moment the job is done, so it
  // can be combined with any other sale for this customer into one invoice via the
  // existing multi-item invoice flow (POST /api/sales/finalize-batch). A job with
  // nothing to charge (warranty/free fix) or no payment_account set never gets a
  // sales row -- this never blocks the Done transition itself.
  if (job.amount_charged && job.amount_charged > 0 && job.payment_account) {
    const today = new Date()
    const saleDateObj = new Date(`${today.toISOString().slice(0, 10)}T12:00:00.000Z`)

    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('customer_name')
      .eq('id', job.customer_id)
      .single()

    // GST applies exactly when the resolved entity is GST-registered (Digitalbluez
    // today) -- shared with part-sale creation (lib/repair-jobs.ts) so both compute
    // GST identically, never a hardcoded account name.
    const gstPct = await resolveRepairGstPercent(job.payment_account, job.gst_percentage)
    const gstAmount = gstPct > 0 ? Math.round(job.amount_charged * gstPct) / 100 : 0
    const saleTotal = job.amount_charged + gstAmount

    const { data: sale, error: saleErr } = await supabaseAdmin
      .from('sales')
      .insert({
        repair_job_id: job.id,
        customer_id: job.customer_id,
        customer_name: customer?.customer_name || null,
        sale_date: today.toISOString().slice(0, 10),
        sale_month: MONTHS[saleDateObj.getUTCMonth()],
        sale_year: saleDateObj.getUTCFullYear(),
        sale_type: gstPct > 0 ? 'GST' : 'Cash',
        sale_base_price: job.amount_charged,
        sale_gst: gstAmount,
        sale_total: saleTotal,
        payment_account: job.payment_account,
        entered_by: sessionUser.id,
        finalized: false,
      })
      .select('id')
      .single()

    if (!saleErr && sale) {
      // Carry over anything already collected while the job was in progress as an
      // initial payment leg, rather than writing sales.amount_paid directly -- the
      // sync_sale_payment_totals trigger derives it from sale_payments.
      if (job.amount_paid && job.amount_paid > 0) {
        await supabaseAdmin.from('sale_payments').insert({
          sale_id: sale.id,
          amount: job.amount_paid,
          payment_account: job.payment_account,
          note: `Carried over from repair intake (Job ${job.job_number})`,
          recorded_by: sessionUser.id,
        })
      }

      await logAuditEvent({
        actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
        actionType: 'create',
        module: 'sales',
        tableName: 'sales',
        recordId: sale.id,
        recordLabel: customer?.customer_name || job.job_number,
        metadata: { repair_job_id: job.id, job_number: job.job_number },
        reason: 'Repair job marked done -- charge added to Sales Ledger',
      })
    }
  }

  return NextResponse.json({ success: true })
}

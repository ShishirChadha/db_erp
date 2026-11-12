import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, canEditPage, isOwner } from '@/lib/auth/session'
import { resolveRepairGstPercent, consumeRepairParts } from '@/lib/repair-jobs'
import { reverseSaleInventoryEffects } from '@/lib/sales-entry'
import { insertAccessoryMovement } from '@/lib/accessory-movements'
import { NON_STOCK_CATEGORIES } from '@/lib/sku-categories'
import { checkPeriodLock, periodLockedResponse } from '@/lib/period-lock'
import { logFieldCorrections } from '@/lib/field-corrections'
import { logAuditEvent } from '@/lib/audit-log'

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
  const { sku_id, quantity, unit_price, sale_date } = body

  if (!sku_id || !(quantity > 0)) {
    return NextResponse.json({ error: 'sku_id and a positive quantity are required.' }, { status: 400 })
  }
  if (sale_date !== undefined && sale_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(sale_date)) {
    return NextResponse.json({ error: 'sale_date must be in YYYY-MM-DD format.' }, { status: 400 })
  }

  const { data: job } = await supabaseAdmin
    .from('repair_jobs')
    .select('id, job_number, status, customer_id, payment_account, gst_percentage, job_date, is_own_stock, customer_device_serial, customers(customer_name)')
    .eq('id', id)
    .single()
  if (!job) return NextResponse.json({ error: 'Repair job not found' }, { status: 404 })
  if (job.status === 'cancelled') return NextResponse.json({ error: 'This job is cancelled.' }, { status: 400 })
  // No customer on this job (an internal fix on our own stock, see POST /api/repair-jobs)
  // means a part is a plain unpriced stock adjustment, not a sale -- no invoicing entity
  // needed. Only a customer-billed job requires "Received Into" before adding a part.
  if (job.customer_id && !job.payment_account) {
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
    // A part is normally dated to job_date, but the caller can override it (e.g. a part
    // added today for a job that happened earlier, without needing a separate job_date
    // backdate -- see PATCH /api/repair-jobs/[id]'s cascade for the complementary case
    // where job_date itself is corrected after the fact).
    saleDate: sale_date || job.job_date || new Date().toISOString().slice(0, 10),
    parts: [{ sku_id, quantity: Number(quantity), unit_price: Number(unit_price) || 0 }],
    sessionUserId: sessionUser.id,
    customerDeviceSerial: job.is_own_stock ? null : job.customer_device_serial,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.message, item_errors: result.itemErrors }, { status: result.status })
  }

  return NextResponse.json({ success: true, sale_id: result.saleIds[0] }, { status: 201 })
}

// ---------- DELETE: remove a part that was added to a job in error ----------
// Owner-only, matching the generic sale /void convention this reuses -- removing a
// part reverses real money/stock, not an operational edit like status or problem
// description (those stay on the repair_jobs page-edit grant). A priced part voids its
// linked sale exactly like /api/sales/[id]/void (same period-lock/already-invoiced
// guards); an unpriced/internal part (sale_id null, see consumeRepairParts) just
// reverses its own stock adjustment. Either way the repair_job_parts row is deleted
// afterward so it stops showing in "Parts Installed."
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const partId = body.part_id
  const reason = (body.reason || '').trim()
  if (!partId) return NextResponse.json({ error: 'part_id is required.' }, { status: 400 })
  if (!reason) return NextResponse.json({ error: 'A reason is required to remove a part.' }, { status: 400 })

  const { data: part } = await supabaseAdmin
    .from('repair_job_parts')
    .select('*')
    .eq('id', partId)
    .eq('repair_job_id', id)
    .single()
  if (!part) return NextResponse.json({ error: 'Part not found on this job.' }, { status: 404 })

  if (part.sale_id) {
    const { data: sale } = await supabaseAdmin.from('sales').select('*').eq('id', part.sale_id).single()
    if (sale && !sale.is_deleted) {
      const lock = await checkPeriodLock('sales', sale.effective_sale_date || sale.sale_date, sale.payment_account)
      if (lock.locked) return NextResponse.json(periodLockedResponse(lock), { status: 409 })

      if (sale.finalized && !body.confirm_despite_invoice) {
        return NextResponse.json({
          error: `This part is already invoiced (${sale.invoice_number || sale.invoice_id}) -- removing it will NOT retract or update that invoice, which will then disagree with the (now removed) part. Confirm to proceed anyway.`,
          error_code: 'already_invoiced',
        }, { status: 409 })
      }

      const { error: reverseErr } = await reverseSaleInventoryEffects(sale, {
        reason: `Repair part removed -- ${reason}`,
        userId: sessionUser.id,
      })
      if (reverseErr) {
        const status = reverseErr.includes('no longer in') ? 409 : (reverseErr.includes('not found') ? 404 : 500)
        return NextResponse.json({ error: reverseErr }, { status })
      }

      await supabaseAdmin.from('sales').update({ is_deleted: true }).eq('id', sale.id)

      const fieldCorrectionIds = await logFieldCorrections(
        'sales', sale.id,
        [{ field: 'is_deleted', oldValue: false, newValue: true }],
        sessionUser.id, reason
      )
      await logAuditEvent({
        actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
        actionType: 'void',
        module: 'sales',
        tableName: 'sales',
        recordId: sale.id,
        recordLabel: sale.invoice_number || sale.id,
        fieldCorrectionIds,
        reason,
      })
    }
  } else {
    const { data: sku } = await supabaseAdmin.from('sku_master').select('category').eq('id', part.sku_id).maybeSingle()
    if (!NON_STOCK_CATEGORIES.includes(sku?.category)) {
      const { error: moveErr } = await insertAccessoryMovement({
        skuId: part.sku_id,
        movementType: 'adjustment',
        quantityChange: part.quantity,
        notes: `Repair part removed -- ${reason}`,
        createdBy: sessionUser.id,
      })
      if (moveErr) return NextResponse.json({ error: moveErr.message }, { status: 400 })
    }
  }

  await supabaseAdmin.from('repair_job_parts').delete().eq('id', partId)

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'soft_delete',
    module: 'repair_jobs',
    tableName: 'repair_job_parts',
    recordId: partId,
    recordLabel: `Part removed from job ${id}`,
    reason,
  })

  return NextResponse.json({ success: true })
}

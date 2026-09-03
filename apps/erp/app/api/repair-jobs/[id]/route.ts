import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, canEditPage } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { resolveEntityKey } from '@/lib/invoice-finalize'

// ---------- GET: one job's full detail -- every linked sale (labor charge + one per
// consumed part), itemized, plus the parts themselves for display ----------
// Deliberately separate from the list GET (which only returns lightweight aggregates,
// see app/api/repair-jobs/route.ts) -- EditRepairJobDialog fetches this on open rather
// than the list route joining repair_job_parts/sku_master for every row all the time.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'repair_jobs')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params

  const { data: job, error: jobErr } = await supabaseAdmin
    .from('repair_jobs')
    .select('*, customers(customer_name, phone)')
    .eq('id', id)
    .single()
  if (jobErr || !job) return NextResponse.json({ error: 'Repair job not found' }, { status: 404 })

  const { data: sales } = await supabaseAdmin
    .from('sales')
    .select('id, accessory_id, finalized, invoice_id, invoice_number, sale_total, sale_gst, sale_base_price, amount_paid, payment_status, payment_account')
    .eq('repair_job_id', id)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true })

  const { data: parts } = await supabaseAdmin
    .from('repair_job_parts')
    .select('id, sku_id, quantity, sale_id, sku_master(full_sku_code, sku_description)')
    .eq('repair_job_id', id)

  const partBySaleId = new Map((parts || []).filter((p: any) => p.sale_id).map((p: any) => [p.sale_id, p]))
  const { data: profiles } = await supabaseAdmin.from('business_profiles').select('key, invoicing_mode')
  const modeByKey = new Map((profiles || []).map((p: any) => [p.key, p.invoicing_mode]))

  const saleLines = (sales || []).map((s: any) => {
    const part = partBySaleId.get(s.id)
    const sku = part ? (Array.isArray(part.sku_master) ? part.sku_master[0] : part.sku_master) : null
    return {
      ...s,
      kind: part ? 'part' : 'labor',
      label: part ? `Part: ${sku?.sku_description || sku?.full_sku_code || 'Accessory'} x${part.quantity}` : 'Repair charge',
      invoice_mode: modeByKey.get(resolveEntityKey(s.payment_account)) === 'external' ? 'external' : 'erp',
    }
  })

  const partsInstalled = (parts || []).map((p: any) => {
    const sku = Array.isArray(p.sku_master) ? p.sku_master[0] : p.sku_master
    const sale = (sales || []).find((s: any) => s.id === p.sale_id)
    return {
      id: p.id,
      sku_id: p.sku_id,
      label: sku?.sku_description || sku?.full_sku_code || 'Accessory',
      quantity: p.quantity,
      unit_price: sale ? sale.sale_base_price / (p.quantity || 1) : null,
      sale_id: p.sale_id,
      payment_status: sale?.payment_status ?? null,
      finalized: sale?.finalized ?? null,
    }
  })

  return NextResponse.json({ ...job, sale_lines: saleLines, parts_installed: partsInstalled })
}

// ---------- PATCH: update workflow/payment state on a repair job ----------
// Both operational fields (status/problem/solution) and financial fields
// (payment status/amount/account/charge) require the repair_jobs page-edit
// grant (View-only staff can see the job but not change it -- see
// profile_page_actions / canEditPage). Unlike most money fields elsewhere in
// the app, repair job payments are not owner-only -- anyone granted edit
// access to this page can record them, same as sale_payments.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'repair_jobs')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json()

  const operationalFields = ['status', 'solution_description', 'problem_description', 'customer_device_description', 'customer_device_serial', 'job_date']
  const financialFields = ['payment_status', 'amount_paid', 'amount_charged', 'payment_account', 'gst_percentage']
  const editableFields = [...operationalFields, ...financialFields]

  const hasEdit = editableFields.some((key) => body[key] !== undefined)
  if (hasEdit && !canEditPage(sessionUser, 'repair_jobs')) {
    return NextResponse.json({ error: 'View-only access.' }, { status: 403 })
  }

  const updates: Record<string, any> = {}
  for (const key of editableFields) {
    if (body[key] !== undefined) updates[key] = body[key]
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
  }
  // Finalizing a job (status flips to 'done') goes through /finalize instead, so the
  // finalized_by/finalized_at bookkeeping always happens together with the status flip.
  if (updates.status === 'done') {
    return NextResponse.json({ error: "Use POST /api/repair-jobs/[id]/finalize to mark a job done." }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('repair_jobs')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'status' in updates ? 'status_change' : 'update',
    module: 'repair_jobs',
    tableName: 'repair_jobs',
    recordId: id,
    recordLabel: data.job_number,
  })

  return NextResponse.json(data)
}

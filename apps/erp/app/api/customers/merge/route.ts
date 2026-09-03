import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- POST: merge a duplicate customer into another ----------
// Folds `source_id` (the duplicate) into `target_id` (the one to keep): every sale/
// invoice/sales_document/repair_job/replacement_job/customer_profiles row pointing at
// source_id is repointed at target_id (sales/invoices/sales_documents also get their
// frozen customer_name snapshot corrected to target's current name -- see CLAUDE.md's
// note on sales.customer_name and lib/customer-summary.ts), then source is soft-deleted
// with a remark explaining the merge. Same operation as the one-off SQL used to clean up
// the initial duplicate backlog (2026-09-02), now a reusable, staff-facing action --
// same "customers" page access as Add/Edit Customer (no owner-only gate: customer data
// is edited/deleted freely by any signed-in staff today, and merging is just a more
// thorough correction of the same kind).
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'customers')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { source_id: sourceId, target_id: targetId } = body as { source_id?: string; target_id?: string }

  if (!sourceId || !targetId) {
    return NextResponse.json({ error: 'source_id and target_id are required' }, { status: 400 })
  }
  if (sourceId === targetId) {
    return NextResponse.json({ error: 'Cannot merge a customer into itself' }, { status: 400 })
  }

  const { data: customers, error: fetchErr } = await supabaseAdmin
    .from('customers')
    .select('id, customer_name, is_deleted')
    .in('id', [sourceId, targetId])
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })

  const source = (customers || []).find((c) => c.id === sourceId)
  const target = (customers || []).find((c) => c.id === targetId)
  if (!source) return NextResponse.json({ error: 'Customer to merge away was not found.' }, { status: 404 })
  if (!target) return NextResponse.json({ error: 'Customer to keep was not found.' }, { status: 404 })
  if (source.is_deleted) return NextResponse.json({ error: 'That customer is already deleted.' }, { status: 400 })
  if (target.is_deleted) return NextResponse.json({ error: 'Cannot merge into a deleted customer.' }, { status: 400 })

  const nameSnapshot = { customer_id: targetId, customer_name: target.customer_name }

  const [salesRes, invoicesRes, docsRes, repairRes, replacementRes, profilesRes] = await Promise.all([
    supabaseAdmin.from('sales').update(nameSnapshot).eq('customer_id', sourceId).select('id'),
    supabaseAdmin.from('invoices').update(nameSnapshot).eq('customer_id', sourceId).select('id'),
    supabaseAdmin.from('sales_documents').update(nameSnapshot).eq('customer_id', sourceId).select('id'),
    supabaseAdmin.from('repair_jobs').update({ customer_id: targetId }).eq('customer_id', sourceId).select('id'),
    supabaseAdmin.from('replacement_jobs').update({ customer_id: targetId }).eq('customer_id', sourceId).select('id'),
    supabaseAdmin.from('customer_profiles').update({ customer_id: targetId }).eq('customer_id', sourceId).select('id'),
  ])
  for (const res of [salesRes, invoicesRes, docsRes, repairRes, replacementRes, profilesRes]) {
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 })
  }

  const remark = `Merged into "${target.customer_name}" (${targetId}) by ${sessionUser.email || sessionUser.id} on ${new Date().toISOString().slice(0, 10)}`
  const { error: deleteErr } = await supabaseAdmin
    .from('customers')
    .update({ is_deleted: true, deleted_remarks: remark, deleted_at: new Date().toISOString() })
    .eq('id', sourceId)
  if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'soft_delete',
    module: 'customers',
    tableName: 'customers',
    recordId: sourceId,
    recordLabel: source.customer_name,
    reason: 'Merged as duplicate customer',
    metadata: {
      merged_into_id: targetId,
      merged_into_name: target.customer_name,
      moved_counts: {
        sales: salesRes.data?.length ?? 0,
        invoices: invoicesRes.data?.length ?? 0,
        sales_documents: docsRes.data?.length ?? 0,
        repair_jobs: repairRes.data?.length ?? 0,
        replacement_jobs: replacementRes.data?.length ?? 0,
        customer_profiles: profilesRes.data?.length ?? 0,
      },
    },
  })

  return NextResponse.json({
    success: true,
    target_id: targetId,
    moved_counts: {
      sales: salesRes.data?.length ?? 0,
      invoices: invoicesRes.data?.length ?? 0,
      sales_documents: docsRes.data?.length ?? 0,
      repair_jobs: repairRes.data?.length ?? 0,
      replacement_jobs: replacementRes.data?.length ?? 0,
      customer_profiles: profilesRes.data?.length ?? 0,
    },
  })
}

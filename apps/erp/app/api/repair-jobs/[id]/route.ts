import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, canEditPage } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

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

  const operationalFields = ['status', 'solution_description', 'problem_description']
  const financialFields = ['payment_status', 'amount_paid', 'amount_charged', 'payment_account']
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

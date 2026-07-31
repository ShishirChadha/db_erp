import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner, hasPageAccess, canEditPage } from '@/lib/auth/session'

// ---------- PATCH: update workflow/payment-account state on a replacement job ----------
// Operational fields (status/problem_description) require the replacement_jobs page-edit
// grant. Financial fields here are just amount_charged/payment_account -- unlike repair_jobs,
// there's no payment_status/amount_paid on this table to edit, since a replacement's real
// payment lives on its linked `sales` row (sale_payments ledger) -- corrections to that go
// through the Sales/Invoices pages, not here.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'replacement_jobs')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json()

  const operationalFields = ['status', 'solution_description', 'problem_description']
  const financialFields = ['amount_charged', 'payment_account']

  const hasOperationalEdit = operationalFields.some((key) => body[key] !== undefined)
  if (hasOperationalEdit && !canEditPage(sessionUser, 'replacement_jobs')) {
    return NextResponse.json({ error: 'View-only access.' }, { status: 403 })
  }

  const updates: Record<string, any> = {}
  for (const key of operationalFields) {
    if (body[key] !== undefined) updates[key] = body[key]
  }
  for (const key of financialFields) {
    if (body[key] !== undefined) {
      if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Only the owner can edit payment details.' }, { status: 403 })
      updates[key] = body[key]
    }
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
  }
  // Finalizing a job (status flips to 'done') goes through /finalize instead, so the
  // finalized_by/finalized_at bookkeeping always happens together with the status flip.
  if (updates.status === 'done') {
    return NextResponse.json({ error: "Use POST /api/replacement-jobs/[id]/finalize to mark a job done." }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('replacement_jobs')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

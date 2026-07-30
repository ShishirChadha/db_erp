import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// ---------- PATCH: update workflow/payment state on a repair job ----------
// Operational fields (status/problem/solution) can be updated by whoever's doing the
// work. Financial fields (payment status/amount/account/charge) are owner-only, same
// restriction as everywhere else money is involved.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()

  const operationalFields = ['status', 'solution_description', 'problem_description']
  const financialFields = ['payment_status', 'amount_paid', 'amount_charged', 'payment_account']

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
    return NextResponse.json({ error: "Use POST /api/repair-jobs/[id]/finalize to mark a job done." }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('repair_jobs')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

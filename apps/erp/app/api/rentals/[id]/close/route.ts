import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, canEditPage } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// Closes an agreement. Every unit must be settled first (returned, bought out, or
// written off) -- closing with stock still in a customer's hands would strand those
// units in on_rent with nothing left tracking them.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPage(sessionUser, 'rentals')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params

  const { data: agreement } = await supabaseAdmin
    .from('rental_agreements')
    .select('id, agreement_number, status, is_deleted, rental_agreement_items ( id, item_status )')
    .eq('id', id)
    .single()
  if (!agreement || agreement.is_deleted) {
    return NextResponse.json({ error: 'Rental agreement not found' }, { status: 404 })
  }
  if (agreement.status === 'closed') return NextResponse.json({ error: 'Already closed.' }, { status: 400 })

  const stillOut = ((agreement as any).rental_agreement_items || []).filter((i: any) => i.item_status === 'on_rent')
  if (stillOut.length > 0) {
    return NextResponse.json(
      { error: `${stillOut.length} unit(s) are still out on rent -- record the return or buyout first.` },
      { status: 400 }
    )
  }

  const { error } = await supabaseAdmin
    .from('rental_agreements')
    .update({ status: 'closed', actual_closed_at: new Date().toISOString(), next_billing_date: null })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'status_change',
    module: 'rentals',
    tableName: 'rental_agreements',
    recordId: id,
    recordLabel: agreement.agreement_number,
    reason: 'Rental agreement closed',
  })

  return NextResponse.json({ success: true })
}

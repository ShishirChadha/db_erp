import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, canEditPage } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { returnUnit } from '@/lib/rentals'

// Takes one rented unit back. The unit goes to qc_pending (NOT straight back to
// ready_for_sale) -- it has been in a customer's hands, so it is re-checked before
// being sold or re-rented. Operational, so page-edit grant rather than owner.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPage(sessionUser, 'rentals')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id, itemId } = await params
  const body = await req.json().catch(() => ({}))
  const condition = typeof body?.return_condition_notes === 'string' ? body.return_condition_notes : null
  const lost = body?.lost_damaged === true

  const { data: item } = await supabaseAdmin
    .from('rental_agreement_items')
    .select('id, agreement_id, asset_id, item_status, rental_agreements ( agreement_number )')
    .eq('id', itemId)
    .eq('agreement_id', id)
    .single()
  if (!item) return NextResponse.json({ error: 'Rental unit not found on this agreement.' }, { status: 404 })
  if (item.item_status !== 'on_rent') {
    return NextResponse.json({ error: `This unit is already marked '${item.item_status}'.` }, { status: 400 })
  }

  const agreementNumber = (item as any).rental_agreements?.agreement_number || 'rental'

  if (lost) {
    // Never came back: the unit is written off. The handover decrement already
    // removed it from stock, so there is deliberately no movement to write here.
    const { data: scrapped } = await supabaseAdmin
      .from('asset_ledger')
      .update({ status: 'scrapped' })
      .eq('id', item.asset_id)
      .eq('status', 'on_rent')
      .select('id')
      .maybeSingle()
    if (!scrapped) return NextResponse.json({ error: 'This unit is no longer out on rent.' }, { status: 409 })
  } else {
    const result = await returnUnit(item.asset_id, agreementNumber, sessionUser.id)
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status || 400 })
  }

  const { error: itemErr } = await supabaseAdmin
    .from('rental_agreement_items')
    .update({
      item_status: lost ? 'lost_damaged' : 'returned',
      returned_at: new Date().toISOString(),
      return_condition_notes: condition,
    })
    .eq('id', itemId)
  if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'status_change',
    module: 'rentals',
    tableName: 'rental_agreement_items',
    recordId: itemId,
    recordLabel: agreementNumber,
    reason: lost ? 'Rented unit written off as lost/damaged' : 'Rented unit returned -- back into QC',
  })

  return NextResponse.json({ success: true })
}

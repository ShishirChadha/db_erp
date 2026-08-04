import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logFieldCorrections } from '@/lib/field-corrections'
import { logAuditEvent } from '@/lib/audit-log'
import { reverseSaleInventoryEffects } from '@/lib/sales-entry'

// ---------- POST: owner voids a sale (bookkeeping correction, not a physical return) ----------
// Distinct from the RMA "from_customer" flow (app/api/rma/route.ts), which is for a unit
// that physically came back and needs re-QC. Void is for a sale that was wrong from the
// start (test entry, mis-click, duplicate) -- the unit never left, so it goes straight
// back to 'ready_for_sale' rather than through qc_pending. Reverses inventory via the same
// 'adjustment' stock_movements idiom already used by PO hard-delete / SKU reassignment,
// then soft-deletes the sale (sales.is_deleted, already filtered out of every list query)
// and logs the correction with the owner's reason.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const reason = (body.reason || '').trim()
  if (!reason) return NextResponse.json({ error: 'A reason is required to void a sale.' }, { status: 400 })

  const { data: existing } = await supabaseAdmin.from('sales').select('*').eq('id', id).single()
  if (!existing) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
  if (existing.is_deleted) return NextResponse.json({ error: 'This sale is already voided.' }, { status: 400 })

  if (existing.finalized && !body.confirm_despite_invoice) {
    return NextResponse.json({
      error: `This sale is already invoiced (${existing.invoice_number || existing.invoice_id}) -- voiding it will NOT retract or update that invoice, which will then disagree with the (now voided) sale. Confirm to proceed anyway.`,
      error_code: 'already_invoiced',
    }, { status: 409 })
  }

  // Reverses the same inventory effects a cart-checkout rollback undoes (see
  // lib/sales-entry.ts). If the unit is no longer 'sold', reverseSaleInventoryEffects
  // checks whether that's because it was already physically returned (RMA
  // 'from_customer' already reconciled the same inventory effects) -- if so this is a
  // no-op success; otherwise it bails rather than silently clobbering whatever state
  // the unit is actually in now.
  const { error: reverseErr } = await reverseSaleInventoryEffects(existing, {
    reason: `Sale voided -- ${reason}`,
    userId: sessionUser.id,
  })
  if (reverseErr) {
    const status = reverseErr.includes('no longer in') ? 409 : (reverseErr.includes('not found') ? 404 : 500)
    return NextResponse.json({ error: reverseErr }, { status })
  }

  const { error: updateErr } = await supabaseAdmin.from('sales').update({ is_deleted: true }).eq('id', id)
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  const fieldCorrectionIds = await logFieldCorrections(
    'sales',
    id,
    [{ field: 'is_deleted', oldValue: false, newValue: true }],
    sessionUser.id,
    reason
  )

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'void',
    module: 'sales',
    tableName: 'sales',
    recordId: id,
    recordLabel: existing.invoice_number || id,
    fieldCorrectionIds,
    reason,
  })

  return NextResponse.json({ success: true })
}

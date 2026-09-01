import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, canEditPage, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { getOwnerOnlyExpenseTypes, isOwnerOnlyType } from '@/lib/owner-only-expense-types'

// ---------- PATCH: edit an expense, or soft-delete/restore it ----------
// Soft-delete/restore are just field updates on this table (is_deleted +
// deleted_remarks/deleted_at), so one handler covers edit, delete, and restore --
// matching the page's existing three actions, all gated by the same 'expenses' edit grant.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPage(sessionUser, 'expenses')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const {
    expense_date, description, type, from_location, to_location, amount, remarks,
    is_deleted, deleted_remarks, payment_account, vendor_id, attachments, paid_by_staff,
  } = body

  // A non-owner is fully denied access to a row whose CURRENT type is owner-only
  // (they can't legitimately have reached it -- GET already excludes it), and
  // can't set/change the type to one either, matching the same rule POST enforces.
  if (!isOwner(sessionUser)) {
    const ownerOnlyTypes = await getOwnerOnlyExpenseTypes()
    if (ownerOnlyTypes.length > 0) {
      const { data: existing } = await supabaseAdmin.from('expenses').select('type').eq('id', id).maybeSingle()
      if (existing && isOwnerOnlyType(existing.type, ownerOnlyTypes)) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
    }
    if (type !== undefined && isOwnerOnlyType(type, ownerOnlyTypes)) {
      return NextResponse.json({ error: 'This expense type is owner-only.' }, { status: 403 })
    }
  }

  const updates: Record<string, any> = {}
  if (expense_date !== undefined) updates.expense_date = expense_date
  if (description !== undefined) updates.description = description
  if (type !== undefined) updates.type = type
  if (from_location !== undefined) updates.from_location = from_location
  if (to_location !== undefined) updates.to_location = to_location
  if (amount !== undefined) updates.amount = Number(amount) || 0
  if (remarks !== undefined) updates.remarks = remarks
  if (payment_account !== undefined) {
    updates.payment_account = payment_account
    updates.entity_key = payment_account ? String(payment_account).toLowerCase() : null
  }
  if (vendor_id !== undefined) updates.vendor_id = vendor_id
  if (attachments !== undefined) updates.attachments = Array.isArray(attachments) ? attachments : []
  if (paid_by_staff !== undefined) updates.paid_by_staff = paid_by_staff || null
  if (is_deleted !== undefined) {
    updates.is_deleted = !!is_deleted
    updates.deleted_remarks = is_deleted ? (deleted_remarks || null) : null
    updates.deleted_at = is_deleted ? new Date().toISOString() : null
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('expenses')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: is_deleted !== undefined ? (is_deleted ? 'soft_delete' : 'restore') : 'update',
    module: 'expenses',
    tableName: 'expenses',
    recordId: id,
    recordLabel: `${data.type || 'Expense'}: ${data.description} (₹${data.amount})`,
  })

  return NextResponse.json(data)
}

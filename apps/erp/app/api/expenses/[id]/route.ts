import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, canEditPage } from '@/lib/auth/session'

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
    is_deleted, deleted_remarks,
  } = body

  const updates: Record<string, any> = {}
  if (expense_date !== undefined) updates.expense_date = expense_date
  if (description !== undefined) updates.description = description
  if (type !== undefined) updates.type = type
  if (from_location !== undefined) updates.from_location = from_location
  if (to_location !== undefined) updates.to_location = to_location
  if (amount !== undefined) updates.amount = Number(amount) || 0
  if (remarks !== undefined) updates.remarks = remarks
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
  return NextResponse.json(data)
}

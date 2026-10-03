import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

const EDITABLE = [
  'full_name', 'employee_code', 'profile_id', 'join_date', 'default_shift_id',
  'weekly_off_days', 'phone', 'legacy_staff_name', 'notes', 'is_active',
] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const updates: Record<string, any> = {}
  for (const key of EDITABLE) {
    if (body[key] !== undefined) updates[key] = body[key] === '' ? null : body[key]
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('staff').update(updates).eq('id', id).eq('is_deleted', false)
    .select('id, full_name').single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'That login or employee code is already used by another staff member.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Staff member not found.' }, { status: 404 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'attendance',
    tableName: 'staff',
    recordId: id,
    recordLabel: data.full_name,
    metadata: { fields: Object.keys(updates) },
  })

  return NextResponse.json({ success: true, staff: data })
}

// Soft delete only. Punches and days cascade off staff_id, so a hard delete
// would erase attendance history -- exactly the thing this module exists to
// keep. is_deleted also releases the partial unique indexes, so the employee
// code can be reissued.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data, error } = await supabaseAdmin
    .from('staff').update({ is_deleted: true, is_active: false }).eq('id', id)
    .select('id, full_name').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Staff member not found.' }, { status: 404 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'soft_delete',
    module: 'attendance',
    tableName: 'staff',
    recordId: id,
    recordLabel: data.full_name,
    restoreStatus: 'restorable',
  })

  return NextResponse.json({ success: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

const EDITABLE = [
  'name', 'start_time', 'end_time', 'crosses_midnight', 'grace_minutes',
  'half_day_min_minutes', 'full_day_min_minutes', 'weekly_off_days', 'is_active',
] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const updates: Record<string, any> = {}
  for (const k of EDITABLE) if (body[k] !== undefined) updates[k] = body[k]
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('staff_shifts').update(updates).eq('id', id).select('id, name').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Shift not found.' }, { status: 404 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'attendance', tableName: 'staff_shifts',
    recordId: id, recordLabel: data.name, metadata: { fields: Object.keys(updates) },
  })
  return NextResponse.json({ success: true, shift: data })
}

// Deactivate rather than delete: staff.default_shift_id and
// attendance_days.shift_id both point here, and a deleted shift would null out
// the historical record of which schedule a past day was judged against.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data, error } = await supabaseAdmin
    .from('staff_shifts').update({ is_active: false }).eq('id', id).select('id, name').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Shift not found.' }, { status: 404 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'status_change', module: 'attendance', tableName: 'staff_shifts',
    recordId: id, recordLabel: `${data.name} deactivated`,
  })
  return NextResponse.json({ success: true })
}

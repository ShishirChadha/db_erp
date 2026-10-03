import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const updates: Record<string, any> = {}
  for (const k of ['label', 'cidr', 'is_active', 'notes'] as const) {
    if (body[k] !== undefined) updates[k] = body[k]
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('attendance_networks').update(updates).eq('id', id)
    .select('id, label, cidr, is_active').single()
  if (error) {
    if (error.code === '22P02') {
      return NextResponse.json({ error: 'That is not a valid IP address or CIDR range.' }, { status: 400 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Network not found.' }, { status: 404 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'attendance', tableName: 'attendance_networks',
    recordId: id, recordLabel: `${data.label} (${data.cidr})`, metadata: { fields: Object.keys(updates) },
  })
  return NextResponse.json({ success: true, network: data })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data, error } = await supabaseAdmin
    .from('attendance_networks').delete().eq('id', id).select('id, label, cidr').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Network not found.' }, { status: 404 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'hard_delete', module: 'attendance', tableName: 'attendance_networks',
    recordId: id, recordLabel: `${data.label} (${data.cidr})`,
  })
  return NextResponse.json({ success: true })
}

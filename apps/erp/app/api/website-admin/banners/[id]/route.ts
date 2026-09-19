import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const { is_active, sort_order } = body as { is_active?: boolean; sort_order?: number }

  const update: Record<string, unknown> = {}
  if (is_active !== undefined) update.is_active = !!is_active
  if (sort_order !== undefined) update.sort_order = Number(sort_order)

  const { error } = await supabaseAdmin.from('homepage_banners').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'update',
    module: 'settings',
    tableName: 'homepage_banners',
    recordId: id,
    metadata: update,
  })

  return NextResponse.json({ success: true })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { error } = await supabaseAdmin.from('homepage_banners').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'hard_delete',
    module: 'settings',
    tableName: 'homepage_banners',
    recordId: id,
    restoreStatus: 'not_applicable',
  })

  return NextResponse.json({ success: true })
}

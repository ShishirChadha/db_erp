import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

const THEMES = ['default', 'diwali', 'christmas', 'sale', 'custom'] as const

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json() as Record<string, any>
  const {
    is_active, sort_order, image_path, image_width, image_height,
    link_url, title, theme, custom_color, starts_at, ends_at,
  } = body

  if (theme !== undefined && !THEMES.includes(theme)) {
    return NextResponse.json({ error: `theme must be one of: ${THEMES.join(', ')}` }, { status: 400 })
  }
  if (starts_at && ends_at && new Date(ends_at) <= new Date(starts_at)) {
    return NextResponse.json({ error: 'ends_at must be after starts_at' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  if (is_active !== undefined) update.is_active = !!is_active
  if (sort_order !== undefined) update.sort_order = Number(sort_order)
  if (image_path !== undefined) update.image_path = image_path
  if (image_width !== undefined) update.image_width = image_width != null ? Number(image_width) : null
  if (image_height !== undefined) update.image_height = image_height != null ? Number(image_height) : null
  if (link_url !== undefined) update.link_url = link_url || null
  if (title !== undefined) update.title = title || null
  if (theme !== undefined) update.theme = theme
  if (custom_color !== undefined) update.custom_color = theme === undefined || theme === 'custom' ? (custom_color || null) : null
  if (starts_at !== undefined) update.starts_at = starts_at || null
  if (ends_at !== undefined) update.ends_at = ends_at || null

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

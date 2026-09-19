import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

const THEMES = ['default', 'diwali', 'christmas', 'sale', 'custom'] as const

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data, error } = await supabaseAdmin
    .from('homepage_banners')
    .select('id, image_path, image_width, image_height, link_url, title, theme, custom_color, starts_at, ends_at, is_active, sort_order, created_at')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const { image_path, image_width, image_height, link_url, title, theme, custom_color, starts_at, ends_at, sort_order } = body as Record<string, any>

  if (!image_path) return NextResponse.json({ error: 'image_path is required' }, { status: 400 })
  if (theme && !THEMES.includes(theme)) return NextResponse.json({ error: `theme must be one of: ${THEMES.join(', ')}` }, { status: 400 })
  if (starts_at && ends_at && new Date(ends_at) <= new Date(starts_at)) {
    return NextResponse.json({ error: 'ends_at must be after starts_at' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin.from('homepage_banners').insert({
    image_path,
    image_width: image_width != null ? Number(image_width) : null,
    image_height: image_height != null ? Number(image_height) : null,
    link_url: link_url || null,
    title: title || null,
    theme: theme || 'default',
    custom_color: theme === 'custom' ? (custom_color || null) : null,
    starts_at: starts_at || null,
    ends_at: ends_at || null,
    sort_order: sort_order != null ? Number(sort_order) : 0,
    created_by: sessionUser!.id,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'create',
    module: 'settings',
    tableName: 'homepage_banners',
    recordId: data?.id ?? null,
    recordLabel: title || image_path,
  })

  return NextResponse.json({ success: true })
}

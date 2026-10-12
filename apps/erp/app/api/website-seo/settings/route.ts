import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { recordRevision } from '@/lib/seo-admin'

// Single-row site-wide SEO defaults (migration 20261015). Owner-only.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const { data, error } = await supabaseAdmin.from('seo_settings').select('*').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

const opt = (v: unknown) => (v === undefined ? undefined : String(v ?? '').trim() || null)

export async function PATCH(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = (await req.json()) as Record<string, unknown>
  const update: Record<string, unknown> = {}
  const description = opt(body.default_description)
  const ogImage = opt(body.default_og_image_path)
  const template = opt(body.product_description_template)
  if (description !== undefined) update.default_description = description
  if (ogImage !== undefined) update.default_og_image_path = ogImage
  if (template !== undefined) update.product_description_template = template

  if (typeof update.default_description === 'string' && update.default_description.length > 200) {
    return NextResponse.json({ error: 'Default description is over 200 characters' }, { status: 400 })
  }
  if (typeof update.product_description_template === 'string') {
    const t = update.product_description_template
    if (t.length > 300) return NextResponse.json({ error: 'Template is over 300 characters' }, { status: 400 })
    const unknown = (t.match(/\{(\w+)\}/g) || []).filter((tok) => !['{title}', '{brand}', '{model}', '{price}'].includes(tok))
    if (unknown.length) {
      return NextResponse.json({ error: `Unknown placeholder ${unknown.join(', ')}. Use {title} {brand} {model} {price}` }, { status: 400 })
    }
  }

  const { data: before } = await supabaseAdmin.from('seo_settings').select('*').maybeSingle()
  const { data, error } = await supabaseAdmin
    .from('seo_settings')
    .update({ ...update, updated_at: new Date().toISOString(), updated_by: sessionUser.id })
    .eq('id', true)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (before) await recordRevision('settings', 'singleton', 'upsert', before, sessionUser.id)
  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'settings',
    tableName: 'seo_settings',
    recordLabel: 'Website SEO defaults',
    metadata: update,
  })
  return NextResponse.json(data)
}

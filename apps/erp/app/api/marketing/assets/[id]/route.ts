import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, canEditPage } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

const EDITABLE_FIELDS = ['title', 'body_text', 'hashtags', 'cta_text', 'alt_text', 'pillar', 'scheduled_for', 'card_paths']

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'marketing')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data, error } = await supabaseAdmin.from('marketing_assets').select('*').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

// Editing body/schedule is available to anyone with marketing page access (drafting
// is a low-stakes action); moving a row to 'approved'/'published'/'archived' or
// deleting it is owner/canEditPage('marketing')-gated, matching every other
// owner-curated content surface in this app (e.g. blog authoring in Phase 2).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'marketing')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const updates: Record<string, any> = {}
  for (const key of EDITABLE_FIELDS) if (key in body) updates[key] = body[key]

  if ('status' in body) {
    if (!canEditPage(sessionUser, 'marketing')) return NextResponse.json({ error: 'Only the owner or a granted user can change status.' }, { status: 403 })
    updates.status = body.status
    if (body.status === 'published') updates.published_at = new Date().toISOString()
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 })
  updates.updated_at = new Date().toISOString()

  const { data, error } = await supabaseAdmin.from('marketing_assets').update(updates).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  if ('status' in body) {
    await logAuditEvent({
      actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
      actionType: 'status_change', module: 'marketing', tableName: 'marketing_assets', recordId: id,
      recordLabel: data.title, metadata: { new_status: body.status },
    })
  }
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPage(sessionUser, 'marketing')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { error } = await supabaseAdmin.from('marketing_assets').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'soft_delete', module: 'marketing', tableName: 'marketing_assets', recordId: id,
  })
  return NextResponse.json({ success: true })
}

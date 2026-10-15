import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { validateTeamMember } from '@/lib/site-profile-admin'

// Team members shown on the About page. PUT creates (no id) or updates (id).
export async function PUT(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = (await req.json()) as Record<string, unknown>
  const checked = validateTeamMember(body)
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })

  const payload = { ...checked.row, updated_at: new Date().toISOString(), updated_by: sessionUser.id }
  const id = typeof body.id === 'string' ? body.id : null
  const { data, error } = id
    ? await supabaseAdmin.from('site_team_members').update(payload).eq('id', id).select().single()
    : await supabaseAdmin.from('site_team_members').insert(payload).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: id ? 'update' : 'create',
    module: 'settings',
    tableName: 'site_team_members',
    recordId: data.id,
    recordLabel: String(checked.row.name),
  })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const { data: row } = await supabaseAdmin.from('site_team_members').select('*').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { error } = await supabaseAdmin.from('site_team_members').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'hard_delete',
    module: 'settings',
    tableName: 'site_team_members',
    recordId: id,
    recordLabel: row.name,
    snapshot: row,
  })
  return NextResponse.json({ success: true })
}

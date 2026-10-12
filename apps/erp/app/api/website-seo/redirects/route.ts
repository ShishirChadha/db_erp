import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { addRedirect, recordRevision } from '@/lib/seo-admin'

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const { data, error } = await supabaseAdmin.from('seo_redirects').select('*').order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = (await req.json()) as { from_path?: string; to_path?: string; note?: string }
  if (!body.from_path?.trim() || !body.to_path?.trim()) {
    return NextResponse.json({ error: 'From and To are both required' }, { status: 400 })
  }
  const result = await addRedirect({
    from: body.from_path,
    to: body.to_path,
    source: 'manual',
    note: body.note?.trim() || null,
    userId: sessionUser.id,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'settings',
    tableName: 'seo_redirects',
    recordId: result.row.id,
    recordLabel: `${result.row.from_path} -> ${result.row.to_path}`,
  })
  return NextResponse.json(result.row)
}

export async function DELETE(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const { data: row } = await supabaseAdmin.from('seo_redirects').select('*').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { error } = await supabaseAdmin.from('seo_redirects').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recordRevision('redirect', row.from_path, 'delete', row, sessionUser.id)
  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'hard_delete',
    module: 'settings',
    tableName: 'seo_redirects',
    recordId: id,
    recordLabel: `${row.from_path} -> ${row.to_path}`,
    snapshot: row,
  })
  return NextResponse.json({ success: true })
}

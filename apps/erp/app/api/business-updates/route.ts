import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// Owner-published announcements for the universal staff Home page
// (app/dashboard/home) -- see backups/20261005_business_updates.sql. GET has
// no page-key check, same reasoning as api/attendance/me: Home itself needs
// no grant, so nothing it reads can require one either.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('business_updates')
    .select('id, message, created_at, created_by, profiles!business_updates_created_by_fkey(full_name)')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ updates: data || [] })
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser || !isOwner(sessionUser)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return NextResponse.json({ error: 'message is required.' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('business_updates')
    .insert({ message, created_by: sessionUser.id })
    .select('id, message, created_at')
    .single()

  if (error || !data) return NextResponse.json({ error: error?.message || 'Failed to publish.' }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'business_updates',
    tableName: 'business_updates',
    recordId: data.id,
    recordLabel: `Business update published`,
  })

  return NextResponse.json({ update: data }, { status: 201 })
}

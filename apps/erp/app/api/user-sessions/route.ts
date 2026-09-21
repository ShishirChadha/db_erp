import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { SESSION_COOKIE_NAME } from '@/lib/auth/device-sessions'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- GET: owner-only list of every user's active login sessions ----------
// Settings > Active Devices reads this to show device/location/last-active per
// login, across every account (including the owner's own), so a force-logoff
// can be issued from one place.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data: sessions, error } = await supabaseAdmin
    .from('user_sessions')
    .select('id, profile_id, device_label, ip_address, location, created_at, last_seen_at')
    .is('revoked_at', null)
    .order('last_seen_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const profileIds = [...new Set((sessions || []).map(s => s.profile_id))]
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, username, role')
    .in('id', profileIds.length > 0 ? profileIds : ['00000000-0000-0000-0000-000000000000'])
  const profileById = new Map((profiles || []).map(p => [p.id, p]))

  const result = (sessions || []).map(s => ({
    id: s.id,
    device_label: s.device_label,
    ip_address: s.ip_address,
    location: s.location,
    created_at: s.created_at,
    last_seen_at: s.last_seen_at,
    user: profileById.get(s.profile_id) || null,
  }))

  return NextResponse.json(result)
}

// ---------- DELETE: owner logs off every active session at once ----------
// Excludes the caller's own current session (identified by their own
// db_session_id cookie) so this action can never lock the owner out of the
// dashboard they're using to trigger it -- if they also want their other
// devices/tabs signed out, those are separate session rows and get caught here.
export async function DELETE(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const ownSessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value

  let query = supabaseAdmin
    .from('user_sessions')
    .update({ revoked_at: new Date().toISOString(), revoked_reason: 'manual_owner_bulk' })
    .is('revoked_at', null)
  if (ownSessionId) query = query.neq('id', ownSessionId)

  const { data, error } = await query.select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'settings',
    tableName: 'user_sessions',
    recordLabel: `Force logout all devices (${data?.length ?? 0})`,
  })

  return NextResponse.json({ success: true, count: data?.length ?? 0 })
}

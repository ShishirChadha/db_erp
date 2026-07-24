import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser } from '@/lib/auth/session'
import { getProfileMap } from '@/lib/activities'

// ---------- GET: my notifications, newest first ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const limit = Math.min(Number(searchParams.get('limit')) || 30, 100)
  const unreadOnly = searchParams.get('unread') === 'true'

  let query = supabaseAdmin.from('notifications').select('*').eq('recipient_id', sessionUser.id)
  if (unreadOnly) query = query.is('read_at', null)
  query = query.order('created_at', { ascending: false }).limit(limit)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const profileMap = await getProfileMap((data || []).map((n) => n.actor_id).filter(Boolean))
  return NextResponse.json((data || []).map((n) => ({
    ...n,
    actor_name: n.actor_id ? profileMap.get(n.actor_id)?.full_name || 'Unknown user' : null,
  })))
}

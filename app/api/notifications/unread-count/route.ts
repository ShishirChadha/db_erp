import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser } from '@/lib/auth/session'

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { count, error } = await supabaseAdmin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', sessionUser.id)
    .is('read_at', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ count: count || 0 })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser } from '@/lib/auth/session'

// ---------- PATCH: mark one notification read (recipient only) ----------
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing } = await supabaseAdmin
    .from('notifications').select('id, recipient_id').eq('id', id).maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Notification not found.' }, { status: 404 })
  if (existing.recipient_id !== sessionUser.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { error } = await supabaseAdmin
    .from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

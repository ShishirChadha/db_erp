import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { isDbMaster } from '@/lib/assistant/settings'
import { supabaseAdmin } from '@/lib/supabase/service'
import { visibleTranscript } from '@/lib/assistant/loop'

// ?id=<thread> -> one conversation as the panel shows it; otherwise the owner's
// recent conversations, newest first.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser || !(await isDbMaster(sessionUser))) return NextResponse.json({ error: 'DB is private to her owner.' }, { status: 403 })

  const id = req.nextUrl.searchParams.get('id')
  if (id) {
    const { data } = await supabaseAdmin.from('assistant_threads')
      .select('id, title, messages, pending_action, created_at, updated_at').eq('id', id).eq('owner_id', sessionUser.id).maybeSingle()
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const p = data.pending_action as any
    return NextResponse.json({
      id: data.id, title: data.title, created_at: data.created_at, updated_at: data.updated_at,
      transcript: visibleTranscript(data.messages as any),
      pending: p ? { action_id: p.id, summary: p.summary, warnings: p.warnings } : null,
    })
  }
  const { data } = await supabaseAdmin.from('assistant_threads')
    .select('id, title, created_at, updated_at').eq('owner_id', sessionUser.id)
    .order('updated_at', { ascending: false }).limit(50)
  return NextResponse.json(data || [])
}

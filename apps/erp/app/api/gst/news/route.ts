// GST news feed: list items + source health for the GST page, and let the owner mark an item
// actioned / dismissed. Owner-only like the rest of the GST module.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const [items, sources] = await Promise.all([
    supabaseAdmin.from('gst_news_items')
      .select('id, url, title, published_on, summary, impact, erp_area, suggested_action, effective_date, status, created_at, source_id')
      .in('status', ['new', 'seen'])
      .order('created_at', { ascending: false }).limit(30),
    supabaseAdmin.from('gst_news_sources')
      .select('id, name, url, active, note, last_run_at, last_status, last_error').order('name'),
  ])
  if (items.error) return NextResponse.json({ error: items.error.message }, { status: 500 })
  return NextResponse.json({ items: items.data ?? [], sources: sources.data ?? [] })
}

export async function PATCH(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  if (!body.id || !['seen', 'actioned', 'dismissed'].includes(body.status)) {
    return NextResponse.json({ error: 'id and status (seen|actioned|dismissed) are required.' }, { status: 400 })
  }
  const { error } = await supabaseAdmin.from('gst_news_items')
    .update({ status: body.status, updated_by: sessionUser.id, updated_at: new Date().toISOString() })
    .eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

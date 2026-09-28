import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { getListPageSize, MIN_LIST_PAGE_SIZE, MAX_LIST_PAGE_SIZE } from '@/lib/settings/list-page-size'

// GET is deliberately readable by every signed-in role (not owner-only, unlike
// most settings routes) -- every list page, regardless of who's viewing it, needs
// this value to paginate. Only PATCH (changing it) is owner-only.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pageSize = await getListPageSize()
  return NextResponse.json({ page_size: pageSize })
}

export async function PATCH(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const pageSize = parseInt(body.page_size, 10)
  if (!Number.isFinite(pageSize) || pageSize < MIN_LIST_PAGE_SIZE || pageSize > MAX_LIST_PAGE_SIZE) {
    return NextResponse.json({ error: `page_size must be between ${MIN_LIST_PAGE_SIZE} and ${MAX_LIST_PAGE_SIZE}.` }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key: 'list_page_size', value: String(pageSize), updated_at: new Date().toISOString(), updated_by: sessionUser.id }, { onConflict: 'key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

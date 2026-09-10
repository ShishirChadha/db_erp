import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { parsePagination } from '@/lib/pagination'

// List / manually create marketing_assets rows. Generation (the AI path) lives at
// POST /api/marketing/generate -- this route's POST is for a manual draft (e.g. a
// customer-story post typed by hand, no AI call).
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'marketing')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const platform = searchParams.get('platform')
  const pagination = parsePagination(searchParams)

  let query = supabaseAdmin
    .from('marketing_assets')
    .select('*', pagination ? { count: 'exact' } : undefined)
    .order('scheduled_for', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (status) query = query.eq('status', status)
  if (platform) query = query.eq('platform', platform)
  if (pagination) query = query.range(pagination.from, pagination.to)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (pagination) return NextResponse.json({ data, total: count ?? 0 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'marketing')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const { kind, platform, format, pillar, title, body_text, hashtags, cta_text, alt_text, source_sku_ids, scheduled_for } = body

  if (!kind || !platform) return NextResponse.json({ error: 'kind and platform are required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('marketing_assets')
    .insert({
      kind, platform, format: format || 'none', pillar, title, body_text,
      hashtags: hashtags || [], cta_text, alt_text, source_sku_ids: source_sku_ids || [],
      scheduled_for: scheduled_for || null, status: 'draft', created_by: sessionUser.id,
    })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data, { status: 201 })
}

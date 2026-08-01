import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data, error } = await supabaseAdmin
    .from('sku_cross_sell_rules')
    .select('id, source_category, suggested_category, sort_order, is_active')
    .order('source_category')
    .order('sort_order')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const { source_category, suggested_category, sort_order } = body as {
    source_category?: string
    suggested_category?: string
    sort_order?: number
  }

  if (!source_category || !suggested_category) {
    return NextResponse.json({ error: 'source_category and suggested_category are both required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin.from('sku_cross_sell_rules').insert({
    source_category, suggested_category, sort_order: sort_order ?? 0,
  }).select().single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A rule for this category pair already exists' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'create',
    module: 'settings',
    tableName: 'sku_cross_sell_rules',
    recordId: data?.id ?? null,
    recordLabel: `${source_category} -> ${suggested_category}`,
  })

  return NextResponse.json({ success: true })
}

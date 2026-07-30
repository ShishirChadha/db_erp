import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

const ALLOWED_FIELDS = ['ram', 'ssd', 'warranty_months'] as const

// ---------- GET: list all upgrade rules (owner-only, matches the admin-pricing convention) ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data, error } = await supabaseAdmin
    .from('sku_upgrade_rules')
    .select('id, category, field_name, from_value, to_value, price_delta, is_active, created_at')
    .order('category')
    .order('field_name')
    .order('from_value')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

// ---------- POST: create a new upgrade rule ----------
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const { category, field_name, from_value, to_value, price_delta } = body as {
    category?: string
    field_name?: string
    from_value?: string
    to_value?: string
    price_delta?: number
  }

  if (!category || !field_name || !from_value || !to_value || price_delta == null) {
    return NextResponse.json({ error: 'category, field_name, from_value, to_value, and price_delta are all required' }, { status: 400 })
  }
  if (!ALLOWED_FIELDS.includes(field_name as any)) {
    return NextResponse.json({ error: `field_name must be one of: ${ALLOWED_FIELDS.join(', ')}` }, { status: 400 })
  }
  if (from_value === to_value) {
    return NextResponse.json({ error: 'from_value and to_value cannot be the same' }, { status: 400 })
  }
  if (Number(price_delta) < 0) {
    return NextResponse.json({ error: 'price_delta cannot be negative' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('sku_upgrade_rules').insert({
    category, field_name, from_value, to_value, price_delta: Number(price_delta), created_by: sessionUser!.id,
  })
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A rule for this exact category/field/from/to already exists' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

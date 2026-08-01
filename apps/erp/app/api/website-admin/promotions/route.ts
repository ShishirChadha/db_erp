import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

const PROMO_TYPES = ['percent_off', 'flat_off', 'free_gift', 'coupon_code'] as const
const SCOPE_TYPES = ['product', 'brand', 'category', 'sitewide'] as const

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data, error } = await supabaseAdmin
    .from('promotions')
    .select('id, name, promo_type, code, discount_percent, discount_flat, free_gift_sku_id, scope_type, scope_value, starts_at, ends_at, is_stackable, is_active, min_order_value, created_at')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const {
    name, promo_type, code, discount_percent, discount_flat, free_gift_sku_id,
    scope_type, scope_value, starts_at, ends_at, is_stackable, min_order_value,
  } = body as Record<string, any>

  if (!name || !promo_type || !scope_type || !starts_at || !ends_at) {
    return NextResponse.json({ error: 'name, promo_type, scope_type, starts_at, and ends_at are all required' }, { status: 400 })
  }
  if (!PROMO_TYPES.includes(promo_type)) return NextResponse.json({ error: `promo_type must be one of: ${PROMO_TYPES.join(', ')}` }, { status: 400 })
  if (!SCOPE_TYPES.includes(scope_type)) return NextResponse.json({ error: `scope_type must be one of: ${SCOPE_TYPES.join(', ')}` }, { status: 400 })
  if (new Date(ends_at) <= new Date(starts_at)) return NextResponse.json({ error: 'ends_at must be after starts_at' }, { status: 400 })
  if (promo_type === 'percent_off' && discount_percent == null) return NextResponse.json({ error: 'discount_percent is required for percent_off' }, { status: 400 })
  if (promo_type === 'flat_off' && discount_flat == null) return NextResponse.json({ error: 'discount_flat is required for flat_off' }, { status: 400 })
  if (promo_type === 'free_gift' && !free_gift_sku_id) return NextResponse.json({ error: 'free_gift_sku_id is required for free_gift' }, { status: 400 })
  if (scope_type !== 'sitewide' && !scope_value) return NextResponse.json({ error: 'scope_value is required unless scope_type is sitewide' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('promotions').insert({
    name, promo_type, code: code || null,
    discount_percent: discount_percent != null ? Number(discount_percent) : null,
    discount_flat: discount_flat != null ? Number(discount_flat) : null,
    free_gift_sku_id: free_gift_sku_id || null,
    scope_type, scope_value: scope_value || null,
    starts_at, ends_at,
    is_stackable: !!is_stackable,
    min_order_value: min_order_value != null ? Number(min_order_value) : null,
    created_by: sessionUser!.id,
  }).select().single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'That coupon code is already in use' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'create',
    module: 'settings',
    tableName: 'promotions',
    recordId: data?.id ?? null,
    recordLabel: name,
  })

  return NextResponse.json({ success: true })
}

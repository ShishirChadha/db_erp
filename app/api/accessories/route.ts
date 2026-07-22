import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { redactManyForRole } from '@/lib/auth/redact'

// ---------- GET: list/search accessories (active by default) ----------
// Used by both the Accessories page and New Entry's Sell (accessory browse/bundle picker).
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, ['accessories', 'new_entry'])) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')
  const includePending = searchParams.get('include_pending') === 'true'
  const reviewStatus = searchParams.get('review_status')
  const id = searchParams.get('id')

  let query = supabaseAdmin
    .from('accessories')
    .select('*')
    .eq('is_deleted', false)
    .order('accessory_name')

  if (reviewStatus) {
    query = query.eq('review_status', reviewStatus)
  } else if (!includePending) {
    query = query.eq('review_status', 'active')
  }
  if (search) query = query.ilike('accessory_name', `%${search}%`)
  if (id) query = query.eq('id', id)

  const { data, error } = await query.limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json(redactManyForRole(data || [], 'accessories', sessionUser.role))
}

// ---------- POST: register a new accessory type ----------
// Anyone can flag a not-yet-catalogued accessory so their transaction has something to
// reference right away; it lands as review_status='pending_review' (zero cost, zero
// stock) until the owner enriches it with cost/supplier and flips it to 'active'.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, ['accessories', 'new_entry'])) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  if (!body.accessory_name?.trim()) {
    return NextResponse.json({ error: 'Accessory name is required.' }, { status: 400 })
  }

  const isOwnerRole = sessionUser.role === 'owner'

  const { data, error } = await supabaseAdmin
    .from('accessories')
    .insert({
      accessory_name: body.accessory_name.trim(),
      category: body.category || null,
      brand: body.brand || null,
      quantity: 0,
      unit_cost: isOwnerRole ? (body.unit_cost ?? null) : null,
      selling_price: body.selling_price ?? null,
      supplier: isOwnerRole ? (body.supplier ?? null) : null,
      review_status: isOwnerRole ? 'active' : 'pending_review',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(redactManyForRole([data], 'accessories', sessionUser.role)[0], { status: 201 })
}

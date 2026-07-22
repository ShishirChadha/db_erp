import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// ---------- GET: list dropdown values for a category (active only, unless owner asks for all) ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category')
  const includeInactive = searchParams.get('include_inactive') === 'true' && isOwner(sessionUser)

  let query = supabaseAdmin
    .from('custom_options')
    .select('id, category, value, is_active, sort_order')
    .order('sort_order')
    .order('value')

  if (category) query = query.eq('category', category)
  if (!includeInactive) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

// ---------- POST: owner adds a new dropdown value to a category ----------
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const { category, value, sort_order } = body
  if (!category?.trim() || !value?.trim()) {
    return NextResponse.json({ error: 'category and value are required.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('custom_options')
    .insert({ category: category.trim(), value: value.trim(), sort_order: sort_order ?? 0 })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'That value already exists in this category.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { normalizeForComparison } from '@/lib/text-normalize'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- GET: list dropdown values for a category (active only, unless owner asks for all) ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category')
  const includeInactive = searchParams.get('include_inactive') === 'true' && isOwner(sessionUser)

  let query = supabaseAdmin
    .from('custom_options')
    .select('id, category, value, is_active, sort_order, owner_only')
    .order('sort_order')
    .order('value')

  if (category) query = query.eq('category', category)
  if (!includeInactive) query = query.eq('is_active', true)
  // An owner-only value (e.g. expense_types "Salaries"/"Bank Charges"/"GST Payment")
  // is never even offered to a non-owner -- not just redacted after the fact.
  if (!isOwner(sessionUser)) query = query.eq('owner_only', false)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

// ---------- POST: add a new dropdown value to a category ----------
// Any signed-in user (owner or employee) can add a new value here -- e.g. an
// employee typing a model/brand that isn't in the list yet on a data-entry form.
// Editing/deactivating/deleting existing values stays owner-only (see PATCH/DELETE
// in [id]/route.ts) -- this endpoint only ever appends.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { category, value, sort_order } = body
  if (!category?.trim() || !value?.trim()) {
    return NextResponse.json({ error: 'category and value are required.' }, { status: 400 })
  }

  const trimmedCategory = category.trim()
  const trimmedValue = value.trim()

  // Case/whitespace-insensitive dedup: the DB's own unique constraint is exact-string,
  // which let "ThinkPad T450" and "Thinkpad T450" both get added as separate options.
  // Equality only here (not the containment check used for SKU-level duplicate
  // detection) -- this table also backs lists like RAM/storage where containment would
  // wrongly conflate distinct values (e.g. "128GB" is not a duplicate of "1TB").
  const { data: existingOptions } = await supabaseAdmin
    .from('custom_options')
    .select('*')
    .eq('category', trimmedCategory)
  const normalizedNew = normalizeForComparison(trimmedValue)
  const match = existingOptions?.find((o) => normalizeForComparison(o.value) === normalizedNew)
  if (match) return NextResponse.json(match, { status: 200 })

  const { data, error } = await supabaseAdmin
    .from('custom_options')
    .insert({ category: trimmedCategory, value: trimmedValue, sort_order: sort_order ?? 0 })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'That value already exists in this category.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'settings',
    tableName: 'custom_options',
    recordId: data.id,
    recordLabel: `${trimmedCategory}: ${trimmedValue}`,
  })

  return NextResponse.json(data, { status: 201 })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, canEditPage } from '@/lib/auth/session'

// ---------- GET: list expenses ----------
// The 'expenses' page key -- previously this table had no API route at all (the page
// wrote straight to Supabase under a blanket "any authenticated user" RLS policy,
// enforced only by the client-side RequireOwner wrapper). This is the first real
// server-side gate for expense data.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!hasPageAccess(sessionUser, 'expenses')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const showDeleted = searchParams.get('show_deleted') === 'true'
  const search = searchParams.get('search')
  const type = searchParams.get('type')
  const dateFrom = searchParams.get('date_from')
  const dateTo = searchParams.get('date_to')
  const sortField = ['expense_date', 'type', 'amount'].includes(searchParams.get('sort') || '')
    ? (searchParams.get('sort') as string)
    : 'expense_date'
  const sortAscending = searchParams.get('order') === 'asc'

  let query = supabaseAdmin.from('expenses').select('*').eq('is_deleted', showDeleted)

  if (search) {
    query = query.or(
      `description.ilike.%${search}%,type.ilike.%${search}%,from_location.ilike.%${search}%,to_location.ilike.%${search}%,remarks.ilike.%${search}%`
    )
  }
  if (type && type !== 'all') query = query.eq('type', type)
  if (dateFrom) query = query.gte('expense_date', dateFrom)
  if (dateTo) query = query.lte('expense_date', dateTo)
  query = query.order(sortField, { ascending: sortAscending })

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data || [])
}

// ---------- POST: create an expense ----------
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPage(sessionUser, 'expenses')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const { expense_date, description, type, from_location, to_location, amount, remarks } = body

  if (!expense_date || !description || amount === undefined || amount === null) {
    return NextResponse.json({ error: 'expense_date, description, and amount are required.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('expenses')
    .insert({
      expense_date,
      description,
      type: type || null,
      from_location: from_location || null,
      to_location: to_location || null,
      amount: Number(amount) || 0,
      remarks: remarks || null,
      is_deleted: false,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data, { status: 201 })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, canEditPage, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { getOwnerOnlyExpenseTypes, isOwnerOnlyType } from '@/lib/owner-only-expense-types'

// ---------- GET: list expenses ----------
// The 'expenses' page key -- previously this table had no API route at all (the page
// wrote straight to Supabase under a blanket "any authenticated user" RLS policy,
// enforced only by the client-side RequireOwner wrapper). This is the first real
// server-side gate for expense data.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!hasPageAccess(sessionUser, 'expenses')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const ownerCaller = isOwner(sessionUser)

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

  let query = supabaseAdmin.from('expenses').select('*, vendors(company_name)').eq('is_deleted', showDeleted)

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

  let rows = data || []

  // Owner-only expense types (Settings -> Dropdown Options, e.g. Salaries/Bank
  // Charges/GST Payment by default) are dropped entirely for a non-owner --
  // not just the type value, the whole row (amount, description, everything).
  // `type` is free text, so a sensitive-type row can exist regardless of how it
  // was entered; filtering only the dropdown option wouldn't hide it.
  if (!ownerCaller) {
    const ownerOnlyTypes = await getOwnerOnlyExpenseTypes()
    rows = rows.filter((r: any) => !isOwnerOnlyType(r.type, ownerOnlyTypes))
  }

  // Vendor identity is owner-only for expenses (same default posture as every
  // other vendor-linked record in this app, minus the one narrow accessory-receipt
  // exception, which doesn't apply here) -- strip the joined vendor name server-side
  // rather than relying on the UI to simply not render it.
  rows = ownerCaller ? rows : rows.map(({ vendors, ...rest }: any) => rest)
  return NextResponse.json(rows)
}

// ---------- POST: create an expense ----------
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditPage(sessionUser, 'expenses')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const { expense_date, description, type, from_location, to_location, amount, remarks, payment_account, vendor_id, attachments, paid_by_staff } = body

  if (!expense_date || !description || amount === undefined || amount === null) {
    return NextResponse.json({ error: 'expense_date, description, and amount are required.' }, { status: 400 })
  }

  if (!isOwner(sessionUser)) {
    const ownerOnlyTypes = await getOwnerOnlyExpenseTypes()
    if (isOwnerOnlyType(type, ownerOnlyTypes)) {
      return NextResponse.json({ error: 'This expense type is owner-only.' }, { status: 403 })
    }
  }

  // entity_key derives from payment_account rather than asking for both --
  // business_profiles.key values are the lowercase form of the *_account text
  // columns used everywhere else (Digitalbluez -> digitalbluez).
  const entityKey = payment_account ? payment_account.toLowerCase() : null

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
      payment_account: payment_account || null,
      entity_key: entityKey,
      vendor_id: vendor_id || null,
      created_by: sessionUser.id,
      source: body.source === 'bank_recon' ? 'bank_recon' : 'manual',
      attachments: Array.isArray(attachments) ? attachments : [],
      paid_by_staff: paid_by_staff || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'expenses',
    tableName: 'expenses',
    recordId: data.id,
    recordLabel: `${data.type || 'Expense'}: ${data.description} (₹${data.amount})`,
  })

  return NextResponse.json(data, { status: 201 })
}

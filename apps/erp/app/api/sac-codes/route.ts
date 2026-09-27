import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// ---------- GET: list SAC codes ----------
// Any signed-in user can read the list (needed to pick a code on a Service SKU) --
// managing the list itself (POST/PATCH) is owner-only, matching Dropdown Options.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')?.trim()
  const activeOnly = searchParams.get('active') === 'true'

  let query = supabaseAdmin.from('sac_codes').select('*').order('code')
  if (activeOnly) query = query.eq('is_active', true)
  if (search) query = query.or(`code.ilike.%${search}%,description.ilike.%${search}%`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

// ---------- POST: owner adds a new SAC code ----------
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const code = (body.code || '').trim()
  const description = (body.description || '').trim()
  if (!code) return NextResponse.json({ error: 'code is required.' }, { status: 400 })
  if (!description) return NextResponse.json({ error: 'description is required.' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('sac_codes')
    .insert({ code, description, created_by: sessionUser!.id })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'That SAC code already exists.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await logAuditEvent({
    actor: { id: sessionUser!.id, email: sessionUser!.email, role: sessionUser!.role },
    actionType: 'create',
    module: 'settings',
    tableName: 'sac_codes',
    recordId: data.id,
    recordLabel: `${data.code} — ${data.description}`,
  })

  return NextResponse.json(data, { status: 201 })
}

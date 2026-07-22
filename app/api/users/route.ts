import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

const ALLOWED_PAGE_KEYS = [
  'new_entry', 'accessories', 'repair_jobs', 'sku_master',
  'live_stock', 'invoices', 'customers', 'activities',
]

// ---------- GET: owner lists every user (auth + profile info combined) ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data: authList, error: authErr } = await supabaseAdmin.auth.admin.listUsers()
  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 })

  const { data: profiles, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, role, is_active, allowed_pages')

  if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 })

  const profileById = new Map(profiles.map(p => [p.id, p]))
  const users = authList.users
    .map(u => {
      const profile = profileById.get(u.id)
      if (!profile) return null
      return {
        id: u.id,
        email: u.email,
        full_name: profile.full_name,
        role: profile.role,
        is_active: profile.is_active,
        allowed_pages: profile.allowed_pages || [],
      }
    })
    .filter(Boolean)

  return NextResponse.json(users)
}

// ---------- POST: owner creates a new login (auth user + profile row) ----------
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const { email, password, full_name, role, allowed_pages } = body

  if (!email?.trim()) return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
  if (!password || password.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
  if (!['owner', 'employee'].includes(role)) return NextResponse.json({ error: "Role must be 'owner' or 'employee'." }, { status: 400 })

  const pages: string[] = role === 'owner' ? [] : (Array.isArray(allowed_pages) ? allowed_pages.filter((k: string) => ALLOWED_PAGE_KEYS.includes(k)) : [])

  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
  })
  if (createErr) return NextResponse.json({ error: createErr.message }, { status: 400 })

  const { error: profileErr } = await supabaseAdmin
    .from('profiles')
    .insert({
      id: created.user.id,
      full_name: full_name?.trim() || null,
      role,
      is_active: true,
      allowed_pages: pages,
    })

  if (profileErr) {
    // Roll back the auth user so we don't leave a login with no profile row behind it.
    await supabaseAdmin.auth.admin.deleteUser(created.user.id)
    return NextResponse.json({ error: profileErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, id: created.user.id }, { status: 201 })
}

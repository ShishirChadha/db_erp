import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { usernameToSyntheticEmail } from '@/lib/auth/username'

const ALLOWED_PAGE_KEYS = [
  'dashboard', 'pending_tasks', 'new_entry', 'accessories', 'repair_jobs', 'replacement_jobs',
  'sku_master', 'live_stock', 'invoices', 'customers', 'activities', 'sales', 'stock', 'website',
]

// Subset of ALLOWED_PAGE_KEYS that has a real per-page edit concept -- matches
// profile_page_actions.page_key's CHECK constraint exactly. See app/api/users/[id]/route.ts
// for why 'dashboard'/'pending_tasks' are excluded here but not from ALLOWED_PAGE_KEYS.
const EDITABLE_PAGE_KEYS = [
  'new_entry', 'accessories', 'repair_jobs', 'replacement_jobs', 'sku_master', 'live_stock', 'invoices', 'customers', 'activities', 'sales', 'stock', 'website',
]

// ---------- GET: owner lists every user (auth + profile info combined) ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data: authList, error: authErr } = await supabaseAdmin.auth.admin.listUsers()
  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 })

  const { data: profiles, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, role, is_active, allowed_pages, username, contact_email, employee_id')

  if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 })

  const { data: editRows } = await supabaseAdmin
    .from('profile_page_actions')
    .select('profile_id, page_key')
    .eq('can_edit', true)
  const editKeysByProfile = new Map<string, string[]>()
  for (const row of editRows || []) {
    const list = editKeysByProfile.get(row.profile_id) || []
    list.push(row.page_key)
    editKeysByProfile.set(row.profile_id, list)
  }

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
        page_edit_keys: editKeysByProfile.get(u.id) || [],
        username: profile.username,
        contact_email: profile.contact_email,
        employee_id: profile.employee_id,
      }
    })
    .filter(Boolean)

  return NextResponse.json(users)
}

// ---------- POST: owner creates a new login (auth user + profile row) ----------
// Login is username-based (profiles.username, e.g. "ShishirCH"), not an email address --
// Supabase Auth still needs an email-shaped string internally, so we synthesize one on a
// fixed, never-shown domain (see lib/auth/username.ts) and store the real username
// separately. contact_email is optional and purely for notification delivery
// (lib/notifications.ts), independent of the login identifier.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const { username, password, full_name, role, allowed_pages, page_edit_keys, contact_email, employee_id } = body

  const trimmedUsername = username?.trim() || ''
  if (!trimmedUsername) return NextResponse.json({ error: 'User ID is required.' }, { status: 400 })
  if (/[@\s]/.test(trimmedUsername)) {
    return NextResponse.json({ error: 'User ID cannot contain spaces or "@" — use a plain name like ShishirCH.' }, { status: 400 })
  }
  if (!password || password.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
  if (!['owner', 'manager', 'employee'].includes(role)) return NextResponse.json({ error: "Role must be 'owner', 'manager', or 'employee'." }, { status: 400 })

  const pages: string[] = role === 'owner' ? [] : (Array.isArray(allowed_pages) ? allowed_pages.filter((k: string) => ALLOWED_PAGE_KEYS.includes(k)) : [])
  const editKeys: string[] = role === 'owner' ? [] : (Array.isArray(page_edit_keys) ? page_edit_keys.filter((k: string) => EDITABLE_PAGE_KEYS.includes(k) && pages.includes(k)) : [])

  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: usernameToSyntheticEmail(trimmedUsername),
    password,
    email_confirm: true,
  })
  if (createErr) {
    const message = createErr.message.toLowerCase().includes('already') ? 'That User ID is already taken.' : createErr.message
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const { error: profileErr } = await supabaseAdmin
    .from('profiles')
    .insert({
      id: created.user.id,
      full_name: full_name?.trim() || null,
      role,
      is_active: true,
      allowed_pages: pages,
      username: trimmedUsername,
      contact_email: contact_email?.trim() || null,
      employee_id: employee_id?.trim() || null,
    })

  if (profileErr) {
    // Roll back the auth user so we don't leave a login with no profile row behind it.
    await supabaseAdmin.auth.admin.deleteUser(created.user.id)
    const message = profileErr.message.includes('profiles_username_unique_idx') ? 'That User ID is already taken.' : profileErr.message
    return NextResponse.json({ error: message }, { status: 500 })
  }

  if (editKeys.length > 0) {
    await supabaseAdmin
      .from('profile_page_actions')
      .insert(editKeys.map((page_key) => ({ profile_id: created.user.id, page_key, can_edit: true })))
  }

  return NextResponse.json({ success: true, id: created.user.id }, { status: 201 })
}

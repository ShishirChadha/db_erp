import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

const ALLOWED_PAGE_KEYS = [
  'dashboard', 'pending_tasks', 'new_entry', 'accessories', 'repair_jobs', 'replacement_jobs',
  'sku_master', 'live_stock', 'invoices', 'customers', 'activities', 'sales', 'stock',
]

// Subset of ALLOWED_PAGE_KEYS that has a real per-page edit concept -- matches
// profile_page_actions.page_key's CHECK constraint exactly. 'dashboard'/'pending_tasks'
// are nav/landing keys with no mutable resource behind them, so they're valid for
// allowed_pages (visibility) but must never be written to profile_page_actions.
const EDITABLE_PAGE_KEYS = [
  'new_entry', 'accessories', 'repair_jobs', 'replacement_jobs', 'sku_master', 'live_stock', 'invoices', 'customers', 'activities', 'sales', 'stock',
]

// ---------- PATCH: owner updates role/allowed_pages/is_active/full_name/contact_email/employee_id, and/or resets a password ----------
// No DELETE -- deactivation (is_active=false) is the only revoke action. A hard delete
// would orphan sales.entered_by/sold_by-style references, and is_active=false already
// fully blocks login (see lib/auth/session.ts).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const { role, allowed_pages, page_edit_keys, is_active, password, full_name, contact_email, employee_id } = body

  const profileUpdates: Record<string, unknown> = {}
  if (role !== undefined) {
    if (!['owner', 'manager', 'employee'].includes(role)) return NextResponse.json({ error: "Role must be 'owner', 'manager', or 'employee'." }, { status: 400 })
    profileUpdates.role = role
  }
  if (allowed_pages !== undefined) {
    if (!Array.isArray(allowed_pages)) return NextResponse.json({ error: 'allowed_pages must be an array.' }, { status: 400 })
    profileUpdates.allowed_pages = allowed_pages.filter((k: string) => ALLOWED_PAGE_KEYS.includes(k))
  }
  if (is_active !== undefined) {
    profileUpdates.is_active = !!is_active
  }
  if (full_name !== undefined) {
    profileUpdates.full_name = full_name?.trim() || null
  }
  if (contact_email !== undefined) {
    profileUpdates.contact_email = contact_email?.trim() || null
  }
  if (employee_id !== undefined) {
    profileUpdates.employee_id = employee_id?.trim() || null
  }

  if (Object.keys(profileUpdates).length > 0) {
    const { error: profileErr } = await supabaseAdmin
      .from('profiles')
      .update(profileUpdates)
      .eq('id', id)
    if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 })
  }

  // page_edit_keys is a full-replace of this user's edit grants (delete-then-insert,
  // scoped to the keys submitted), independent of whether allowed_pages was also sent.
  if (page_edit_keys !== undefined) {
    if (!Array.isArray(page_edit_keys)) return NextResponse.json({ error: 'page_edit_keys must be an array.' }, { status: 400 })
    const keys = page_edit_keys.filter((k: string) => EDITABLE_PAGE_KEYS.includes(k))
    const { error: delErr } = await supabaseAdmin.from('profile_page_actions').delete().eq('profile_id', id)
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
    if (keys.length > 0) {
      const { error: insErr } = await supabaseAdmin
        .from('profile_page_actions')
        .insert(keys.map((page_key) => ({ profile_id: id, page_key, can_edit: true })))
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
    }
  }

  if (password) {
    if (password.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
    const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(id, { password })
    if (pwErr) return NextResponse.json({ error: pwErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

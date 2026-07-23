import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

const ALLOWED_PAGE_KEYS = [
  'dashboard', 'pending_tasks', 'new_entry', 'accessories', 'repair_jobs', 'sku_master',
  'live_stock', 'invoices', 'customers', 'activities',
]

// ---------- PATCH: owner updates role/allowed_pages/is_active, and/or resets a password ----------
// No DELETE -- deactivation (is_active=false) is the only revoke action. A hard delete
// would orphan sales.entered_by/sold_by-style references, and is_active=false already
// fully blocks login (see lib/auth/session.ts).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const { role, allowed_pages, is_active, password } = body

  const profileUpdates: Record<string, unknown> = {}
  if (role !== undefined) {
    if (!['owner', 'employee'].includes(role)) return NextResponse.json({ error: "Role must be 'owner' or 'employee'." }, { status: 400 })
    profileUpdates.role = role
  }
  if (allowed_pages !== undefined) {
    if (!Array.isArray(allowed_pages)) return NextResponse.json({ error: 'allowed_pages must be an array.' }, { status: 400 })
    profileUpdates.allowed_pages = allowed_pages.filter((k: string) => ALLOWED_PAGE_KEYS.includes(k))
  }
  if (is_active !== undefined) {
    profileUpdates.is_active = !!is_active
  }

  if (Object.keys(profileUpdates).length > 0) {
    const { error: profileErr } = await supabaseAdmin
      .from('profiles')
      .update(profileUpdates)
      .eq('id', id)
    if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 })
  }

  if (password) {
    if (password.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
    const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(id, { password })
    if (pwErr) return NextResponse.json({ error: pwErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

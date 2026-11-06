import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

const ENFORCEMENT_CATEGORY = 'attendance_settings'
const ENFORCEMENT_ON = 'ip_enforcement_on'
const LOGIN_ENFORCEMENT_ON = 'login_enforcement_on'

// The office-IP allowlist, plus the master enforcement toggle.
//
// The toggle is a single custom_options row rather than a one-row settings
// table -- this genuinely is the flat pick-list case that rule is about.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const [{ data: networks }, { data: toggles }] = await Promise.all([
    supabaseAdmin.from('attendance_networks')
      .select('id, label, cidr, is_active, notes, created_at, source, last_seen_at')
      .order('created_at', { ascending: false }),
    supabaseAdmin.from('custom_options')
      .select('value').eq('category', ENFORCEMENT_CATEGORY)
      .in('value', [ENFORCEMENT_ON, LOGIN_ENFORCEMENT_ON]).eq('is_active', true),
  ])

  const rows = networks || []
  const activeCount = rows.filter(n => n.is_active).length
  const enforced = (toggles || []).some(t => t.value === ENFORCEMENT_ON)
  const loginEnforced = (toggles || []).some(t => t.value === LOGIN_ENFORCEMENT_ON)
  return NextResponse.json({
    networks: rows,
    enforced,
    login_enforced: loginEnforced,
    // Enforcement on with nothing to match would lock the whole team out, so
    // checkPunchNetwork() fails OPEN in that state. Surfaced here so the
    // Settings tab can warn instead of silently doing nothing.
    failing_open: (enforced || loginEnforced) && activeCount === 0,
  })
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))

  // ---------- toggle enforcement ----------
  if (body.enforced !== undefined) {
    if (body.enforced) {
      await supabaseAdmin.from('custom_options').upsert(
        { category: ENFORCEMENT_CATEGORY, value: ENFORCEMENT_ON, owner_only: true, is_active: true },
        { onConflict: 'category,value' },
      )
    } else {
      await supabaseAdmin.from('custom_options')
        .delete().eq('category', ENFORCEMENT_CATEGORY).eq('value', ENFORCEMENT_ON)
    }
    await logAuditEvent({
      actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
      actionType: 'status_change', module: 'attendance', tableName: 'attendance_networks',
      recordLabel: `office-IP enforcement ${body.enforced ? 'enabled' : 'disabled'}`,
    })
    return NextResponse.json({ success: true, enforced: !!body.enforced })
  }

  // ---------- toggle office-only login ----------
  if (body.login_enforced !== undefined) {
    if (body.login_enforced) {
      await supabaseAdmin.from('custom_options').upsert(
        { category: ENFORCEMENT_CATEGORY, value: LOGIN_ENFORCEMENT_ON, owner_only: true, is_active: true },
        { onConflict: 'category,value' },
      )
    } else {
      await supabaseAdmin.from('custom_options')
        .delete().eq('category', ENFORCEMENT_CATEGORY).eq('value', LOGIN_ENFORCEMENT_ON)
    }
    await logAuditEvent({
      actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
      actionType: 'status_change', module: 'auth', tableName: 'attendance_networks',
      recordLabel: `office-only login ${body.login_enforced ? 'enabled' : 'disabled'}`,
    })
    return NextResponse.json({ success: true, login_enforced: !!body.login_enforced })
  }

  // ---------- add a range ----------
  const label = typeof body.label === 'string' ? body.label.trim() : ''
  const cidr = typeof body.cidr === 'string' ? body.cidr.trim() : ''
  if (!label || !cidr) {
    return NextResponse.json({ error: 'label and cidr are required.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('attendance_networks')
    .insert({ label, cidr, notes: body.notes?.trim() || null, is_active: body.is_active ?? true, created_by: sessionUser.id })
    .select('id, label, cidr, is_active, notes, created_at')
    .single()

  if (error) {
    // 22P02 is an invalid inet/cidr literal -- the column type is doing the
    // validating, so a typo gets a readable message rather than a 500.
    if (error.code === '22P02') {
      return NextResponse.json(
        { error: `"${cidr}" is not a valid IP address or CIDR range.` },
        { status: 400 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create', module: 'attendance', tableName: 'attendance_networks',
    recordId: data.id, recordLabel: `${label} (${cidr})`,
  })
  return NextResponse.json(data, { status: 201 })
}

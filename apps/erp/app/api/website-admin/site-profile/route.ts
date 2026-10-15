import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { recordRevision } from '@/lib/seo-admin'
import { validateSiteProfile } from '@/lib/site-profile-admin'

// The owner-managed public company profile (single row) plus the team list.
// Mirrors payment-settings: owner-only GET/PATCH, validated, audited, and the
// previous row is snapshotted to seo_revisions so a change can be undone.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const [profile, team, business] = await Promise.all([
    supabaseAdmin.from('site_profile').select('*').maybeSingle(),
    supabaseAdmin.from('site_team_members').select('*').order('sort_order').order('name'),
    supabaseAdmin.from('business_profiles').select('legal_name, gstin').eq('key', 'digitalbluez').maybeSingle(),
  ])
  if (profile.error) return NextResponse.json({ error: profile.error.message }, { status: 500 })
  return NextResponse.json({ profile: profile.data, team: team.data ?? [], business: business.data ?? null })
}

export async function PATCH(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const checked = validateSiteProfile((await req.json()) as Record<string, unknown>)
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })
  if (Object.keys(checked.update).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const { data: before } = await supabaseAdmin.from('site_profile').select('*').maybeSingle()
  if (!before) return NextResponse.json({ error: 'Company profile row is missing' }, { status: 500 })

  const { data, error } = await supabaseAdmin
    .from('site_profile')
    .update({ ...checked.update, updated_at: new Date().toISOString(), updated_by: sessionUser.id })
    .eq('id', true)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recordRevision('site_profile', 'singleton', 'upsert', before, sessionUser.id)
  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update',
    module: 'settings',
    tableName: 'site_profile',
    recordLabel: 'Company & About',
    metadata: { fields: Object.keys(checked.update) },
  })
  return NextResponse.json(data)
}

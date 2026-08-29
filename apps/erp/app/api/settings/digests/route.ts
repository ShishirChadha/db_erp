// Owner-only config for the digest engine -- channel credentials (singleton) and
// per-person subscriptions. Mirrors app/api/settings/backup-schedule/route.ts:
// GET returns current state, PUT validates and writes it. The WhatsApp access
// token is encrypted at rest (lib/auth/password-vault.ts) and never returned in
// GET -- only a boolean "is a token stored" flag, same principle as never
// round-tripping a stored secret back to the client.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { encryptPassword } from '@/lib/auth/password-vault'

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const [cfgRes, subsRes, profilesRes, runsRes] = await Promise.all([
    supabaseAdmin.from('digest_channel_config').select('*').eq('id', true).single(),
    supabaseAdmin.from('digest_subscriptions').select('*').order('profile_id'),
    supabaseAdmin.from('profiles').select('id, full_name, role, is_active').eq('is_active', true),
    supabaseAdmin.from('digest_runs').select('*').order('sent_at', { ascending: false }).limit(50),
  ])

  const cfg = cfgRes.data
  return NextResponse.json({
    config: cfg ? {
      email_enabled: cfg.email_enabled,
      email_from_override: cfg.email_from_override,
      whatsapp_enabled: cfg.whatsapp_enabled,
      whatsapp_phone_number_id: cfg.whatsapp_phone_number_id,
      whatsapp_has_token: !!cfg.whatsapp_access_token_encrypted,
      whatsapp_template_name: cfg.whatsapp_template_name,
      whatsapp_graph_api_version: cfg.whatsapp_graph_api_version,
      dispatch_url: cfg.dispatch_url,
      dispatch_has_secret: !!cfg.dispatch_secret,
    } : null,
    subscriptions: subsRes.data || [],
    profiles: profilesRes.data || [],
    recentRuns: runsRes.data || [],
  })
}

export async function PUT(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))

  if (body.channel_config) {
    const c = body.channel_config
    const update: Record<string, any> = {
      email_enabled: !!c.email_enabled,
      email_from_override: c.email_from_override || null,
      whatsapp_enabled: !!c.whatsapp_enabled,
      whatsapp_phone_number_id: c.whatsapp_phone_number_id || null,
      whatsapp_template_name: c.whatsapp_template_name || null,
      whatsapp_graph_api_version: c.whatsapp_graph_api_version || 'v21.0',
      dispatch_url: c.dispatch_url || null,
      updated_by: sessionUser.id,
      updated_at: new Date().toISOString(),
    }
    // Only overwrite the stored secret/token when a new value is actually provided --
    // an empty field on save must not silently wipe a previously-configured one.
    if (typeof c.whatsapp_access_token === 'string' && c.whatsapp_access_token.length > 0) {
      update.whatsapp_access_token_encrypted = encryptPassword(c.whatsapp_access_token)
    }
    if (typeof c.dispatch_secret === 'string' && c.dispatch_secret.length > 0) {
      update.dispatch_secret = c.dispatch_secret
    }
    const { error } = await supabaseAdmin.from('digest_channel_config').update(update).eq('id', true)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (Array.isArray(body.subscriptions)) {
    for (const s of body.subscriptions) {
      if (!s.profile_id || !s.period) continue

      // Role-appropriate blocks enforced server-side -- a manager/employee
      // subscription can never carry a financial block even via a crafted request.
      const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', s.profile_id).single()
      const role = profile?.role || 'employee'
      const allowedBlocks = role === 'owner'
        ? ['kpis', 'inventory', 'receivables', 'data_health']
        : role === 'manager'
          ? ['kpis', 'inventory', 'receivables']
          : ['inventory']
      const blocks = Array.isArray(s.blocks) ? s.blocks.filter((b: string) => allowedBlocks.includes(b)) : allowedBlocks

      const { error } = await supabaseAdmin.from('digest_subscriptions').upsert({
        profile_id: s.profile_id,
        period: s.period,
        enabled: !!s.enabled,
        channels: s.channels || { email: true, whatsapp: false, in_app: true },
        hour_local: typeof s.hour_local === 'number' ? s.hour_local : 21,
        timezone: s.timezone || 'Asia/Kolkata',
        whatsapp_number: s.whatsapp_number || null,
        email_override: s.email_override || null,
        blocks,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'profile_id,period' })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true })
}

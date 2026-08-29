// Digest send path. Two callers:
//   1. pg_cron's dispatch_digests() (every 15 min), authenticated via the shared
//      x-cron-secret header stored in digest_channel_config.dispatch_secret.
//   2. An owner-authenticated "Send me this now" preview from Settings -> Digests
//      (?preview=1, Bearer token instead of the cron header).
// Either way, one subscription -> one call -> up to three channel sends, each
// logged to digest_runs with a unique (subscription, period, period_start,
// channel) constraint so an overlapping cron tick can never double-send -- the
// same atomic-claim idiom adopted after the scan_activity_due_dates() race.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { sendEmail } from '@/lib/email'
import { sendWhatsAppTemplate } from '@/lib/whatsapp'
import { buildDigestPayload, periodRange, isDueToday, type DigestPeriod, type DigestRole } from '@/lib/digests/build'
import { renderDigestEmail, renderWhatsAppParams, renderInAppBody } from '@/lib/digests/render'

async function resolveRole(profileId: string): Promise<DigestRole> {
  const { data } = await supabaseAdmin.from('profiles').select('role').eq('id', profileId).single()
  return (data?.role as DigestRole) || 'employee'
}

// "owner@x.com, accountant@y.com; partner@z.com" -> ['owner@x.com', 'accountant@y.com', 'partner@z.com']
function parseEmailList(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
}

async function claimRun(subscriptionId: string, period: string, periodStart: string, channel: string) {
  // ON CONFLICT DO NOTHING + checking rowCount is the atomic claim: only the
  // request that actually inserts the row goes on to send.
  const { data, error } = await supabaseAdmin
    .from('digest_runs')
    .insert({ subscription_id: subscriptionId, period, period_start: periodStart, period_end: periodStart, channel, status: 'sent' })
    .select('id')
  return !error && !!data?.length
}

async function markResult(subscriptionId: string, period: string, periodStart: string, channel: string, ok: boolean, messageId?: string, errorMessage?: string) {
  await supabaseAdmin
    .from('digest_runs')
    .update({ status: ok ? 'sent' : 'failed', provider_message_id: messageId || null, error_message: errorMessage || null })
    .eq('subscription_id', subscriptionId).eq('period', period).eq('period_start', periodStart).eq('channel', channel)
}

async function runSubscription(subscriptionId: string, preview: boolean) {
  const { data: sub } = await supabaseAdmin.from('digest_subscriptions').select('*').eq('id', subscriptionId).single()
  if (!sub || (!sub.enabled && !preview)) return { skipped: true, reason: 'disabled' }

  const period = sub.period as DigestPeriod
  if (!preview && !isDueToday(period)) return { skipped: true, reason: 'not due today' }

  const role = await resolveRole(sub.profile_id)
  const { from } = periodRange(period)
  const payload = await buildDigestPayload(period, role)

  const channels = sub.channels || {}
  const results: Record<string, any> = {}

  if (channels.email) {
    const claimed = preview || (await claimRun(sub.id, period, from, 'email'))
    if (claimed) {
      // email_override supports multiple comma/semicolon-separated addresses (e.g.
      // "owner@x.com, accountant@y.com") -- when set, it fully replaces the
      // single-address profile lookup rather than adding to it.
      let to: string[] = parseEmailList(sub.email_override)
      if (to.length === 0) {
        const { data: profile } = await supabaseAdmin.from('profiles').select('contact_email').eq('id', sub.profile_id).single()
        if (profile?.contact_email) {
          to = [profile.contact_email]
        } else {
          const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(sub.profile_id)
          if (authUser.user?.email) to = [authUser.user.email]
        }
      }
      if (to.length > 0) {
        const { subject, html } = renderDigestEmail(payload)
        const res = await sendEmail({ to, subject, html })
        if (!preview) await markResult(sub.id, period, from, 'email', res.success, res.messageId, res.error)
        results.email = res
      } else {
        results.email = { success: false, error: 'No email address on file' }
      }
    } else {
      results.email = { success: false, error: 'Already sent for this period' }
    }
  }

  if (channels.whatsapp && sub.whatsapp_number) {
    const claimed = preview || (await claimRun(sub.id, period, from, 'whatsapp'))
    if (claimed) {
      const { data: cfg } = await supabaseAdmin.from('digest_channel_config').select('*').eq('id', true).single()
      if (cfg?.whatsapp_enabled) {
        const res = await sendWhatsAppTemplate({
          to: sub.whatsapp_number,
          config: {
            phoneNumberId: cfg.whatsapp_phone_number_id,
            accessTokenEncrypted: cfg.whatsapp_access_token_encrypted,
            templateName: cfg.whatsapp_template_name,
            graphApiVersion: cfg.whatsapp_graph_api_version,
          },
          bodyParams: renderWhatsAppParams(payload),
        })
        if (!preview) await markResult(sub.id, period, from, 'whatsapp', res.success, res.messageId, res.error)
        results.whatsapp = res
      } else {
        results.whatsapp = { success: false, error: 'WhatsApp channel not enabled in Settings -> Digests' }
      }
    } else {
      results.whatsapp = { success: false, error: 'Already sent for this period' }
    }
  }

  if (channels.in_app) {
    const claimed = preview || (await claimRun(sub.id, period, from, 'in_app'))
    if (claimed) {
      const { title, body } = renderInAppBody(payload)
      const { error } = await supabaseAdmin.from('notifications').insert({
        recipient_id: sub.profile_id, type: 'digest', actor_id: null, title, body,
        link: '/dashboard/reports',
      })
      if (!preview) await markResult(sub.id, period, from, 'in_app', !error, undefined, error?.message)
      results.in_app = { success: !error, error: error?.message }
    } else {
      results.in_app = { success: false, error: 'Already sent for this period' }
    }
  }

  return { skipped: false, period, from, results }
}

export async function POST(req: NextRequest) {
  const preview = req.nextUrl.searchParams.get('preview') === '1'

  if (preview) {
    const sessionUser = await getSessionUser(req)
    if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  } else {
    const { data: cfg } = await supabaseAdmin.from('digest_channel_config').select('dispatch_secret').eq('id', true).single()
    const provided = req.headers.get('x-cron-secret')
    if (!cfg?.dispatch_secret || !provided || provided !== cfg.dispatch_secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const body = await req.json().catch(() => ({}))
  const subscriptionId = body.subscription_id
  if (!subscriptionId) return NextResponse.json({ error: 'subscription_id is required' }, { status: 400 })

  try {
    const result = await runSubscription(subscriptionId, preview)
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Digest send failed' }, { status: 500 })
  }
}

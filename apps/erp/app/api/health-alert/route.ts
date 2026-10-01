import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { sendEmail } from '@/lib/email'

// External health check, designed to be called from OUTSIDE the house.
//
// System Health (/dashboard/monitoring) only tells you something is wrong while
// you are looking at it. On 2026-10-01 the server was down for 90 minutes and
// nobody noticed. This endpoint is the half that reaches out to you.
//
// It runs on Vercel, so it keeps working when the ProDesk does not -- which is
// exactly when it matters.
//
// Two ways to use it, and they compose:
//   1. Point an external monitor (UptimeRobot, Better Stack, Healthchecks) at
//      it every few minutes. It answers 503 when unhealthy, so the monitor
//      alerts without this app needing to send anything.
//   2. Let it email directly. Any call that detects a problem emails
//      ALERT_EMAIL (falling back to RESEND_FROM_EMAIL).
//
// Auth: a shared token, since this cannot use a user session -- a monitoring
// service has no login. Set HEALTH_ALERT_TOKEN and pass ?token=... .
export const dynamic = 'force-dynamic'

// The box samples every minute; 5 missed samples is unambiguous without being
// trigger-happy about one slow write.
const STALE_SECONDS = 300

export async function GET(req: NextRequest) {
  const token = process.env.HEALTH_ALERT_TOKEN
  const given = new URL(req.url).searchParams.get('token')
  if (!token || given !== token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const problems: string[] = []
  const detail: Record<string, unknown> = {}

  // 1. Can we reach the database API at all? This is the single most important
  //    question -- if this fails, both apps are effectively down.
  let dbReachable = false
  try {
    const started = Date.now()
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    // Any HTTP answer proves the tunnel and gateway are alive; 401 is normal
    // here because no apikey is sent. Cloudflare returns 52x/530 when it
    // cannot reach the origin, which is the real failure.
    dbReachable = res.status > 0 && res.status < 500
    detail.databaseStatus = res.status
    detail.databaseLatencyMs = Date.now() - started
    if (!dbReachable) problems.push(`Database API returned HTTP ${res.status} — the tunnel or the server is down.`)
  } catch (e) {
    problems.push(`Database API is unreachable: ${e instanceof Error ? e.message : 'request failed'}`)
    detail.databaseStatus = 0
  }

  // 2. Is the server still reporting? Only meaningful if we can query at all.
  if (dbReachable) {
    const { data, error } = await supabaseAdmin
      .from('server_metrics')
      .select('recorded_at, disk_used_bytes, disk_total_bytes, containers_healthy, containers_total, tunnel_ok, active_interface, backup_last_at, reboot_required')
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      problems.push(`Could not read server vitals: ${error.message}`)
    } else if (!data) {
      problems.push('No server vitals have ever been recorded.')
    } else {
      const ageSec = Math.round((Date.now() - new Date(data.recorded_at).getTime()) / 1000)
      detail.vitalsAgeSeconds = ageSec
      if (ageSec > STALE_SECONDS) {
        problems.push(`The server has not reported for ${Math.round(ageSec / 60)} minutes. It may be off or offline.`)
      }
      if (data.containers_total && data.containers_healthy !== data.containers_total) {
        problems.push(`Only ${data.containers_healthy} of ${data.containers_total} containers are healthy.`)
      }
      if (data.tunnel_ok === false) problems.push('The server reports its Cloudflare tunnel is down.')
      if (data.active_interface && data.active_interface !== 'enp2s0') {
        problems.push('Running on the WiFi backup — the LAN link or its ISP is down, so there is no second line left.')
      }
      if (data.disk_total_bytes) {
        const pct = (Number(data.disk_used_bytes) / Number(data.disk_total_bytes)) * 100
        detail.diskPercent = Math.round(pct)
        if (pct > 85) problems.push(`Disk is ${pct.toFixed(0)}% full.`)
      }
      if (data.backup_last_at) {
        const hrs = (Date.now() - new Date(data.backup_last_at).getTime()) / 3_600_000
        detail.backupAgeHours = Math.round(hrs * 10) / 10
        if (hrs > 3) problems.push(`No backup for ${hrs.toFixed(1)} hours — the hourly timer has probably stopped.`)
      }
      if (data.reboot_required) problems.push('A restart is pending to finish a security update.')
    }
  }

  const healthy = problems.length === 0

  if (!healthy) {
    const to = process.env.ALERT_EMAIL || process.env.RESEND_FROM_EMAIL
    if (to) {
      await sendEmail({
        to,
        subject: `ERP alert: ${problems.length} problem${problems.length > 1 ? 's' : ''} detected`,
        html: `<p>The automated check found the following:</p><ul>${problems
          .map(p => `<li>${p}</li>`)
          .join('')}</ul><p>Open System Health for detail: <a href="https://erp.digitalbluez.com/dashboard/monitoring">erp.digitalbluez.com/dashboard/monitoring</a></p>`,
      }).catch(() => {
        // Never let a failed email turn into a failed health check -- the 503
        // below is what an external monitor acts on.
      })
    }
  }

  // 503 rather than 200-with-a-flag, so a plain uptime monitor that only looks
  // at the status code still alerts correctly.
  return NextResponse.json(
    { healthy, problems, detail, checkedAt: new Date().toISOString() },
    { status: healthy ? 200 : 503 }
  )
}

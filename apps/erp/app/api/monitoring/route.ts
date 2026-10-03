import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { withRetry } from '@/lib/db-retry'

// System Health feed for /dashboard/monitoring.
//
// Owner-only: this exposes infrastructure detail (host addresses, container
// names, backup sizes) that no other role has any reason to see, and unlike
// most pages there is no partial view worth granting -- so it is isOwner()
// rather than a page-key grant.
//
// Host vitals are NOT polled from here. The ProDesk writes its own metrics
// into public.server_metrics once a minute (/usr/local/bin/erp-metrics.sh via
// erp-metrics.timer), so this route is a plain read. That matters: if the box
// is down, there is nothing to poll, and the absence of fresh rows is itself
// the signal -- `stale` below is computed from the newest sample's age.
export const dynamic = 'force-dynamic'

const STALE_AFTER_SECONDS = 180 // 3 missed samples

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const [latestRes, historyRes, healthRes, bootsRes] = await Promise.all([
    withRetry(() =>
      supabaseAdmin
        .from('server_metrics')
        .select('*')
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    ),
    // ~3 hours at one sample a minute -- enough for the trend strips without
    // shipping a day of rows to the browser on every refresh.
    withRetry(() =>
      supabaseAdmin
        .from('server_metrics')
        .select('recorded_at, load_1, cpu_temp_c, mem_used_bytes, disk_used_bytes, containers_healthy, tunnel_ok, active_interface')
        .order('recorded_at', { ascending: false })
        .limit(180)
    ),
    withRetry(() =>
      supabaseAdmin
        .from('website_health_checks')
        .select('checked_at, url, ok, status_code, latency_ms, error_message')
        .order('checked_at', { ascending: false })
        .limit(20)
    ),
    // Power-outage / restart history. Written once per boot by
    // erp-boot-event.service, which reads the PREVIOUS boot's journal to work
    // out whether the machine was shut down on purpose or lost power -- a gap
    // in server_metrics proves it was down but can never say why.
    withRetry(() =>
      supabaseAdmin
        .from('server_boot_events')
        .select('boot_id, booted_at, previous_last_seen_at, downtime_seconds, shutdown_kind, detail')
        .order('booted_at', { ascending: false })
        .limit(25)
    ),
  ])

  const latest = latestRes.data as Record<string, unknown> | null
  const history = (historyRes.data || []).slice().reverse()
  const healthChecks = healthRes.data || []

  // Report query failures instead of letting them look like "no data". Without
  // this, a permissions or connectivity problem renders as the same empty page
  // as a genuinely silent server, which is exactly the ambiguity that makes an
  // outage page useless -- "nothing reported" and "could not ask" must not look
  // identical.
  const queryErrors = [
    latestRes.error ? `server_metrics: ${latestRes.error.message}` : null,
    historyRes.error ? `history: ${historyRes.error.message}` : null,
    healthRes.error ? `website_health_checks: ${healthRes.error.message}` : null,
    bootsRes.error ? `server_boot_events: ${bootsRes.error.message}` : null,
  ].filter(Boolean) as string[]

  const boots = (bootsRes.data || []) as BootEvent[]
  const power = summarisePower(boots)

  const latestAgeSeconds = latest?.recorded_at
    ? Math.round((Date.now() - new Date(latest.recorded_at as string).getTime()) / 1000)
    : null

  // Live endpoint probes. Done here rather than on the box so that an "is the
  // public site reachable" answer does not depend on the box being healthy --
  // these run from Vercel, i.e. from outside the house.
  const endpoints = await probeEndpoints()

  // Database size and the heaviest tables, straight from Postgres.
  const dbRes = await withRetry(() => supabaseAdmin.rpc('monitoring_db_stats'))
    .catch((e: unknown) => ({ data: null, error: { message: e instanceof Error ? e.message : 'rpc failed' } }))
  const dbStats = dbRes.data
  if (dbRes.error) queryErrors.push(`monitoring_db_stats: ${dbRes.error.message}`)

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    server: latest,
    serverAgeSeconds: latestAgeSeconds,
    serverStale: latestAgeSeconds === null || latestAgeSeconds > STALE_AFTER_SECONDS,
    staleAfterSeconds: STALE_AFTER_SECONDS,
    history,
    healthChecks,
    endpoints,
    db: dbStats ?? null,
    boots,
    power,
    queryErrors,
  })
}

type BootEvent = {
  boot_id: string
  booted_at: string
  previous_last_seen_at: string | null
  downtime_seconds: number | null
  shutdown_kind: string
  detail: string | null
}

// Roll the boot log up into the few numbers worth putting on a card.
//
// The window is deliberately "the last 30 days OR as far back as the record
// goes, whichever is shorter", and `windowDays` is reported alongside the
// percentage. Dividing 30 days of downtime by 30 days when we only hold 4 days
// of history would overstate availability roughly sevenfold -- an uptime figure
// that flatters itself is worse than none at all.
function summarisePower(boots: BootEvent[]) {
  if (boots.length === 0) {
    return { lastOutage: null, unplannedCount: 0, plannedCount: 0,
             downtimeSeconds: 0, windowDays: 0, availability: null }
  }

  const now = Date.now()
  const thirtyDaysAgo = now - 30 * 86400_000
  const inWindow = boots.filter(b => new Date(b.booted_at).getTime() >= thirtyDaysAgo)

  // The oldest boot we hold is the start of what we can actually speak to. Its
  // own downtime is excluded from the total, because we have no idea what
  // preceded it (shutdown_kind is 'first_boot' precisely for that reason).
  const oldest = inWindow.length
    ? Math.min(...inWindow.map(b => new Date(b.booted_at).getTime()))
    : now
  const windowStart = Math.max(oldest, thirtyDaysAgo)
  const windowSeconds = Math.max(1, (now - windowStart) / 1000)

  const measurable = inWindow.filter(
    b => b.shutdown_kind !== 'first_boot' && b.downtime_seconds !== null
  )
  const downtimeSeconds = measurable.reduce((s, b) => s + (b.downtime_seconds || 0), 0)

  const unplanned = measurable.filter(
    b => b.shutdown_kind === 'power_loss' || b.shutdown_kind === 'crash'
  )
  const lastOutage = unplanned
    .slice()
    .sort((a, b) => new Date(b.booted_at).getTime() - new Date(a.booted_at).getTime())[0] || null

  return {
    lastOutage,
    unplannedCount: unplanned.length,
    plannedCount: measurable.length - unplanned.length,
    downtimeSeconds,
    windowDays: Math.round((now - windowStart) / 86400_000 * 10) / 10,
    availability:
      Math.round(Math.max(0, 1 - downtimeSeconds / windowSeconds) * 10000) / 100,
  }
}

async function probeEndpoints() {
  const targets = [
    { key: 'erp', label: 'ERP', url: 'https://erp.digitalbluez.com/login' },
    { key: 'website', label: 'Storefront', url: 'https://digitalbluez.com' },
    { key: 'database', label: 'Database API', url: 'https://db.digitalbluez.com/auth/v1/health' },
  ]

  return Promise.all(
    targets.map(async t => {
      const started = Date.now()
      try {
        const res = await fetch(t.url, {
          method: 'GET',
          cache: 'no-store',
          signal: AbortSignal.timeout(10_000),
        })
        return {
          ...t,
          // 401 from the database API is a healthy answer: it means Envoy
          // replied, which is what we are actually testing. Cloudflare's 52x/530
          // is the real "origin unreachable" signal.
          ok: res.status < 500,
          status: res.status,
          latencyMs: Date.now() - started,
          error: null as string | null,
        }
      } catch (err) {
        return {
          ...t,
          ok: false,
          status: 0,
          latencyMs: Date.now() - started,
          error: err instanceof Error ? err.message : 'request failed',
        }
      }
    })
  )
}

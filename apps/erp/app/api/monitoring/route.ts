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

  const [latestRes, historyRes, healthRes] = await Promise.all([
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
  ].filter(Boolean) as string[]

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
    queryErrors,
  })
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

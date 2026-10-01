'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import RequireOwner from '@/components/RequireOwner'
import { ErrorBanner } from '@/components/ErrorBanner'
import { Button } from '@/components/ui/button'
import { RefreshCw, Info } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

// System Health. Everything here is read-only; the page never writes.
//
// Host vitals come from public.server_metrics, which the ProDesk writes into
// itself every minute. The freshness of that row is the most important signal
// on the page: if the box is off or has lost both links, nothing new arrives
// and `serverStale` goes true, which is exactly the outage we could not see on
// 2026-10-01 until someone went and looked at the machine.

type Server = Record<string, number | string | boolean | string[] | null>

interface Endpoint {
  key: string; label: string; url: string
  ok: boolean; status: number; latencyMs: number; error: string | null
}

interface Payload {
  generatedAt: string
  server: Server | null
  serverAgeSeconds: number | null
  serverStale: boolean
  staleAfterSeconds: number
  history: Record<string, number | string | boolean | null>[]
  healthChecks: { checked_at: string; url: string; ok: boolean; status_code: number | null; latency_ms: number | null; error_message: string | null }[]
  endpoints: Endpoint[]
  queryErrors?: string[]
  db: {
    database_bytes: number; connections: number; max_connections: number
    postgres_version: string
    largest_tables: { table_name: string; total_bytes: number; row_estimate: number }[]
    cron_jobs: { jobname: string; schedule: string; active: boolean }[]
  } | null
}

const REFRESH_MS = 30_000

function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n, i = 0
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`
}

function duration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '—'
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function ago(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function Dot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  const tone = warn ? 'bg-amber-500' : ok ? 'bg-emerald-500' : 'bg-destructive'
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${tone}`} aria-hidden />
}

// A short "what is this and why do I care" note behind an (i). A popover
// rather than a title attribute so it works on a phone, where this page is
// most likely to be opened in a hurry.
function InfoHint({ text }: { text: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="What is this?"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-w-xs text-xs leading-relaxed">
        {text}
      </PopoverContent>
    </Popover>
  )
}

function Card({ title, children, right, info }: { title: string; children: React.ReactNode; right?: React.ReactNode; info?: string }) {
  return (
    <div className="rounded-md border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          {title}
          {info && <InfoHint text={info} />}
        </h2>
        {right}
      </div>
      {children}
    </div>
  )
}

function Row({ label, value, tone, hint }: { label: string; value: React.ReactNode; tone?: 'bad' | 'warn'; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground">
        {label}
        {/* The number alone does not tell you whether to worry -- 51 degrees
            means nothing without knowing the safe range for this machine. */}
        {hint && <span className="ml-1.5 text-xs opacity-70">({hint})</span>}
      </span>
      <span className={`tabular-nums font-medium ${tone === 'bad' ? 'text-destructive' : tone === 'warn' ? 'text-amber-600' : ''}`}>{value}</span>
    </div>
  )
}

// Thresholds for THIS machine (HP ProDesk 400 G2 Mini, i5-6500T, 32GB, 466GB
// SSD) running the Supabase stack. Chosen against what the hardware actually
// tolerates, not generic server advice:
//   temp   - Intel 6th-gen Tjunction is ~100C; it throttles before damage, so
//            85 is "act" and 75 is "watch", leaving real headroom.
//   load   - relative to 4 cores: sustained load above core count means work is
//            queueing. A 43MB database should never get close.
//   disk   - Postgres and the hourly backups both grow here; 85% is where a
//            WAL spike could genuinely fill the disk.
//   backup - the timer is hourly, so >1.5h means one run was missed and >3h
//            means the timer itself is broken.
type Level = 'good' | 'watch' | 'act'
function level(value: number | null, watch: number, act: number): Level {
  if (value === null || Number.isNaN(value)) return 'good'
  if (value >= act) return 'act'
  if (value >= watch) return 'watch'
  return 'good'
}
const toneOf = (l: Level) => (l === 'act' ? 'bad' : l === 'watch' ? 'warn' : undefined) as 'bad' | 'warn' | undefined

// Tiny inline trend strip. Deliberately not a chart library -- this is 180
// points of one series and a sparkline communicates the shape just as well
// without adding a dependency to the bundle.
function Spark({ values, suffix }: { values: (number | null)[]; suffix?: string }) {
  const nums = values.filter((v): v is number => typeof v === 'number')
  if (nums.length < 2) return <span className="text-xs text-muted-foreground">not enough data yet</span>
  const min = Math.min(...nums), max = Math.max(...nums)
  const span = max - min || 1
  const pts = nums.map((v, i) => `${(i / (nums.length - 1)) * 100},${100 - ((v - min) / span) * 100}`).join(' ')
  return (
    <div className="flex items-center gap-2">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-8 w-full">
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" className="text-primary" />
      </svg>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {nums[nums.length - 1].toFixed(1)}{suffix}
      </span>
    </div>
  )
}

function MonitoringInner() {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/monitoring')
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error || `Could not load system health (HTTP ${res.status}).`)
        return
      }
      setData(await res.json())
      setError('')
    } catch {
      // A failure here usually means the ERP itself cannot reach its backend,
      // which is worth saying plainly rather than showing an empty page.
      setError('Could not reach the monitoring endpoint.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  const s = data?.server
  const memPct = s && s.mem_total_bytes ? (Number(s.mem_used_bytes) / Number(s.mem_total_bytes)) * 100 : null
  const diskPct = s && s.disk_total_bytes ? (Number(s.disk_used_bytes) / Number(s.disk_total_bytes)) * 100 : null
  const loadPct = s && s.cpu_count ? (Number(s.load_1) / Number(s.cpu_count)) * 100 : null
  const unhealthy = (s?.containers_unhealthy as string[] | undefined) || []
  const backupAgeH = s?.backup_last_at ? (Date.now() - new Date(String(s.backup_last_at)).getTime()) / 3_600_000 : null
  const tempC = s?.cpu_temp_c != null ? Number(s.cpu_temp_c) : null
  const upDays = s?.uptime_seconds != null ? Number(s.uptime_seconds) / 86400 : null
  const rebootNeeded = s?.reboot_required === true
  const secUpdates = s?.pending_security_updates != null ? Number(s.pending_security_updates) : null

  const lvl = {
    temp: level(tempC, 75, 85),
    load: level(loadPct, 70, 100),
    mem: level(memPct, 75, 90),
    disk: level(diskPct, 70, 85),
    backup: level(backupAgeH, 1.5, 3),
  }

  // Plain-language actions, worst first. Each says what to do, not just that a
  // number is high -- a dashboard that only colours things red still leaves you
  // guessing.
  const actions: { level: Level; text: string }[] = []
  if (data?.serverStale) actions.push({ level: 'act', text: 'The server is not reporting. Check that the ProDesk is powered on and that at least one internet link is up.' })
  if (rebootNeeded) actions.push({ level: 'act', text: `A restart is needed to finish a security update${s?.reboot_required_pkgs ? ` (${String(s.reboot_required_pkgs)})` : ''}. Plan 3-5 minutes of downtime — everything comes back automatically.` })
  if (unhealthy.length > 0) actions.push({ level: 'act', text: `Container(s) not healthy: ${unhealthy.join(', ')}. The stack may be partly down.` })
  if (lvl.disk === 'act') actions.push({ level: 'act', text: 'Disk is nearly full. Old backups are pruned automatically, so investigate before it stops accepting writes.' })
  if (lvl.backup === 'act') actions.push({ level: 'act', text: 'No backup for over 3 hours — the hourly timer has probably stopped.' })
  if (s && s.tunnel_ok === false) actions.push({ level: 'act', text: 'The Cloudflare tunnel is down, so the ERP and website cannot reach the database.' })
  if (s && s.active_interface && String(s.active_interface) !== 'enp2s0') actions.push({ level: 'watch', text: 'Running on the WiFi backup — the LAN link or its ISP is down. Service is fine, but you have no second line left.' })
  if (lvl.temp === 'act') actions.push({ level: 'act', text: 'Running hot. Check the vents are clear and the fan is spinning.' })
  else if (lvl.temp === 'watch') actions.push({ level: 'watch', text: 'Temperature is higher than usual. Worth checking for dust in the vents.' })
  if (lvl.disk === 'watch') actions.push({ level: 'watch', text: 'Disk is filling up. Fine for now, but keep an eye on it.' })
  if (lvl.backup === 'watch') actions.push({ level: 'watch', text: 'The last backup is older than an hour — one run may have been missed.' })
  if (lvl.mem === 'act') actions.push({ level: 'act', text: 'Memory is nearly exhausted.' })
  if (lvl.load === 'act') actions.push({ level: 'act', text: 'CPU is saturated — work is queueing.' })
  if (secUpdates !== null && secUpdates > 0 && !rebootNeeded) actions.push({ level: 'watch', text: `${secUpdates} security update(s) pending. They install automatically; a restart is only needed if this page later asks for one.` })
  if (!rebootNeeded && upDays !== null && upDays > 90) actions.push({ level: 'watch', text: `Up ${Math.round(upDays)} days with no restart pending. Linux does not need routine reboots, but a planned one now and then proves it still boots cleanly.` })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">System Health</h1>
          <p className="text-sm text-muted-foreground">
            {data ? `Updated ${ago(data.generatedAt)} · auto-refreshes every ${REFRESH_MS / 1000}s` : 'Loading…'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {(data?.queryErrors?.length ?? 0) > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <strong className="text-destructive">Some vitals could not be read.</strong>
          <ul className="mt-1 list-inside list-disc">
            {data!.queryErrors!.map((q, i) => <li key={i} className="font-mono text-xs">{q}</li>)}
          </ul>
        </div>
      )}

      {data?.serverStale && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <strong className="text-destructive">The server has stopped reporting.</strong>{' '}
          Last sample {ago(String(s?.recorded_at ?? ''))}
          {data.serverAgeSeconds !== null && ` (${data.serverAgeSeconds}s)`}. It samples every
          minute, so anything over {data.staleAfterSeconds}s means the ProDesk is off, has lost
          both internet links, or its collector has stopped.
        </div>
      )}

      <Card
        title={actions.length === 0 ? 'Everything looks healthy' : 'Needs your attention'}
        right={<span className="text-xs text-muted-foreground">{actions.length === 0 ? 'no action needed' : `${actions.length} item(s)`}</span>}
      >
        {actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            All vitals are within their normal ranges, the stack is fully up, and backups are current.
            Nothing to do.
          </p>
        ) : (
          <ul className="space-y-2">
            {actions
              .slice()
              .sort((a, b) => (a.level === b.level ? 0 : a.level === 'act' ? -1 : 1))
              .map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5"><Dot ok={false} warn={a.level === 'watch'} /></span>
                  <span>
                    <strong className={a.level === 'act' ? 'text-destructive' : 'text-amber-600'}>
                      {a.level === 'act' ? 'Act: ' : 'Watch: '}
                    </strong>
                    {a.text}
                  </span>
                </li>
              ))}
          </ul>
        )}
        <details className="mt-3 border-t pt-3">
          <summary className="cursor-pointer text-xs text-muted-foreground">What counts as normal, and when to restart</summary>
          <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
            <p><strong>Temperature</strong> — under 75 °C is normal for this machine, 75-85 °C worth checking, over 85 °C act. It throttles itself long before any damage.</p>
            <p><strong>CPU load</strong> — compared against 4 cores. Under 70% is normal; sustained above 100% means work is queueing.</p>
            <p><strong>Memory</strong> — under 75% is normal. The database is small, so high memory use would be unusual.</p>
            <p><strong>Disk</strong> — under 70% is normal, over 85% act. Postgres and the hourly backups both grow here.</p>
            <p><strong>Backups</strong> — hourly. Older than 1.5h means a run was missed; older than 3h means the timer has stopped.</p>
            <p>
              <strong>Restarting</strong> — Linux does not need routine reboots, so uptime alone is not a reason.
              This page will say so explicitly when a security update has replaced something the running system is
              still using. A restart takes 3-5 minutes: the stack, the tunnel and the backup timer all come back on
              their own, so plan it outside working hours and nothing else is needed.
            </p>
          </div>
        </details>
      </Card>

      {/* Public endpoints -- probed from Vercel, so these stay meaningful even
          when the box itself is unreachable. */}
      <Card
            title="Public endpoints"
            info="Checked live from Vercel every time this page loads — that is, from outside your premises. This is what a customer or staff member on the internet would get. The Database API answering 401 is correct and healthy: it means the gateway replied but was not given a key." right={<span className="text-xs text-muted-foreground">checked from outside your network</span>}>
        <div className="grid gap-2 sm:grid-cols-3">
          {(data?.endpoints || []).map(e => (
            <div key={e.key} className="rounded-md border p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Dot ok={e.ok} /> {e.label}
              </div>
              <div className="mt-1 text-xs tabular-nums text-muted-foreground">
                {e.ok ? `HTTP ${e.status} · ${e.latencyMs} ms` : e.error || `HTTP ${e.status}`}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Server — HP ProDesk" right={s ? <span className="text-xs text-muted-foreground">{String(s.hostname)}</span> : null}>
          {s ? (
            <>
              <Row label="CPU load (1m)" hint="normal under 70%" value={`${Number(s.load_1).toFixed(2)} of ${s.cpu_count} cores${loadPct ? ` (${loadPct.toFixed(0)}%)` : ''}`} tone={toneOf(lvl.load)} />
              <Row label="Temperature" hint="normal under 75 °C" value={tempC !== null ? `${tempC.toFixed(1)} °C` : '—'} tone={toneOf(lvl.temp)} />
              <Row label="Memory" hint="normal under 75%" value={`${bytes(Number(s.mem_used_bytes))} / ${bytes(Number(s.mem_total_bytes))}${memPct ? ` (${memPct.toFixed(0)}%)` : ''}`} tone={toneOf(lvl.mem)} />
              <Row label="Disk" hint="normal under 70%" value={`${bytes(Number(s.disk_used_bytes))} / ${bytes(Number(s.disk_total_bytes))}${diskPct ? ` (${diskPct.toFixed(0)}%)` : ''}`} tone={toneOf(lvl.disk)} />
              <Row label="Uptime" value={duration(Number(s.uptime_seconds))} />
              <Row
                label="Restart needed"
                hint="only after a kernel update"
                value={rebootNeeded ? 'Yes — plan a restart' : 'No'}
                tone={rebootNeeded ? 'bad' : undefined}
              />
              <Row label="Updates pending" value={`${s.pending_updates ?? '—'}${secUpdates ? ` (${secUpdates} security)` : ''}`} tone={secUpdates ? 'warn' : undefined} />
              <Row label="Last report" value={ago(String(s.recorded_at))} tone={data?.serverStale ? 'bad' : undefined} />
              <div className="mt-3 border-t pt-3">
                <div className="mb-1 text-xs text-muted-foreground">CPU load trend (last 3h)</div>
                <Spark values={(data?.history || []).map(h => (h.load_1 === null ? null : Number(h.load_1)))} />
                <div className="mb-1 mt-2 text-xs text-muted-foreground">Temperature trend</div>
                <Spark values={(data?.history || []).map(h => (h.cpu_temp_c === null ? null : Number(h.cpu_temp_c)))} suffix=" °C" />
              </div>
            </>
          ) : <p className="text-sm text-muted-foreground">No samples yet.</p>}
        </Card>

        <Card
            title="Internet links"
            info="Your two internet connections. Traffic normally uses the LAN; if it fails, the WiFi dongle takes over automatically and hands back when the LAN returns. If this shows WiFi in use, everything still works — but you have no backup line left until the LAN is fixed."
          >
          {s ? (
            <>
              <div className="mb-3 rounded-md bg-muted/50 p-2 text-sm">
                Traffic is using <strong>{String(s.active_interface) === 'enp2s0' ? 'LAN (primary)' : 'WiFi (backup)'}</strong>
                {String(s.active_interface) !== 'enp2s0' && ' — the LAN link is down or its ISP is unreachable.'}
              </div>
              <Row label="LAN (ethernet)" value={<span className="flex items-center gap-2"><Dot ok={!!s.lan_up} /> {s.lan_up ? 'online' : 'offline'} · metric {String(s.lan_metric ?? '—')}</span>} />
              <Row label="WiFi (backup)" value={<span className="flex items-center gap-2"><Dot ok={!!s.wifi_up} /> {s.wifi_up ? 'online' : 'offline'} · metric {String(s.wifi_metric ?? '—')}</span>} />
              <Row label="Cloudflare tunnel" value={<span className="flex items-center gap-2"><Dot ok={!!s.tunnel_ok} /> {s.tunnel_ok ? 'connected' : 'down'}</span>} tone={s.tunnel_ok ? undefined : 'bad'} />
              <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                Metric 100 means the LAN is healthy and carrying traffic. 2000 means the watchdog
                found its ISP unreachable and moved traffic to WiFi; it restores automatically.
              </p>
            </>
          ) : <p className="text-sm text-muted-foreground">No samples yet.</p>}
        </Card>

        <Card
            title="Supabase stack"
            info="The eleven Docker containers that make up the database service on the ProDesk — Postgres itself plus the gateway, auth, file storage and the rest. All eleven should be healthy. Connections shows how many are in use of the limit; running out is what caused the outages on the old hosted plan." right={s ? <span className="text-xs tabular-nums text-muted-foreground">{String(s.containers_healthy)}/{String(s.containers_total)} healthy</span> : null}>
          {s ? (
            <>
              <div className="flex items-center gap-2 text-sm">
                <Dot ok={unhealthy.length === 0} />
                {unhealthy.length === 0 ? 'All containers healthy' : `${unhealthy.length} container(s) not healthy`}
              </div>
              {unhealthy.length > 0 && (
                <ul className="mt-2 list-inside list-disc text-sm text-destructive">
                  {unhealthy.map(n => <li key={n}>{n}</li>)}
                </ul>
              )}
              {data?.db && (
                <div className="mt-3 border-t pt-3">
                  <Row label="Database size" value={bytes(data.db.database_bytes)} />
                  <Row label="Connections" value={`${data.db.connections} / ${data.db.max_connections}`} tone={data.db.connections / data.db.max_connections > 0.8 ? 'warn' : undefined} />
                  <Row label="PostgreSQL" value={data.db.postgres_version} />
                </div>
              )}
            </>
          ) : <p className="text-sm text-muted-foreground">No samples yet.</p>}
        </Card>

        <Card
            title="Backups"
            info="Taken automatically every hour on the server, with the storage files archived once a day. Older copies are thinned out over time (hourly for 3 days, then daily for a month, then monthly). These currently live on the same machine as the database, so they protect against mistakes and corruption — not against the machine being lost or stolen."
          >
          {s ? (
            <>
              <Row label="Last backup" value={ago(String(s.backup_last_at))} tone={toneOf(lvl.backup)} hint="hourly" />
              <Row label="Size" value={bytes(Number(s.backup_last_bytes))} />
              <Row label="Copies kept" value={String(s.backup_count ?? '—')} />
              <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                Hourly, on the server itself. Not yet copied offsite — a fire or theft would take
                the database and its backups together.
              </p>
            </>
          ) : <p className="text-sm text-muted-foreground">No samples yet.</p>}
        </Card>
      </div>

      {data?.db && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            title="Largest tables"
            info="The biggest tables in your database, by disk space. Useful for two things: spotting what is actually growing (audit_log and asset_qc_checks grow fastest here), and sanity-checking a number you recognise — if asset_ledger suddenly showed far fewer rows than you have units, something is wrong. Row counts are Postgres estimates, so they can be slightly off between maintenance runs."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1 font-medium">Table</th><th className="py-1 text-right font-medium">Rows</th><th className="py-1 text-right font-medium">Size</th></tr></thead>
                <tbody>
                  {data.db.largest_tables.map(t => (
                    <tr key={t.table_name} className="border-b last:border-0">
                      <td className="py-1">{t.table_name}</td>
                      <td className="py-1 text-right tabular-nums">{t.row_estimate.toLocaleString()}</td>
                      <td className="py-1 text-right tabular-nums">{bytes(t.total_bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card
            title="Scheduled jobs"
            info="Background jobs the database runs on a timer, with no one logged in — releasing expired website reservations, sending digest emails, raising due-date and rental reminders, and pruning old job history. The schedule is in UTC (India is 5h30m ahead, so 21:30 UTC is 3:00am here). All should normally show 'on'; a job switched off silently stops that piece of automation."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1 font-medium">Job</th><th className="py-1 font-medium">Schedule</th><th className="py-1 text-right font-medium">State</th></tr></thead>
                <tbody>
                  {data.db.cron_jobs.map(j => (
                    <tr key={j.jobname} className="border-b last:border-0">
                      <td className="py-1">{j.jobname}</td>
                      <td className="py-1 font-mono text-xs text-muted-foreground">{j.schedule}</td>
                      <td className="py-1 text-right"><span className="inline-flex items-center gap-1.5"><Dot ok={j.active} />{j.active ? 'on' : 'off'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {(data?.healthChecks?.length ?? 0) > 0 && (
        <Card
            title="Website health history"
            info="A log of automated checks against the public website, recorded by a scheduled job. Each row is one check: when it ran, what it got back, and how long it took. Occasional slow responses are normal; a run of failures means the storefront was unreachable." right={<span className="text-xs text-muted-foreground">from the scheduled check</span>}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1 font-medium">When</th><th className="py-1 font-medium">URL</th><th className="py-1 text-right font-medium">Status</th><th className="py-1 text-right font-medium">Latency</th></tr></thead>
              <tbody>
                {data!.healthChecks.slice(0, 10).map((h, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1 whitespace-nowrap">{ago(h.checked_at)}</td>
                    <td className="py-1 max-w-[18rem] truncate text-muted-foreground">{h.url}</td>
                    <td className="py-1 text-right"><span className="inline-flex items-center gap-1.5"><Dot ok={h.ok} />{h.status_code ?? '—'}</span></td>
                    <td className="py-1 text-right tabular-nums">{h.latency_ms ? `${h.latency_ms} ms` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

export default function MonitoringPage() {
  return (
    <RequireOwner>
      <MonitoringInner />
    </RequireOwner>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import RequireOwner from '@/components/RequireOwner'
import { ErrorBanner } from '@/components/ErrorBanner'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'

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

function Card({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="rounded-md border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  )
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'bad' | 'warn' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums font-medium ${tone === 'bad' ? 'text-destructive' : tone === 'warn' ? 'text-amber-600' : ''}`}>{value}</span>
    </div>
  )
}

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

      {/* Public endpoints -- probed from Vercel, so these stay meaningful even
          when the box itself is unreachable. */}
      <Card title="Public endpoints" right={<span className="text-xs text-muted-foreground">checked from outside your network</span>}>
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
              <Row label="CPU load (1m)" value={`${Number(s.load_1).toFixed(2)} of ${s.cpu_count} cores`} tone={loadPct && loadPct > 90 ? 'bad' : loadPct && loadPct > 70 ? 'warn' : undefined} />
              <Row label="Temperature" value={s.cpu_temp_c ? `${Number(s.cpu_temp_c).toFixed(1)} °C` : '—'} tone={Number(s.cpu_temp_c) > 85 ? 'bad' : Number(s.cpu_temp_c) > 75 ? 'warn' : undefined} />
              <Row label="Memory" value={`${bytes(Number(s.mem_used_bytes))} / ${bytes(Number(s.mem_total_bytes))}${memPct ? ` (${memPct.toFixed(0)}%)` : ''}`} tone={memPct && memPct > 90 ? 'bad' : undefined} />
              <Row label="Disk" value={`${bytes(Number(s.disk_used_bytes))} / ${bytes(Number(s.disk_total_bytes))}${diskPct ? ` (${diskPct.toFixed(0)}%)` : ''}`} tone={diskPct && diskPct > 85 ? 'bad' : diskPct && diskPct > 75 ? 'warn' : undefined} />
              <Row label="Uptime" value={duration(Number(s.uptime_seconds))} />
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

        <Card title="Internet links">
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

        <Card title="Supabase stack" right={s ? <span className="text-xs tabular-nums text-muted-foreground">{String(s.containers_healthy)}/{String(s.containers_total)} healthy</span> : null}>
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

        <Card title="Backups">
          {s ? (
            <>
              <Row label="Last backup" value={ago(String(s.backup_last_at))} tone={backupAgeH !== null && backupAgeH > 3 ? 'bad' : backupAgeH !== null && backupAgeH > 1.5 ? 'warn' : undefined} />
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
          <Card title="Largest tables">
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

          <Card title="Scheduled jobs">
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
        <Card title="Website health history" right={<span className="text-xs text-muted-foreground">from the scheduled check</span>}>
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

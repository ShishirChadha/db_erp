// Live endpoint probes, run from Vercel -- i.e. from outside the house, so an
// "is the public site reachable" answer does not depend on the box being
// healthy. Shared by System Health (/api/monitoring) and the daily health
// report snapshot (/api/ops/health/snapshot).
export interface EndpointProbe {
  key: string
  label: string
  url: string
  ok: boolean
  status: number
  latencyMs: number
  error: string | null
}

const TARGETS = [
  { key: 'erp', label: 'ERP', url: 'https://erp.digitalbluez.com/login' },
  { key: 'website', label: 'Storefront', url: 'https://digitalbluez.com' },
  { key: 'database', label: 'Database API', url: 'https://db.digitalbluez.com/auth/v1/health' },
]

export async function probeEndpoints(): Promise<EndpointProbe[]> {
  return Promise.all(
    TARGETS.map(async t => {
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
          error: null,
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

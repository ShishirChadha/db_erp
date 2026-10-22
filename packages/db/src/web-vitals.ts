// Server side of real-visitor speed collection, shared by both apps'
// POST /api/vitals (see components/WebVitalsReporter.tsx in each app and
// supabase/migrations/20261022_web_vitals.sql). Server-only: uses the
// service-role client.
//
// The endpoint is public (the storefront has anonymous visitors, the ERP's
// login page has no session yet), so everything is validated and bounded here:
// known metric names only, sane value ranges, short route strings, at most 10
// metrics per beacon, and the route is reduced to a pattern so no ids, slugs,
// or query strings are ever stored.
import { supabaseAdmin } from './admin'

const METRICS = new Set(['TTFB', 'FCP', 'LCP', 'INP', 'CLS'])
const RATINGS = new Set(['good', 'needs-improvement', 'poor'])
const MAX_PER_BEACON = 10

// Ids and slugs collapse to placeholders so per-route p75s group the way the
// app's own route files do, and nothing identifying is kept.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG_PARENTS: Record<'web' | 'erp', string[]> = {
  web: ['product', 'blog', 'order'],
  erp: ['help'],
}

export function normaliseRoute(app: 'web' | 'erp', raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return null
  const path = raw.split(/[?#]/)[0].slice(0, 200)
  const parts = path.split('/').filter(Boolean).map((seg, i, all) => {
    if (UUID.test(seg)) return '[id]'
    if (/^\d+$/.test(seg)) return '[n]'
    if (i > 0 && SLUG_PARENTS[app].includes(all[i - 1])) return '[slug]'
    return seg.length > 60 ? '[long]' : seg.toLowerCase()
  })
  return '/' + parts.join('/')
}

export async function recordWebVitals(app: 'web' | 'erp', body: unknown): Promise<number> {
  const b = body as { route?: unknown; device?: unknown; metrics?: unknown }
  const route = normaliseRoute(app, b?.route)
  if (!route || !Array.isArray(b?.metrics)) return 0
  const device = b.device === 'mobile' || b.device === 'desktop' ? b.device : null

  const rows = (b.metrics as Array<Record<string, unknown>>).slice(0, MAX_PER_BEACON).flatMap(m => {
    const metric = typeof m?.name === 'string' ? m.name : ''
    const value = typeof m?.value === 'number' ? m.value : NaN
    if (!METRICS.has(metric) || !Number.isFinite(value) || value < 0) return []
    // CLS is unitless (0..~5); everything else is milliseconds, capped at 2 min.
    if (metric === 'CLS' ? value > 10 : value > 120_000) return []
    return [{
      app, route, metric, value, device,
      rating: typeof m.rating === 'string' && RATINGS.has(m.rating) ? m.rating : null,
      navigation_type: typeof m.navigationType === 'string' ? m.navigationType.slice(0, 30) : null,
    }]
  })
  if (!rows.length) return 0
  const { error } = await supabaseAdmin.from('web_vitals').insert(rows)
  return error ? 0 : rows.length
}

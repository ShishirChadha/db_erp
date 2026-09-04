// Search Console (CTR, impressions, avg position, top queries/pages) reporting,
// sourced live from Google's Search Analytics API -- like the GA4 website
// route, this data does not live in Supabase, so it gets its own route rather
// than being folded into the report_* RPC dispatcher (apps/erp/app/api/reports).
import { NextRequest, NextResponse } from 'next/server'
import { JWT } from 'google-auth-library'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'

const METRICS = ['summary', 'timeseries', 'top_queries', 'top_pages'] as const
type Metric = (typeof METRICS)[number]

const SEARCH_ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'

interface SearchAnalyticsRow {
  keys?: string[]
  clicks?: number
  impressions?: number
  ctr?: number
  position?: number
}

function getClient(): JWT | null {
  const clientEmail = process.env.GA4_CLIENT_EMAIL
  const privateKey = process.env.GA4_PRIVATE_KEY
  if (!clientEmail || !privateKey) return null
  return new JWT({
    email: clientEmail,
    key: privateKey.replace(/\\n/g, '\n'),
    scopes: [SEARCH_ANALYTICS_SCOPE],
  })
}

async function queryFn(
  client: JWT,
  siteUrl: string,
  body: Record<string, unknown>
): Promise<SearchAnalyticsRow[]> {
  const res = await client.request<{ rows?: SearchAnalyticsRow[] }>({
    url: `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    method: 'POST',
    data: body,
  })
  return res.data.rows || []
}

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'reports')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const siteUrl = process.env.GSC_SITE_URL
  const client = getClient()
  if (!siteUrl || !client) {
    return NextResponse.json({ error: 'Google Search Console is not configured on this server' }, { status: 501 })
  }

  const sp = req.nextUrl.searchParams
  const metric = sp.get('metric') as Metric | null
  if (!metric || !(METRICS as readonly string[]).includes(metric)) {
    return NextResponse.json({ error: `metric must be one of: ${METRICS.join(', ')}` }, { status: 400 })
  }
  // Search Console data lags ~2-3 days behind real time -- default range mirrors
  // that reality rather than "today", which would just come back empty.
  const from = sp.get('from') || defaultFrom()
  const to = sp.get('to') || defaultTo()

  try {
    switch (metric) {
      case 'summary': {
        const rows = await queryFn(client, siteUrl, { startDate: from, endDate: to, rowLimit: 1 })
        const totals = rows.reduce(
          (acc: { clicks: number; impressions: number }, r) => ({
            clicks: acc.clicks + (r.clicks || 0),
            impressions: acc.impressions + (r.impressions || 0),
          }),
          { clicks: 0, impressions: 0 }
        )
        // ctr/position must be recomputed from totals, not averaged from the
        // single aggregate row -- with no dimensions the API already returns
        // one row, but summing keeps this correct if that ever changes.
        const ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0
        const avgPosition = rows.length > 0 && rows[0].position != null ? rows[0].position : 0
        return NextResponse.json({
          clicks: totals.clicks,
          impressions: totals.impressions,
          ctr,
          avg_position: avgPosition,
        })
      }

      case 'timeseries': {
        const rows = await queryFn(client, siteUrl, {
          startDate: from,
          endDate: to,
          dimensions: ['date'],
          rowLimit: 1000,
        })
        const sorted = rows
          .map((r) => ({
            date: r.keys?.[0] || '',
            clicks: r.clicks || 0,
            impressions: r.impressions || 0,
            ctr: r.ctr || 0,
            position: r.position || 0,
          }))
          .sort((a, b) => a.date.localeCompare(b.date))
        return NextResponse.json(sorted)
      }

      case 'top_queries': {
        const rows = await queryFn(client, siteUrl, {
          startDate: from,
          endDate: to,
          dimensions: ['query'],
          rowLimit: 15,
        })
        const sorted = rows
          .map((r) => ({
            label: r.keys?.[0] || '(unknown)',
            clicks: r.clicks || 0,
            impressions: r.impressions || 0,
            ctr: r.ctr || 0,
            position: r.position || 0,
          }))
          .sort((a, b) => b.clicks - a.clicks)
        return NextResponse.json(sorted)
      }

      case 'top_pages': {
        const rows = await queryFn(client, siteUrl, {
          startDate: from,
          endDate: to,
          dimensions: ['page'],
          rowLimit: 15,
        })
        const sorted = rows
          .map((r) => ({
            label: r.keys?.[0] || '(unknown)',
            clicks: r.clicks || 0,
            impressions: r.impressions || 0,
            ctr: r.ctr || 0,
            position: r.position || 0,
          }))
          .sort((a, b) => b.clicks - a.clicks)
        return NextResponse.json(sorted)
      }
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Search Console request failed' }, { status: 502 })
  }
}

function defaultFrom(): string {
  const d = new Date()
  d.setDate(d.getDate() - 10)
  return d.toISOString().slice(0, 10)
}

function defaultTo(): string {
  const d = new Date()
  d.setDate(d.getDate() - 3)
  return d.toISOString().slice(0, 10)
}

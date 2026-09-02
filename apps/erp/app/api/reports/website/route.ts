// Website traffic/demographics reporting, sourced live from the GA4 Data API
// (Google Analytics property backing the digitalbluez.com storefront) -- this
// data does not live in Supabase at all, unlike every other /api/reports
// metric, so it gets its own route rather than being folded into the
// report_* RPC dispatcher.
import { NextRequest, NextResponse } from 'next/server'
import { BetaAnalyticsDataClient } from '@google-analytics/data'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'

const METRICS = ['summary', 'timeseries', 'top_pages', 'devices', 'demographics_age', 'demographics_gender', 'geo', 'traffic_source'] as const
type Metric = (typeof METRICS)[number]

function getClient() {
  const clientEmail = process.env.GA4_CLIENT_EMAIL
  const privateKey = process.env.GA4_PRIVATE_KEY
  if (!clientEmail || !privateKey) return null
  return new BetaAnalyticsDataClient({
    credentials: { client_email: clientEmail, private_key: privateKey.replace(/\\n/g, '\n') },
  })
}

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'reports')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const propertyId = process.env.GA4_PROPERTY_ID
  const client = getClient()
  if (!propertyId || !client) {
    return NextResponse.json({ error: 'Google Analytics is not configured on this server' }, { status: 501 })
  }

  const sp = req.nextUrl.searchParams
  const metric = sp.get('metric') as Metric | null
  if (!metric || !(METRICS as readonly string[]).includes(metric)) {
    return NextResponse.json({ error: `metric must be one of: ${METRICS.join(', ')}` }, { status: 400 })
  }
  const from = sp.get('from') || '7daysAgo'
  const to = sp.get('to') || 'today'
  const property = `properties/${propertyId}`

  try {
    switch (metric) {
      case 'summary': {
        const [resp] = await client.runReport({
          property,
          dateRanges: [{ startDate: from, endDate: to }],
          metrics: [
            { name: 'sessions' }, { name: 'activeUsers' }, { name: 'newUsers' },
            { name: 'screenPageViews' }, { name: 'engagementRate' }, { name: 'averageSessionDuration' },
          ],
        })
        const row = resp.rows?.[0]?.metricValues?.map((v) => Number(v.value)) || [0, 0, 0, 0, 0, 0]
        return NextResponse.json({
          sessions: row[0], active_users: row[1], new_users: row[2],
          page_views: row[3], engagement_rate: row[4], avg_session_duration_sec: row[5],
        })
      }

      case 'timeseries': {
        const [resp] = await client.runReport({
          property,
          dateRanges: [{ startDate: from, endDate: to }],
          dimensions: [{ name: 'date' }],
          metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'screenPageViews' }],
          orderBys: [{ dimension: { dimensionName: 'date' } }],
        })
        const rows = (resp.rows || []).map((r) => ({
          date: formatGaDate(r.dimensionValues?.[0]?.value || ''),
          sessions: Number(r.metricValues?.[0]?.value || 0),
          active_users: Number(r.metricValues?.[1]?.value || 0),
          page_views: Number(r.metricValues?.[2]?.value || 0),
        }))
        return NextResponse.json(rows)
      }

      case 'top_pages': {
        const [resp] = await client.runReport({
          property,
          dateRanges: [{ startDate: from, endDate: to }],
          dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
          metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
          orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
          limit: 15,
        })
        const rows = (resp.rows || []).map((r) => ({
          label: r.dimensionValues?.[1]?.value || r.dimensionValues?.[0]?.value || '(unknown)',
          path: r.dimensionValues?.[0]?.value || '',
          page_views: Number(r.metricValues?.[0]?.value || 0),
          active_users: Number(r.metricValues?.[1]?.value || 0),
        }))
        return NextResponse.json(rows)
      }

      case 'devices': {
        const [resp] = await client.runReport({
          property,
          dateRanges: [{ startDate: from, endDate: to }],
          dimensions: [{ name: 'deviceCategory' }],
          metrics: [{ name: 'sessions' }],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        })
        const rows = (resp.rows || []).map((r) => ({
          label: capitalize(r.dimensionValues?.[0]?.value || 'unknown'),
          sessions: Number(r.metricValues?.[0]?.value || 0),
        }))
        return NextResponse.json(rows)
      }

      case 'demographics_age': {
        const [resp] = await client.runReport({
          property,
          dateRanges: [{ startDate: from, endDate: to }],
          dimensions: [{ name: 'userAgeBracket' }],
          metrics: [{ name: 'activeUsers' }],
          orderBys: [{ dimension: { dimensionName: 'userAgeBracket' } }],
        })
        const rows = (resp.rows || [])
          .map((r) => ({ label: r.dimensionValues?.[0]?.value || 'unknown', active_users: Number(r.metricValues?.[0]?.value || 0) }))
          .filter((r) => r.label !== '(not set)' && r.label !== 'unknown')
        return NextResponse.json(rows)
      }

      case 'demographics_gender': {
        const [resp] = await client.runReport({
          property,
          dateRanges: [{ startDate: from, endDate: to }],
          dimensions: [{ name: 'userGender' }],
          metrics: [{ name: 'activeUsers' }],
        })
        const rows = (resp.rows || [])
          .map((r) => ({ label: capitalize(r.dimensionValues?.[0]?.value || 'unknown'), active_users: Number(r.metricValues?.[0]?.value || 0) }))
          .filter((r) => r.label !== '(not set)' && r.label !== 'Unknown')
        return NextResponse.json(rows)
      }

      case 'geo': {
        const [resp] = await client.runReport({
          property,
          dateRanges: [{ startDate: from, endDate: to }],
          dimensions: [{ name: 'city' }],
          metrics: [{ name: 'sessions' }],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: 10,
        })
        const rows = (resp.rows || []).map((r) => ({
          label: r.dimensionValues?.[0]?.value || '(unknown)',
          sessions: Number(r.metricValues?.[0]?.value || 0),
        }))
        return NextResponse.json(rows)
      }

      case 'traffic_source': {
        const [resp] = await client.runReport({
          property,
          dateRanges: [{ startDate: from, endDate: to }],
          dimensions: [{ name: 'sessionDefaultChannelGroup' }],
          metrics: [{ name: 'sessions' }],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        })
        const rows = (resp.rows || []).map((r) => ({
          label: r.dimensionValues?.[0]?.value || '(unknown)',
          sessions: Number(r.metricValues?.[0]?.value || 0),
        }))
        return NextResponse.json(rows)
      }
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Google Analytics request failed' }, { status: 502 })
  }
}

function formatGaDate(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

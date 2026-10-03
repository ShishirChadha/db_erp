// Website traffic/demographics reporting, sourced live from the GA4 Data API
// (Google Analytics property backing the digitalbluez.com storefront) -- this
// data does not live in Supabase at all, unlike every other /api/reports
// metric, so it gets its own route rather than being folded into the
// report_* RPC dispatcher.
import { NextRequest, NextResponse } from 'next/server'
import { BetaAnalyticsDataClient } from '@google-analytics/data'
import { AnalyticsAdminServiceClient } from '@google-analytics/admin'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'

const METRICS = ['config', 'ecommerce_funnel', 'search_terms', 'summary', 'timeseries', 'top_pages', 'devices', 'demographics_age', 'demographics_gender', 'geo', 'traffic_source'] as const
type Metric = (typeof METRICS)[number]

function getClient() {
  const clientEmail = process.env.GA4_CLIENT_EMAIL
  const privateKey = process.env.GA4_PRIVATE_KEY
  if (!clientEmail || !privateKey) return null
  return new BetaAnalyticsDataClient({
    credentials: { client_email: clientEmail, private_key: privateKey.replace(/\\n/g, '\n') },
  })
}

// Separate client, only used by the `config` metric. The Data API cannot
// enumerate a property's data streams, and the stream's measurement ID is the
// one fact needed to prove "the site is firing at the property we are reading".
// Optional on purpose: if the service account lacks Admin API access the card
// still works on Data-API-only signals (see the `config` case), because the
// all-time event count alone already diagnoses an empty property.
function getAdminClient() {
  const clientEmail = process.env.GA4_CLIENT_EMAIL
  const privateKey = process.env.GA4_PRIVATE_KEY
  if (!clientEmail || !privateKey) return null
  return new AnalyticsAdminServiceClient({
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
      // Health of the analytics pipe itself, deliberately NOT date-ranged.
      //
      // This exists because of a real failure: the storefront was firing at a
      // measurement ID that did not belong to this property, so the property
      // had never received a single event -- and every tile correctly rendered
      // zero, which is indistinguishable from "a quiet week" until you go
      // looking. Date-ranged metrics can never tell you that. An all-time
      // event count of zero can, and so can a last-event date that has gone
      // stale, which is what catches the same mistake if it recurs.
      case 'config': {
        const [allTime] = await client.runReport({
          property,
          dateRanges: [{ startDate: '2020-01-01', endDate: 'today' }],
          metrics: [{ name: 'eventCount' }, { name: 'sessions' }],
        })
        const allTimeEvents = Number(allTime.rows?.[0]?.metricValues?.[0]?.value || 0)
        const allTimeSessions = Number(allTime.rows?.[0]?.metricValues?.[1]?.value || 0)

        // First/last day that actually carried an event. Cheap (one row each)
        // and it is what turns "empty" into "empty since Tuesday".
        let firstEventDate: string | null = null
        let lastEventDate: string | null = null
        if (allTimeEvents > 0) {
          const [days] = await client.runReport({
            property,
            dateRanges: [{ startDate: '2020-01-01', endDate: 'today' }],
            dimensions: [{ name: 'date' }],
            metrics: [{ name: 'eventCount' }],
            orderBys: [{ dimension: { dimensionName: 'date' } }],
          })
          const dated = (days.rows || []).filter((r) => Number(r.metricValues?.[0]?.value || 0) > 0)
          firstEventDate = dated.length ? formatGaDate(dated[0].dimensionValues?.[0]?.value || '') : null
          lastEventDate = dated.length ? formatGaDate(dated[dated.length - 1].dimensionValues?.[0]?.value || '') : null
        }

        // Realtime is the one signal with no processing delay, so it is how you
        // confirm a fix in 30 seconds instead of waiting out GA4's 24-48h lag.
        let realtimeActiveUsers: number | null = null
        try {
          const [rt] = await client.runRealtimeReport({ property, metrics: [{ name: 'activeUsers' }] })
          realtimeActiveUsers = Number(rt.rows?.[0]?.metricValues?.[0]?.value || 0)
        } catch {
          realtimeActiveUsers = null
        }

        // Admin API: property display name + the measurement IDs of its web
        // streams. Best-effort -- a 403 here must not break the card.
        let propertyDisplayName: string | null = null
        let measurementIds: string[] = []
        let adminError: string | null = null
        try {
          const admin = getAdminClient()
          if (admin) {
            const [prop] = await admin.getProperty({ name: property })
            propertyDisplayName = prop.displayName ?? null
            const [streams] = await admin.listDataStreams({ parent: property })
            measurementIds = (streams || [])
              .map((st) => st.webStreamData?.measurementId)
              .filter((id): id is string => !!id)
          }
        } catch (err: any) {
          adminError = err?.message || 'Admin API request failed'
        }

        return NextResponse.json({
          property_id: propertyId,
          property_display_name: propertyDisplayName,
          measurement_ids: measurementIds,
          // What the storefront is configured to fire at, if it was shared with
          // the ERP. Optional, and only ever used for comparison/display.
          expected_measurement_id: process.env.WEB_GA_MEASUREMENT_ID || null,
          all_time_event_count: allTimeEvents,
          all_time_sessions: allTimeSessions,
          first_event_date: firstEventDate,
          last_event_date: lastEventDate,
          realtime_active_users: realtimeActiveUsers,
          service_account_email: process.env.GA4_CLIENT_EMAIL || null,
          admin_error: adminError,
          search_console_configured: !!process.env.GSC_SITE_URL,
        })
      }

      // The visitor-level funnel, from the GA4 e-commerce events the storefront
      // sends (apps/web/lib/analytics.ts). This is intentionally a DIFFERENT
      // measurement from report_web_funnel: this one counts every visitor
      // including anonymous ones, while the SQL funnel counts rows that reached
      // the database. They will never agree, and the gap between them is the
      // interesting part -- people who browsed and added to a cart but never
      // created an order row.
      case 'ecommerce_funnel': {
        const STEPS = ['view_item', 'add_to_cart', 'view_cart', 'begin_checkout', 'purchase'] as const
        const [resp] = await client.runReport({
          property,
          dateRanges: [{ startDate: from, endDate: to }],
          dimensions: [{ name: 'eventName' }],
          metrics: [{ name: 'eventCount' }],
          dimensionFilter: {
            filter: { fieldName: 'eventName', inListFilter: { values: [...STEPS] } },
          },
        })
        const counts: Record<string, number> = {}
        for (const r of resp.rows || []) {
          counts[r.dimensionValues?.[0]?.value || ''] = Number(r.metricValues?.[0]?.value || 0)
        }

        // Rates are computed here rather than in the browser, consistent with
        // every other metric on this page -- but note the authority is GA4's
        // own numbers, not SQL.
        const rate = (num: number, den: number) => (den > 0 ? Math.round((1000 * num) / den) / 10 : null)
        const steps = STEPS.map((name) => ({ name, count: counts[name] ?? 0 }))

        return NextResponse.json({
          steps,
          view_item: counts.view_item ?? 0,
          add_to_cart: counts.add_to_cart ?? 0,
          view_cart: counts.view_cart ?? 0,
          begin_checkout: counts.begin_checkout ?? 0,
          purchase: counts.purchase ?? 0,
          view_to_cart_rate: rate(counts.add_to_cart ?? 0, counts.view_item ?? 0),
          cart_to_checkout_rate: rate(counts.begin_checkout ?? 0, counts.add_to_cart ?? 0),
          checkout_to_purchase_rate: rate(counts.purchase ?? 0, counts.begin_checkout ?? 0),
          // True when the storefront has not reported a single e-commerce event
          // in the window, which is what "the events were only just added" or
          // "tracking is broken" looks like -- distinct from a real zero.
          no_events: steps.every((st) => st.count === 0),
        })
      }

      // On-site search terms. `search_term` is a custom event parameter, so it
      // is only reportable once it has been registered as an event-scoped
      // custom dimension in GA4 Admin > Custom definitions. Until then the API
      // rejects the dimension outright, so that case is caught and reported as
      // a setup step rather than surfacing as a broken panel.
      case 'search_terms': {
        try {
          const [resp] = await client.runReport({
            property,
            dateRanges: [{ startDate: from, endDate: to }],
            dimensions: [{ name: 'customEvent:search_term' }],
            metrics: [{ name: 'eventCount' }],
            orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
            limit: 20,
          })
          const rows = (resp.rows || [])
            .map((r) => ({
              term: r.dimensionValues?.[0]?.value || '(not set)',
              count: Number(r.metricValues?.[0]?.value || 0),
            }))
            .filter((r) => r.term !== '(not set)')
          return NextResponse.json({ rows, dimension_missing: false })
        } catch (err: any) {
          const msg: string = err?.message || ''
          // GA4 returns 400 INVALID_ARGUMENT for an unregistered custom dimension.
          if (/did not match|INVALID_ARGUMENT|not valid|customEvent/i.test(msg)) {
            return NextResponse.json({ rows: [], dimension_missing: true, detail: msg })
          }
          throw err
        }
      }

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

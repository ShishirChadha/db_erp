import { NextResponse } from 'next/server'

// Public, unauthenticated, dependency-free -- pinged every 5 minutes by the
// ERP's website-health-ping cron job (run_website_health_check() ->
// report_website_health() RPC). Deliberately doesn't touch Supabase, so it
// measures this app's own responsiveness rather than conflating it with DB
// health, which every other feature already implicitly monitors.
export async function GET() {
  return NextResponse.json({ status: 'ok', ts: new Date().toISOString() })
}

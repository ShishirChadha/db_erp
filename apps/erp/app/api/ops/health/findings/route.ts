import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// Owner's view of the daily health reports (System Health -> Daily reports).
//   GET                -> report list, newest first
//   GET ?report=<id>   -> one report + the findings that were live that day
// Owner-only, like the rest of System Health.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const reportId = new URL(req.url).searchParams.get('report')

  if (reportId) {
    const { data: report, error } = await supabaseAdmin
      .from('ops_health_reports')
      .select('id, report_date, overall, summary, created_at, updated_at')
      .eq('id', reportId)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

    // A recurring finding keeps ONE row whose report_id moves forward to the
    // latest report, so "which findings belong to this day" is the ones whose
    // seen-range covers it -- not report_id equality, which would empty out
    // every older report as soon as an issue recurred.
    const { data: findings } = await supabaseAdmin
      .from('ops_health_findings')
      .select('id, ref, severity, area, title, evidence, suggestion, fix_kind, status, first_seen_on, last_seen_on, decided_at, pr_url, agent_note')
      .lte('first_seen_on', report.report_date)
      .gte('last_seen_on', report.report_date)
    const order = { act: 0, watch: 1, info: 2 } as Record<string, number>
    const sorted = (findings ?? []).sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))
    return NextResponse.json({ report, findings: sorted })
  }

  const { data: reports, error } = await supabaseAdmin
    .from('ops_health_reports')
    .select('id, report_date, overall, summary, created_at')
    .order('report_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(90)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Count of findings still waiting on the owner, for the section header.
  const { count: awaiting } = await supabaseAdmin
    .from('ops_health_findings')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'proposed')

  return NextResponse.json({ reports: reports ?? [], awaitingDecision: awaiting ?? 0 })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, isManagerOrAbove } from '@/lib/auth/session'
import { agentCommand, isExpired, SESSION_COLUMNS, AUTO_CHECK_PAGES } from '@/lib/qc-agent/session'
import { evaluateSession, type SessionRow } from '@/lib/qc-agent/evaluate'

// ---------- GET: progress + everything the review screen needs ----------
// Polled every few seconds by /dashboard/entry/auto-check while a run is open.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(user, AUTO_CHECK_PAGES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await supabaseAdmin.from('qc_agent_sessions').select(SESSION_COLUMNS).eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const row = data as SessionRow
  if (row.created_by !== user.id && !isManagerOrAbove(user)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const evaluation = await evaluateSession(row)
  const liveAgeMs = row.live_at ? Date.now() - new Date(row.live_at).getTime() : null

  return NextResponse.json({
    id: row.id,
    code: row.code,
    command: agentCommand(req.nextUrl.origin, row.code),
    status: row.status,
    expired: isExpired(row),
    expires_at: row.expires_at,
    options: row.options || {},
    reported_at: row.reported_at,
    script_connected: liveAgeMs != null && liveAgeMs < 20_000,
    background: {
      stage: row.background_results?.stage ?? null,
      stage_progress: row.background_results?.stage_progress ?? null,
    },
    page_finished: !!row.interactive_results?.finished,
    asset_id: row.asset_id,
    evaluation,
    ...(req.nextUrl.searchParams.get('raw') === '1'
      ? { raw: { hardware_report: row.hardware_report, background_results: row.background_results, live: row.live, interactive_results: row.interactive_results } }
      : {}),
  })
}

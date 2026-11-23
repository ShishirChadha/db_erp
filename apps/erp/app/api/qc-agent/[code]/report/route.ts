import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { liveSessionByCode, readJsonLimited } from '@/lib/qc-agent/session'

// POST -- the script's hardware facts (phase 1). Code-authenticated, no login:
// it can only write into its own session row. Re-running the script on the
// same code replaces the facts and restarts the background tests' results.
export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const found = await liveSessionByCode(code)
  if ('error' in found) return found.error
  const parsed = await readJsonLimited(req)
  if ('error' in parsed) return parsed.error

  const { error } = await supabaseAdmin
    .from('qc_agent_sessions')
    .update({
      hardware_report: parsed.body,
      reported_at: new Date().toISOString(),
      status: 'running',
      background_results: null,
      live: null,
      live_at: null,
    })
    .eq('id', found.row.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, isManagerOrAbove } from '@/lib/auth/session'
import { agentCommand, CODE_TTL_MS, newCode } from '@/lib/qc-agent/session'

// Auto Check runs, started from the engineer's own ERP screen.
// Gated like Stock Intake (new_entry): the save at the end goes through
// /api/stock-intake, which needs the same grant.

// ---------- POST: start a run, get a code ----------
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(user, 'new_entry')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const options = { heat_test: body?.heat_test !== false }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode()
    const { data, error } = await supabaseAdmin
      .from('qc_agent_sessions')
      .insert({ code, created_by: user.id, expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(), options })
      .select('id, code, expires_at, options')
      .single()
    if (!error) {
      return NextResponse.json({ ...data, command: agentCommand(req.nextUrl.origin, data.code) }, { status: 201 })
    }
    if (error.code !== '23505') return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ error: 'Could not allocate a code, try again.' }, { status: 500 })
}

// ---------- GET: my recent unfinished runs (to resume after a reload) ----------
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(user, 'new_entry')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let query = supabaseAdmin
    .from('qc_agent_sessions')
    .select('id, code, created_at, expires_at, status, reported_at, hardware_report->system->>manufacturer, hardware_report->system->>model, hardware_report->bios->>serial')
    .neq('status', 'completed')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(10)
  if (!isManagerOrAbove(user)) query = query.eq('created_by', user.id)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json((data || []).map((s: any) => ({ ...s, command: agentCommand(req.nextUrl.origin, s.code) })))
}

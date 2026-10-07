import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { withRetry } from '@/lib/db-retry'

// Owner-initiated restart/shutdown of the self-hosted ProDesk. The box only
// ever pushes data out (server_metrics, server_boot_events) -- this is the one
// inbound exception, and it stays a poll rather than a listener:
// erp-command-poller.timer on the box checks public.server_commands every
// ~10s and acts on a pending row, so nothing new listens on the machine. See
// docs/bible/modules/system-health.md.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  // Only what the page needs to show "a restart was requested, waiting for
  // the box to pick it up" -- a handful of rows a year, so no pagination.
  const { data, error } = await withRetry(() =>
    supabaseAdmin
      .from('server_commands')
      .select('id, command, status, requested_by, requested_at, acknowledged_at, error')
      .order('requested_at', { ascending: false })
      .limit(10)
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ commands: data ?? [] })
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const command = body?.command

  if (command !== 'restart' && command !== 'shutdown') {
    return NextResponse.json({ error: 'command must be "restart" or "shutdown"' }, { status: 400 })
  }

  // Shutdown is deliberately harder to request than restart: this machine has
  // no remote power-on (no Wake-on-LAN, no smart plug), so a shutdown that
  // doesn't come back by itself stays down until someone reaches the office.
  // The confirmation phrase is enforced server-side, not just hidden behind a
  // client-side dialog, since this is the one action on this page that is
  // genuinely hard to undo.
  if (command === 'shutdown' && body?.confirm !== 'SHUTDOWN') {
    return NextResponse.json({ error: 'Type SHUTDOWN to confirm.' }, { status: 400 })
  }

  // Refuse a second request while one is still pending/acknowledged, rather
  // than queuing a restart behind a shutdown (or vice versa) that the box may
  // never get to run.
  const { data: inFlight } = await withRetry(() =>
    supabaseAdmin
      .from('server_commands')
      .select('id, command, status')
      .in('status', ['pending', 'acknowledged'])
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  )
  if (inFlight) {
    return NextResponse.json(
      { error: `A ${inFlight.command} is already ${inFlight.status === 'pending' ? 'waiting to run' : 'in progress'}.` },
      { status: 409 }
    )
  }

  const requestedBy = sessionUser.email || sessionUser.id

  const { data, error } = await withRetry(() =>
    supabaseAdmin
      .from('server_commands')
      .insert({ command, requested_by: requestedBy })
      .select('id, command, status, requested_at')
      .single()
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ command: data })
}

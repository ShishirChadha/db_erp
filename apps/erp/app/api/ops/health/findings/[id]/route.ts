import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { hasOpsToken } from '@/lib/ops-auth'

// Status changes on one health finding. Two callers, two disjoint sets of moves:
//   owner (session)      proposed/rejected/failed/needs_manual -> approved, proposed/approved -> rejected
//   fix routine (token)  approved -> in_progress -> pr_open | failed | needs_manual
// The routine can never approve anything, and the owner's approval is the only
// thing that lets the routine start work on a finding.
export const dynamic = 'force-dynamic'

const OWNER_MOVES: Record<string, string[]> = {
  approved: ['proposed', 'rejected', 'failed', 'needs_manual'],
  rejected: ['proposed', 'approved'],
}

const ROUTINE_MOVES: Record<string, string[]> = {
  in_progress: ['approved'],
  pr_open: ['approved', 'in_progress'],
  failed: ['approved', 'in_progress'],
  needs_manual: ['approved', 'in_progress'],
  // When a later run sees the PR merged and the issue gone.
  done: ['pr_open'],
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const next = typeof body?.status === 'string' ? body.status : ''

  const viaToken = hasOpsToken(req)
  const sessionUser = viaToken ? null : await getSessionUser(req)
  if (!viaToken && !isOwner(sessionUser)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const moves = viaToken ? ROUTINE_MOVES : OWNER_MOVES
  if (!moves[next]) {
    return NextResponse.json({ error: `status must be one of ${Object.keys(moves).join(', ')}` }, { status: 400 })
  }

  const { data: finding, error } = await supabaseAdmin
    .from('ops_health_findings')
    .select('id, status')
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!finding) return NextResponse.json({ error: 'Finding not found' }, { status: 404 })
  if (!moves[next].includes(finding.status)) {
    return NextResponse.json({ error: `Cannot move a ${finding.status} finding to ${next}` }, { status: 409 })
  }

  const update: Record<string, unknown> = { status: next, updated_at: new Date().toISOString() }
  if (viaToken) {
    if (next === 'pr_open') {
      const prUrl = typeof body?.pr_url === 'string' ? body.pr_url.trim() : ''
      if (!/^https:\/\/github\.com\//.test(prUrl)) {
        return NextResponse.json({ error: 'pr_url must be a https://github.com/ link' }, { status: 400 })
      }
      update.pr_url = prUrl
    }
    if (typeof body?.agent_note === 'string') update.agent_note = body.agent_note.trim().slice(0, 4000) || null
  } else {
    update.decided_by = sessionUser!.id
    update.decided_at = new Date().toISOString()
  }

  // Re-check the status in the WHERE so two writers racing (owner clicking while
  // the routine picks it up) cannot both win.
  const { data: updated, error: upErr } = await supabaseAdmin
    .from('ops_health_findings')
    .update(update)
    .eq('id', id)
    .eq('status', finding.status)
    .select('id, status, pr_url, agent_note, decided_at')
    .maybeSingle()
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
  if (!updated) return NextResponse.json({ error: 'The finding changed while you were updating it — refresh and try again.' }, { status: 409 })
  return NextResponse.json({ finding: updated })
}

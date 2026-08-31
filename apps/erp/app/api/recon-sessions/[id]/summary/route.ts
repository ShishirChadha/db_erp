import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { computeSessionSummary } from '@/lib/recon/session-summary'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const { data: session } = await supabaseAdmin.from('recon_sessions').select('*').eq('id', id).single()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const summary = await computeSessionSummary(session.bank_account_id, session.period_start, session.period_end)
  return NextResponse.json({ session, ...summary })
}

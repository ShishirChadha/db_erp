import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { computeSessionSummary } from '@/lib/recon/session-summary'

// ---------- GET: list sessions, optionally scoped to one account ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const bankAccountId = searchParams.get('bank_account_id')

  let query = supabaseAdmin.from('recon_sessions').select('*, bank_accounts(label)').order('period_start', { ascending: false })
  if (bankAccountId) query = query.eq('bank_account_id', bankAccountId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// ---------- POST: open a session for an account+period (reuses an existing open one) ----------
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { bank_account_id, period_start, period_end } = await req.json()
  if (!bank_account_id || !period_start || !period_end) {
    return NextResponse.json({ error: 'bank_account_id, period_start and period_end are required.' }, { status: 400 })
  }

  const { data: existing } = await supabaseAdmin
    .from('recon_sessions')
    .select('*')
    .eq('bank_account_id', bank_account_id)
    .eq('period_start', period_start)
    .eq('period_end', period_end)
    .neq('status', 'closed')
    .maybeSingle()

  const summary = await computeSessionSummary(bank_account_id, period_start, period_end)

  if (existing) {
    const { data: updated, error } = await supabaseAdmin
      .from('recon_sessions')
      .update({ status: 'in_progress', open_count: summary.open_count, matched_count: summary.matched_count, total_count: summary.total_count, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(updated)
  }

  const { data: session, error } = await supabaseAdmin
    .from('recon_sessions')
    .insert({
      bank_account_id, period_start, period_end, status: 'in_progress',
      open_count: summary.open_count, matched_count: summary.matched_count, total_count: summary.total_count,
      created_by: sessionUser.id,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(session, { status: 201 })
}

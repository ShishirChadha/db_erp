import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, isManagerOrAbove } from '@/lib/auth/session'
import { AUTO_CHECK_PAGES } from '@/lib/qc-agent/session'

// ---------- POST: link the saved unit and close the run ----------
// Called by the review screen AFTER it has stocked the unit in and saved its QC
// through the normal routes. Closing the run kills the code: the laptop's
// script and test page get 410 from then on and stop.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(user, AUTO_CHECK_PAGES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const assetId = typeof body?.asset_id === 'string' ? body.asset_id : null
  if (!assetId) return NextResponse.json({ error: 'asset_id is required' }, { status: 400 })

  const { data: row } = await supabaseAdmin.from('qc_agent_sessions').select('id, created_by, status, options').eq('id', id).maybeSingle()
  if (!row || (row.created_by !== user.id && !isManagerOrAbove(user))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const targetId = (row.options as any)?.asset_id
  if (targetId && targetId !== assetId) return NextResponse.json({ error: 'This run belongs to a different unit' }, { status: 400 })

  const { data: asset } = await supabaseAdmin.from('asset_ledger').select('id').eq('id', assetId).maybeSingle()
  if (!asset) return NextResponse.json({ error: 'Unit not found' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('qc_agent_sessions')
    .update({ status: 'completed', asset_id: assetId, completed_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

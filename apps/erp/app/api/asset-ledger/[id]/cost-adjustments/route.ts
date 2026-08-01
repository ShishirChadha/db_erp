import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

// Cost data is owner-only everywhere in this app -- this route only ever serves
// owners, so (per project convention) it's written to never select/return
// anything for other roles rather than fetch-then-redact.

// ---------- GET: original cost, adjustment history, and running total ----------
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params

  const { data: asset } = await supabaseAdmin
    .from('asset_ledger')
    .select('cost_price')
    .eq('id', id)
    .single()
  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 })

  const { data: adjustments, error } = await supabaseAdmin
    .from('asset_cost_adjustments')
    .select('id, amount, reason, created_at, added_by')
    .eq('asset_id', id)
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const adjustmentsTotal = (adjustments ?? []).reduce((sum, a) => sum + Number(a.amount), 0)
  const costPrice = asset.cost_price ?? 0

  return NextResponse.json({
    cost_price: costPrice,
    adjustments: adjustments ?? [],
    total_cost: costPrice + adjustmentsTotal,
  })
}

// ---------- POST: add a cost adjustment ----------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const { amount, reason } = body as { amount?: number; reason?: string }

  if (amount === undefined || amount === null || isNaN(Number(amount))) {
    return NextResponse.json({ error: 'amount is required' }, { status: 400 })
  }

  const { data: asset } = await supabaseAdmin.from('asset_ledger').select('id').eq('id', id).single()
  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 })

  const { data: inserted, error } = await supabaseAdmin.from('asset_cost_adjustments').insert({
    asset_id: id,
    amount: Number(amount),
    reason: reason || null,
    added_by: sessionUser.id,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'stock',
    tableName: 'asset_cost_adjustments',
    recordId: inserted?.id ?? null,
    recordLabel: id,
    reason: reason || null,
    metadata: { asset_id: id, amount: Number(amount) },
  })

  return NextResponse.json({ success: true })
}

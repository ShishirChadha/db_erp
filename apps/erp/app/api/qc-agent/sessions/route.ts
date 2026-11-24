import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, isManagerOrAbove } from '@/lib/auth/session'
import { agentCommand, CODE_TTL_MS, newCode, AUTO_CHECK_PAGES } from '@/lib/qc-agent/session'
import { RE_QC_STATUSES } from '@/lib/qc-agent/checklist'
import { resolveEffectiveSkuId } from '@/lib/effective-sku'

// Auto Check runs, started from the engineer's own ERP screen.
// A new unit (stock in + QC) needs new_entry, the grant /api/stock-intake checks.
// "Auto Test" of a unit already in stock (asset_id given, QC only) needs
// Live Stock or Stock, the grant /api/asset-ledger/[id]/qc checks.

// ---------- POST: start a run, get a code ----------
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const assetId = typeof body?.asset_id === 'string' && body.asset_id ? body.asset_id : null
  if (!hasPageAccess(user, assetId ? ['live_stock', 'stock'] : 'new_entry')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const options: { heat_test: boolean; asset_id?: string } = { heat_test: body?.heat_test !== false }
  if (assetId) {
    const { data: unit } = await supabaseAdmin
      .from('asset_ledger').select('id, status, sku_id, current_sku_id').eq('id', assetId).maybeSingle()
    if (!unit) return NextResponse.json({ error: 'Unit not found' }, { status: 404 })
    if (!RE_QC_STATUSES.includes(unit.status)) {
      return NextResponse.json({ error: `A unit that is "${unit.status.replace(/_/g, ' ')}" can't be QC'd — it isn't with us.` }, { status: 400 })
    }
    const skuId = resolveEffectiveSkuId(unit)
    const { data: sku } = skuId ? await supabaseAdmin.from('sku_master').select('category').eq('id', skuId).maybeSingle() : { data: null }
    if (sku && !['LAP', 'DES'].includes(sku.category)) {
      return NextResponse.json({ error: 'Auto Test works on laptops and desktops only.' }, { status: 400 })
    }
    options.asset_id = assetId
  }

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
  if (!hasPageAccess(user, AUTO_CHECK_PAGES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let query = supabaseAdmin
    .from('qc_agent_sessions')
    .select('id, code, created_at, expires_at, status, reported_at, hardware_report->system->>manufacturer, hardware_report->system->>model, hardware_report->bios->>serial, asset_id:options->>asset_id')
    .neq('status', 'completed')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(10)
  if (!isManagerOrAbove(user)) query = query.eq('created_by', user.id)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json((data || []).map((s: any) => ({ ...s, command: agentCommand(req.nextUrl.origin, s.code) })))
}

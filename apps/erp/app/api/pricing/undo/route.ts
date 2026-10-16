import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { logFieldCorrections } from '@/lib/field-corrections'

// Restores the prices from one publish batch (the latest undoable one when no batch_id is
// sent). A SKU whose price has been changed again since is skipped, never overwritten.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const body = await req.json().catch(() => ({}))

  let batchId: string | null = typeof body.batch_id === 'string' ? body.batch_id : null
  if (!batchId) {
    const { data } = await supabaseAdmin.from('sku_price_changes').select('batch_id').neq('reason', 'undo').is('undone_at', null).order('changed_at', { ascending: false }).limit(1)
    batchId = data?.[0]?.batch_id ?? null
  }
  if (!batchId) return NextResponse.json({ error: 'There is no price change to undo.' }, { status: 404 })

  const { data: rows } = await supabaseAdmin.from('sku_price_changes').select('*').eq('batch_id', batchId).is('undone_at', null).neq('reason', 'undo')
  if (!rows || rows.length === 0) return NextResponse.json({ error: 'That batch was already undone.' }, { status: 404 })

  const { data: skus } = await supabaseAdmin.from('sku_master').select('id, full_sku_code, web_price, selling_price_default').in('id', rows.map((r: any) => r.sku_id))
  const bySku = new Map((skus || []).map((s: any) => [s.id, s]))

  const undoBatch = randomUUID()
  const restored: string[] = []
  const skipped: { code: string; why: string }[] = []
  const now = new Date().toISOString()

  for (const r of rows as any[]) {
    const s: any = bySku.get(r.sku_id)
    if (!s) { skipped.push({ code: r.sku_id, why: 'SKU no longer exists' }); continue }
    const current = s.web_price != null ? Number(s.web_price) : null
    if (current !== Number(r.new_price)) { skipped.push({ code: s.full_sku_code, why: 'price changed again since' }); continue }
    const back = r.old_price != null ? Number(r.old_price) : null
    const { error } = await supabaseAdmin.from('sku_master').update({ web_price: back, selling_price_default: back, updated_by: sessionUser.id, updated_at: now }).eq('id', r.sku_id)
    if (error) { skipped.push({ code: s.full_sku_code, why: error.message }); continue }
    restored.push(r.id)
    await supabaseAdmin.from('sku_price_changes').insert({ batch_id: undoBatch, sku_id: r.sku_id, old_price: r.new_price, new_price: back ?? r.new_price, reason: 'undo', note: `Undo of batch ${batchId}`, changed_by: sessionUser.id })
    const fc = await logFieldCorrections('sku_master', r.sku_id, [
      { field: 'web_price', oldValue: s.web_price, newValue: back },
      { field: 'selling_price_default', oldValue: s.selling_price_default, newValue: back },
    ], sessionUser.id, 'Price Board (undo)')
    await logAuditEvent({
      actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
      actionType: 'update', module: 'sku_master', tableName: 'sku_master', recordId: r.sku_id, recordLabel: s.full_sku_code,
      fieldCorrectionIds: fc, metadata: { source: 'price_board', undo_of: batchId },
    })
  }
  if (restored.length) await supabaseAdmin.from('sku_price_changes').update({ undone_at: now }).in('id', restored)
  return NextResponse.json({ restored: restored.length, skipped })
}

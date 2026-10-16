import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { logFieldCorrections } from '@/lib/field-corrections'
import { priceWarnings, validatePrice, type PriceWarning } from '@/lib/pricing'
import { loadCostMap, loadRules } from '@/lib/pricing-board'

const MAX_CHANGES = 200
const REASONS = ['manual', 'bulk', 'suggestion']

// Applies a batch of price changes. Website price and default selling price are always
// written together as one number. A price under cost + minimum margin (or below cost)
// is refused unless the caller sends confirm_warnings after the owner has seen it.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const changes = Array.isArray(body.changes) ? (body.changes as { sku_id?: string; price?: unknown }[]) : []
  const reason = REASONS.includes(body.reason) ? (body.reason as string) : 'manual'
  const note = typeof body.note === 'string' ? body.note.slice(0, 200) : null
  if (changes.length === 0) return NextResponse.json({ error: 'No price changes to publish.' }, { status: 400 })
  if (changes.length > MAX_CHANGES) return NextResponse.json({ error: `Publish at most ${MAX_CHANGES} prices at a time.` }, { status: 400 })

  const wanted = new Map<string, number>()
  for (const c of changes) {
    if (!c.sku_id) return NextResponse.json({ error: 'Every change needs a sku_id.' }, { status: 400 })
    if (wanted.has(c.sku_id)) return NextResponse.json({ error: 'The same SKU appears twice in this batch.' }, { status: 400 })
    const v = validatePrice(c.price)
    if (!v.ok) return NextResponse.json({ error: `${c.sku_id}: ${v.error}` }, { status: 400 })
    wanted.set(c.sku_id, v.price)
  }

  const ids = [...wanted.keys()]
  const { data: skus, error: skuErr } = await supabaseAdmin
    .from('sku_master').select('id, full_sku_code, category, web_price, selling_price_default').in('id', ids)
  if (skuErr) return NextResponse.json({ error: skuErr.message }, { status: 500 })
  if ((skus || []).length !== ids.length) return NextResponse.json({ error: 'One or more SKUs no longer exist. Reload the board.' }, { status: 404 })

  const rules = await loadRules()
  const costs = await loadCostMap(ids)

  const plan = (skus || []).map((s: any) => {
    const old = s.web_price != null ? Number(s.web_price) : s.selling_price_default != null ? Number(s.selling_price_default) : null
    const next = wanted.get(s.id)!
    const unified = s.web_price != null && s.selling_price_default != null && Number(s.web_price) === Number(s.selling_price_default)
    return { sku: s, old, next, noop: old === next && unified, warnings: priceWarnings(old, next, costs.get(s.id) ?? null, rules.min_margin_pct) }
  })

  const blocking = plan.filter((p) => !p.noop && p.warnings.some((w: PriceWarning) => w === 'below_cost' || w === 'below_margin'))
  if (blocking.length && body.confirm_warnings !== true) {
    return NextResponse.json({
      error: 'Some prices are below your minimum margin. Confirm to publish them anyway.',
      needs_confirmation: true,
      warnings: blocking.map((p) => ({ sku_id: p.sku.id, code: p.sku.full_sku_code, price: p.next, cost: costs.get(p.sku.id) ?? null, warnings: p.warnings })),
    }, { status: 409 })
  }

  const batchId = randomUUID()
  const applied: { sku_id: string; code: string; old: number | null; price: number }[] = []
  const failed: { sku_id: string; code: string; error: string }[] = []
  const now = new Date().toISOString()

  for (const p of plan) {
    if (p.noop) continue
    const { error } = await supabaseAdmin.from('sku_master')
      .update({ web_price: p.next, selling_price_default: p.next, updated_by: sessionUser.id, updated_at: now })
      .eq('id', p.sku.id)
    if (error) { failed.push({ sku_id: p.sku.id, code: p.sku.full_sku_code, error: error.message }); continue }
    applied.push({ sku_id: p.sku.id, code: p.sku.full_sku_code, old: p.old, price: p.next })
  }

  if (applied.length) {
    await supabaseAdmin.from('sku_price_changes').insert(
      applied.map((a) => ({ batch_id: batchId, sku_id: a.sku_id, old_price: a.old, new_price: a.price, reason, note, changed_by: sessionUser.id })),
    )
    for (let i = 0; i < applied.length; i += 10) {
      await Promise.all(applied.slice(i, i + 10).map(async (a) => {
        const row = plan.find((p) => p.sku.id === a.sku_id)!.sku
        const ids = await logFieldCorrections('sku_master', a.sku_id, [
          { field: 'web_price', oldValue: row.web_price, newValue: a.price },
          { field: 'selling_price_default', oldValue: row.selling_price_default, newValue: a.price },
        ], sessionUser.id, `Price Board (${reason})`)
        await logAuditEvent({
          actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
          actionType: 'update', module: 'sku_master', tableName: 'sku_master', recordId: a.sku_id, recordLabel: a.code,
          fieldCorrectionIds: ids, metadata: { batch_id: batchId, source: 'price_board', reason },
        })
      }))
    }
  }

  const skipped = plan.filter((p) => p.noop).length
  return NextResponse.json({ batch_id: applied.length ? batchId : null, applied: applied.length, unchanged: skipped, failed })
}

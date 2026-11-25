import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess, isManagerOrAbove } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { resolveOrCreateSku } from '@/lib/sku-resolver'
import { getCustomOptionsCategory } from '@/lib/sku-field-options'
import { normalizeForComparison } from '@/lib/text-normalize'
import { SESSION_COLUMNS } from '@/lib/qc-agent/session'
import { canUpgradeSku, evaluateSession, type SessionRow } from '@/lib/qc-agent/evaluate'

// POST -- "Upgrade to Auto Check naming" on the review screen, before stock-in.
//
// The evaluation found an existing SKU for this machine whose name only
// resembles Auto Check's, or that records less detail. By owner decision
// (2026-11-25) whoever runs Auto Check may then:
//   - naming differs: create the Auto Check-named SKU (resolveOrCreateSku) and
//     merge the old one into it with merge_sku_master -- units, stock, photos,
//     website listing + URL, price, history all move; the old SKU is archived
//     and its now-unused model name is switched off in the dropdown list.
//   - naming is the same: fill the spec fields the SKU is missing (never
//     overwriting a value it already has).
// This is the ONLY non-owner path to a SKU merge, and it is narrow on purpose:
// the SKU merged is the one the server's own evaluation matched for this run
// (the client can't name another), and the variant config must still agree.
// General merging stays owner-only (/api/sku-master/merge).

const empty = (x: unknown) => x === undefined || x === null || x === ''

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getSessionUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(user, 'new_entry')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data } = await supabaseAdmin.from('qc_agent_sessions').select(SESSION_COLUMNS).eq('id', id).maybeSingle()
  const row = data as SessionRow | null
  if (!row || (row.created_by !== user.id && !isManagerOrAbove(user))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.status === 'completed') return NextResponse.json({ error: 'This check is already saved.' }, { status: 409 })

  const body = await req.json().catch(() => ({}))
  const ev = await evaluateSession(row)
  const match = ev?.sku_match
  if (!ev || !match || ev.existing_unit) return NextResponse.json({ error: 'No SKU to upgrade for this check.' }, { status: 400 })
  if (body?.sku_id !== match.id) return NextResponse.json({ error: 'The matched SKU changed — reload the page.' }, { status: 409 })
  if (!canUpgradeSku(match)) return NextResponse.json({ ok: true, sku_id: match.id, action: 'none' })

  const { data: template } = await supabaseAdmin
    .from('sku_category_templates').select('field_schema').eq('category', ev.category).maybeSingle()
  let schema: any = template?.field_schema
  if (typeof schema === 'string') { try { schema = JSON.parse(schema) } catch { schema = null } }
  const allowed = new Set<string>((schema?.fields || []).map((f: any) => f.name))
  const variantFields: string[] = schema?.variant_fields || []

  // The engineer may have corrected a detected value on the review screen.
  const edited = body?.specs && typeof body.specs === 'object' ? body.specs : {}
  const specs: Record<string, any> = {}
  for (const [k, v] of Object.entries({ ...ev.specs, ...edited })) if (allowed.has(k) && !empty(v)) specs[k] = v

  // Never merge two different configurations: every variant field recorded on
  // both sides must still agree after the engineer's edits.
  const norm = (v: unknown) => normalizeForComparison(String(v ?? '')).replace(/\s+/g, '')
  const conflict = variantFields.find((f) => !empty(specs[f]) && !empty(match.specifications?.[f]) && f !== 'gpu' && norm(specs[f]) !== norm(match.specifications[f]))
  if (conflict) return NextResponse.json({ error: `The edited ${conflict} no longer matches ${match.full_sku_code} — use "Not the same" instead.` }, { status: 400 })

  const actor = { id: user.id, email: user.email, role: user.role }

  // ---- same name: fill in missing detail only ----
  if (match.naming === 'same') {
    const filled: Record<string, any> = {}
    for (const f of match.missing_detail) if (!empty(specs[f])) filled[f] = specs[f]
    if (!Object.keys(filled).length) return NextResponse.json({ ok: true, sku_id: match.id, action: 'none' })
    const { error } = await supabaseAdmin
      .from('sku_master')
      .update({ specifications: { ...filled, ...match.specifications }, updated_at: new Date().toISOString(), updated_by: user.id })
      .eq('id', match.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await logAuditEvent({
      actor, actionType: 'update', module: 'sku_master', tableName: 'sku_master', recordId: match.id, recordLabel: match.full_sku_code,
      reason: `Auto Check ${row.code}: filled missing detail`, metadata: { filled },
    })
    return NextResponse.json({ ok: true, sku_id: match.id, action: 'filled', filled: Object.keys(filled) })
  }

  // ---- resembling name: Auto Check-named SKU absorbs the old one ----
  const brand = String(specs.brand || '')
  const model = String(specs.model || specs.item_name || '')
  if (!brand || !model) return NextResponse.json({ error: 'Brand and model are needed for the new name.' }, { status: 400 })

  // The new model name goes into the dropdown list, like any new detected value.
  const modelCat = getCustomOptionsCategory(ev.category, 'model')
  if (modelCat) {
    const { data: opts } = await supabaseAdmin.from('custom_options').select('id, value, is_active').eq('category', modelCat)
    const hit = (opts || []).find((o) => normalizeForComparison(o.value) === normalizeForComparison(model))
    if (!hit) await supabaseAdmin.from('custom_options').insert({ category: modelCat, value: model, sort_order: 0 })
    else if (!hit.is_active) await supabaseAdmin.from('custom_options').update({ is_active: true }).eq('id', hit.id)
  }

  let target: any
  try {
    const res = await resolveOrCreateSku({
      category: ev.category, item_type: ev.type, brand, model_name: model, specifications: specs, sku_description: `${brand} ${model}`,
    })
    target = res.sku
  } catch (err: any) {
    return NextResponse.json({ error: `Could not create the new SKU: ${err.message}` }, { status: 500 })
  }
  if (target.id === match.id) return NextResponse.json({ ok: true, sku_id: match.id, action: 'none' })

  const reason = `Auto Check ${row.code}: renamed "${match.model}" to "${model}"`
  const { data: merged, error: mergeErr } = await supabaseAdmin.rpc('merge_sku_master', {
    p_source_ids: [match.id], p_target_id: target.id, p_actor: user.id, p_reason: reason, p_allow_cross_category: false,
  })
  if (mergeErr) return NextResponse.json({ error: `Merge failed: ${mergeErr.message}` }, { status: 400 })

  // Switch the old model name off in the dropdown once no active SKU uses it,
  // so nobody picks the weaker name again. Deactivated, never deleted.
  let retiredModel = false
  if (modelCat && normalizeForComparison(match.model) !== normalizeForComparison(model)) {
    const { data: still } = await supabaseAdmin
      .from('sku_master').select('specifications, model_name').eq('category', ev.category).neq('status', 'archived').ilike('brand', brand)
    const inUse = (still || []).some((s: any) => normalizeForComparison(String(s.specifications?.model || s.model_name || '')) === normalizeForComparison(match.model))
    if (!inUse) {
      const { data: opts } = await supabaseAdmin.from('custom_options').select('id, value').eq('category', modelCat).eq('is_active', true)
      const old = (opts || []).find((o) => normalizeForComparison(o.value) === normalizeForComparison(match.model))
      if (old) { await supabaseAdmin.from('custom_options').update({ is_active: false }).eq('id', old.id); retiredModel = true }
    }
  }

  await logAuditEvent({
    actor, actionType: 'update', module: 'sku_master', tableName: 'sku_master', recordId: target.id,
    recordLabel: target.full_sku_code, restoreStatus: 'not_applicable', reason,
    metadata: { source_ids: [match.id], merged: (merged as any)?.merged, via: 'auto_check', session_id: row.id, retired_model_option: retiredModel },
  })

  return NextResponse.json({
    ok: true, action: 'merged', sku_id: target.id, full_sku_code: target.full_sku_code,
    from: match.full_sku_code, merged: (merged as any)?.merged?.[0] || null, retired_model_option: retiredModel,
  })
}

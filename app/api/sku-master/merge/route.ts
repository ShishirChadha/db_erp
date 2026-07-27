import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// Merging/archiving sku_master rows is data-integrity surgery, not ordinary catalog
// editing -- gated on isOwner() directly (like PATCH /api/tags) rather than the
// page-key gate sku-master's own GET/POST routes use, since a page-access grant
// should never imply this.

// ---------- GET: preview what a merge would move, before the owner commits ----------
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const sourceIds = (searchParams.get('source_ids') || '').split(',').map((s) => s.trim()).filter(Boolean)
  const targetId = searchParams.get('target_id')
  if (sourceIds.length === 0 || !targetId) {
    return NextResponse.json({ error: 'source_ids and target_id are required' }, { status: 400 })
  }

  const { data: target } = await supabaseAdmin
    .from('sku_master')
    .select('id, category')
    .eq('id', targetId)
    .single()
  if (!target) return NextResponse.json({ error: 'Target SKU not found' }, { status: 404 })

  const { data: sources } = await supabaseAdmin
    .from('sku_master')
    .select('id, full_sku_code, category, quantity_in_stock')
    .in('id', sourceIds)

  const previews = await Promise.all(
    (sources || []).map(async (source) => {
      const [assetIdsRes, reorderCount] = await Promise.all([
        supabaseAdmin.from('asset_ledger').select('id').eq('sku_id', source.id),
        supabaseAdmin.from('reorder_rules').select('id', { count: 'exact', head: true }).eq('sku_id', source.id),
      ])
      const assetIds = (assetIdsRes.data || []).map((a) => a.id)
      let invoicedCount = 0
      if (assetIds.length > 0) {
        const { count } = await supabaseAdmin
          .from('sales')
          .select('id', { count: 'exact', head: true })
          .in('asset_ledger_id', assetIds)
          .eq('finalized', true)
        invoicedCount = count ?? 0
      }
      return {
        id: source.id,
        full_sku_code: source.full_sku_code,
        category: source.category,
        quantity_in_stock: source.quantity_in_stock,
        asset_count: assetIds.length,
        invoiced_asset_count: invoicedCount,
        reorder_rule_count: reorderCount.count ?? 0,
        category_mismatch: source.category !== target.category,
      }
    })
  )

  return NextResponse.json({ target_id: target.id, target_category: target.category, sources: previews })
}

// ---------- POST: execute the merge ----------
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const { source_ids, target_id, reason, allow_cross_category } = body as {
    source_ids?: string[]
    target_id?: string
    reason?: string
    allow_cross_category?: boolean
  }

  if (!Array.isArray(source_ids) || source_ids.length === 0 || !target_id) {
    return NextResponse.json({ error: 'source_ids (non-empty array) and target_id are required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin.rpc('merge_sku_master', {
    p_source_ids: source_ids,
    p_target_id: target_id,
    p_actor: sessionUser.id,
    p_reason: reason || null,
    p_allow_cross_category: !!allow_cross_category,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

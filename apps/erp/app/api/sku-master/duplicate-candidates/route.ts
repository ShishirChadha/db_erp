import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { isLikelyDuplicateText, normalizeForComparison } from '@/lib/text-normalize'
import { specsMatchOnFields, getVariantFieldsMap } from '@/lib/sku-duplicate-detector'

interface SkuRow {
  id: string
  category: string
  brand: string | null
  model_name: string | null
  full_sku_code: string
  base_sku_code: string
  specifications: Record<string, any> | null
  quantity_in_stock: number | null
  created_at: string
}

// ---------- GET: owner-only scan for likely-duplicate active SKUs ----------
// Groups active SKUs by category + normalized brand, then clusters within each
// group by isLikelyDuplicateText(model_name) AND matching variant-distinguishing
// specs (sku_category_templates.field_schema.variant_fields, e.g. ram/ssd for
// LAP) so the owner can spot and merge drift (e.g. "T450" / "ThinkPad T450" /
// "Thinkpad T450") proactively, without lumping in a same-model sibling that's
// legitimately a different config (e.g. a 128GB SSD variant next to a 256GB
// one) -- same base_sku_code is NOT a safe signal to exclude a pair on its own:
// real duplicates can and do share one base_sku_code (redundant entries under
// the same variant family), so specs are the only reliable differentiator.
// No cost/vendor fields selected.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const [{ data, error }, variantFieldsMap] = await Promise.all([
    supabaseAdmin
      .from('sku_master')
      .select('id, category, brand, model_name, full_sku_code, base_sku_code, specifications, quantity_in_stock, created_at')
      .eq('status', 'active'),
    getVariantFieldsMap(),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const groups = new Map<string, SkuRow[]>()
  for (const row of (data || []) as SkuRow[]) {
    if (!row.brand || !row.model_name) continue
    const key = `${row.category}::${normalizeForComparison(row.brand)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }

  const clusters: { category: string; brand: string; skus: SkuRow[] }[] = []
  for (const [, rows] of groups) {
    if (rows.length < 2) continue
    const variantFields = variantFieldsMap[rows[0].category] || []
    // Union-find over pairs that match on BOTH model-name text AND variant specs.
    const parent = new Map<string, string>(rows.map((r) => [r.id, r.id]))
    const find = (id: string): string => {
      let root = id
      while (parent.get(root) !== root) root = parent.get(root)!
      return root
    }
    const union = (a: string, b: string) => {
      const ra = find(a)
      const rb = find(b)
      if (ra !== rb) parent.set(ra, rb)
    }
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const textMatch = isLikelyDuplicateText(rows[i].model_name!, rows[j].model_name!)
        const specMatch = specsMatchOnFields(rows[i].specifications || {}, rows[j].specifications || {}, variantFields)
        if (textMatch && specMatch) union(rows[i].id, rows[j].id)
      }
    }
    const byRoot = new Map<string, SkuRow[]>()
    for (const row of rows) {
      const root = find(row.id)
      if (!byRoot.has(root)) byRoot.set(root, [])
      byRoot.get(root)!.push(row)
    }
    for (const [, clusterRows] of byRoot) {
      if (clusterRows.length >= 2) {
        clusters.push({ category: clusterRows[0].category, brand: clusterRows[0].brand!, skus: clusterRows })
      }
    }
  }

  return NextResponse.json(clusters)
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { isLikelyDuplicateText, normalizeForComparison } from '@/lib/text-normalize'

interface SkuRow {
  id: string
  category: string
  brand: string | null
  model_name: string | null
  full_sku_code: string
  base_sku_code: string
  quantity_in_stock: number | null
  created_at: string
}

// ---------- GET: owner-only scan for likely-duplicate active SKUs ----------
// Groups active SKUs by category + normalized brand, then clusters within each
// group by isLikelyDuplicateText(model_name) so the owner can spot and merge
// drift (e.g. "T450" / "ThinkPad T450" / "Thinkpad T450") proactively, rather
// than only after it's reported. No cost/vendor fields selected.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data, error } = await supabaseAdmin
    .from('sku_master')
    .select('id, category, brand, model_name, full_sku_code, base_sku_code, quantity_in_stock, created_at')
    .eq('status', 'active')

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
    // Union-find over pairwise isLikelyDuplicateText matches within the group.
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
        if (isLikelyDuplicateText(rows[i].model_name!, rows[j].model_name!)) {
          union(rows[i].id, rows[j].id)
        }
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

import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { findInStockProducts } from '@/lib/marketing/product-data'

// Browse/list endpoint over real current (live) stock -- backs Today's Picks' photo
// grid and the Single Product tab's search picker. Both need the same underlying data
// findInStockProducts already provides for Product List generation (source='employee_
// intake', deduped, category/brand/spec-filterable), just returned as a browsable list
// instead of turned straight into a WhatsApp message. Replaces the old priority-bucket
// suggestion engine (lib/marketing/suggest.ts, removed 2026-09-11) -- the owner asked
// for direct browse-and-select instead of a fixed P1-P4 ranking.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'marketing')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category') || undefined
  const brand = searchParams.get('brand') || undefined
  const cpu = searchParams.get('cpu') || undefined
  const search = searchParams.get('search') || undefined
  const inStockOnly = searchParams.get('in_stock') !== 'false'
  const limit = Number(searchParams.get('limit')) || 200

  try {
    const products = await findInStockProducts({
      category,
      brand,
      spec: cpu ? { cpu } : undefined,
      search,
      inStockOnly,
      limit,
    })
    return NextResponse.json({ products })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load products' }, { status: 500 })
  }
}

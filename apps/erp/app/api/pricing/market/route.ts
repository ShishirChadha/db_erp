import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { loadMarket } from '@/lib/pricing-board'

// Everything competitors sell that is the same model as one SKU (all variants), for the
// Price Board detail pane. Owner-only.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const skuId = req.nextUrl.searchParams.get('sku_id')
  if (!skuId) return NextResponse.json({ error: 'sku_id is required' }, { status: 400 })
  try {
    const data = await loadMarket(skuId)
    if (!data) return NextResponse.json({ error: 'SKU not found' }, { status: 404 })
    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

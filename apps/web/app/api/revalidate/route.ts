import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { revalidateProductSkus, revalidateWholeSite } from '@/lib/revalidate-catalog'

export const dynamic = 'force-dynamic'

// Called by the ERP (apps/erp/lib/web-revalidate.ts) after it changes anything
// the storefront shows, so pages can stay cached for long periods and still
// update straight away. Shared secret in a header, never the query string.
function authorised(req: NextRequest): boolean {
  const expected = process.env.WEB_REVALIDATE_SECRET?.trim()
  const given = req.headers.get('x-revalidate-secret')?.trim()
  if (!expected || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  if (body.all === true) {
    revalidateWholeSite()
    return NextResponse.json({ revalidated: 'all' })
  }

  const skuIds = Array.isArray(body.skuIds) ? body.skuIds.filter((id: unknown) => typeof id === 'string').slice(0, 500) : []
  if (skuIds.length === 0) return NextResponse.json({ error: 'skuIds or all is required' }, { status: 400 })
  await revalidateProductSkus(skuIds)
  return NextResponse.json({ revalidated: skuIds.length })
}

import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { getPublishedProductById } from '@/lib/marketing/product-data'
import { renderProductCard, CARD_FORMATS, type CardFormat } from '@/lib/marketing/card-templates'

// Renders a branded PNG product card on demand -- GET so it can be used directly as
// an <img src> / download link from the Studio UI. Auth still required (Bearer token
// via a signed fetch, not a public route) since this reads sku_id from the
// public_products view via the service-role client, same posture as every other
// authenticated data read in this app.
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'marketing')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const skuId = searchParams.get('sku_id')
  const format = (searchParams.get('format') || 'wa_square') as CardFormat
  if (!skuId) return NextResponse.json({ error: 'sku_id is required' }, { status: 400 })
  if (!(format in CARD_FORMATS)) return NextResponse.json({ error: `Unknown format: ${format}` }, { status: 400 })

  const product = await getPublishedProductById(skuId)
  if (!product) return NextResponse.json({ error: 'That SKU is not published on the website.' }, { status: 404 })

  try {
    return await renderProductCard(product, format)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Card rendering failed' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { getInStockProductById, getProductImagePaths } from '@/lib/marketing/product-data'
import { renderProductCard, CARD_FORMATS, type CardFormat } from '@/lib/marketing/card-templates'

// Renders a branded PNG product card on demand -- GET so it can be used directly as
// an <img src> / download link from the Studio UI. Auth still required (Bearer token
// via a signed fetch, not a public route) since this reads sku_id from sku_master via
// the service-role client, same posture as every other authenticated data read in this
// app. Sourced from current (live) stock, not website-publish status -- a card is just
// a photo + spec + phone number, no product link, so there's nothing about it that
// requires the SKU to be published (see product-data.ts's getInStockProductById).
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'marketing')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const skuId = searchParams.get('sku_id')
  const format = (searchParams.get('format') || 'wa_square') as CardFormat
  if (!skuId) return NextResponse.json({ error: 'sku_id is required' }, { status: 400 })
  if (!(format in CARD_FORMATS)) return NextResponse.json({ error: `Unknown format: ${format}` }, { status: 400 })

  const product = await getInStockProductById(skuId)
  if (!product) return NextResponse.json({ error: 'That item is not currently in stock.' }, { status: 404 })

  try {
    const imagePaths = await getProductImagePaths(skuId, 4)
    return await renderProductCard(product, format, imagePaths)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Card rendering failed' }, { status: 500 })
  }
}

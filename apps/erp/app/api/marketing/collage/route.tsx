import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { getPrimaryImagePathsBySkuIds } from '@/lib/marketing/product-data'
import { renderMultiItemCollage, CARD_FORMATS, type CardFormat } from '@/lib/marketing/card-templates'

// Renders a branded PNG collage from one primary photo per selected SKU -- Today's
// Picks' multi-select "Download collage" action. Distinct from /api/marketing/card,
// which collages several photos of ONE product; this collages one photo each from
// SEVERAL different products. Capped at 9 items -- past that a grid stops reading as a
// usable broadcast image, and the WhatsApp message text (generated separately) already
// carries the full list regardless of how many photos fit on the card.
const MAX_COLLAGE_ITEMS = 9

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'marketing')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const skuIdsParam = searchParams.get('sku_ids')
  const format = (searchParams.get('format') || 'wa_square') as CardFormat
  if (!skuIdsParam) return NextResponse.json({ error: 'sku_ids is required' }, { status: 400 })
  if (!(format in CARD_FORMATS)) return NextResponse.json({ error: `Unknown format: ${format}` }, { status: 400 })

  const skuIds = skuIdsParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, MAX_COLLAGE_ITEMS)
  if (skuIds.length === 0) return NextResponse.json({ error: 'sku_ids is required' }, { status: 400 })

  try {
    const photoBySkuId = await getPrimaryImagePathsBySkuIds(skuIds)
    // Preserve the caller's selection order, and only include items that actually have
    // a photo -- a placeholder block in a multi-item grid would be visually noisier than
    // just omitting that one cell.
    const imagePaths = skuIds.map((id) => photoBySkuId.get(id)).filter((p): p is string => !!p)
    if (imagePaths.length === 0) {
      return NextResponse.json({ error: 'None of the selected items have a photo uploaded.' }, { status: 400 })
    }
    return await renderMultiItemCollage(imagePaths, format)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Collage rendering failed' }, { status: 500 })
  }
}

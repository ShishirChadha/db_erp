import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// Owner decides, per laptop and per competitor product, whether it is the same model.
// 'confirmed' = "This model" (always included), 'rejected' = "Not this model" (hidden),
// 'clear' forgets the decision so the automatic model match applies again.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const body = await req.json()
  const { sku_id, competitor_id, product_key, status } = body as Record<string, string>
  if (!sku_id || !competitor_id || !product_key) return NextResponse.json({ error: 'sku_id, competitor_id and product_key are required' }, { status: 400 })
  if (!['confirmed', 'rejected', 'clear'].includes(status)) return NextResponse.json({ error: 'status must be confirmed, rejected or clear' }, { status: 400 })
  const listing_key = `product:${product_key}`

  if (status === 'clear') {
    await supabaseAdmin.from('competitor_price_links').delete().eq('sku_id', sku_id).eq('competitor_id', competitor_id).eq('listing_key', listing_key)
    return NextResponse.json({ ok: true })
  }
  const { data: listing } = await supabaseAdmin.from('competitor_listings').select('title, url').eq('competitor_id', competitor_id).eq('product_key', product_key).limit(1).maybeSingle()
  if (!listing) return NextResponse.json({ error: 'That competitor product is no longer in the latest check. Run Check competitors again.' }, { status: 404 })

  const { error } = await supabaseAdmin.from('competitor_price_links').upsert(
    { sku_id, competitor_id, listing_key, title: listing.title, url: listing.url, status, decided_by: sessionUser.id, decided_at: new Date().toISOString() },
    { onConflict: 'sku_id,competitor_id,listing_key' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

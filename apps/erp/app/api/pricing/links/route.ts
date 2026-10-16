import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'

// Owner decides once whether a competitor listing is the same machine as one of our SKUs.
// 'clear' forgets the decision so the automatic suggestion applies again.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const body = await req.json()
  const { sku_id, competitor_id, listing_key, status } = body as Record<string, string>
  if (!sku_id || !competitor_id || !listing_key) return NextResponse.json({ error: 'sku_id, competitor_id and listing_key are required' }, { status: 400 })
  if (!['confirmed', 'rejected', 'clear'].includes(status)) return NextResponse.json({ error: 'status must be confirmed, rejected or clear' }, { status: 400 })

  if (status === 'clear') {
    await supabaseAdmin.from('competitor_price_links').delete().eq('sku_id', sku_id).eq('competitor_id', competitor_id).eq('listing_key', listing_key)
    return NextResponse.json({ ok: true })
  }
  const { data: listing } = await supabaseAdmin.from('competitor_listings').select('title, url').eq('competitor_id', competitor_id).eq('listing_key', listing_key).maybeSingle()
  if (!listing) return NextResponse.json({ error: 'That competitor listing is no longer in the latest check. Run Check now again.' }, { status: 404 })

  const { error } = await supabaseAdmin.from('competitor_price_links').upsert(
    { sku_id, competitor_id, listing_key, title: listing.title, url: listing.url, status, decided_by: sessionUser.id, decided_at: new Date().toISOString() },
    { onConflict: 'sku_id,competitor_id,listing_key' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

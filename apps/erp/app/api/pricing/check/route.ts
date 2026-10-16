import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { guardedFetch } from '@/lib/net-guard'
import { fetchCatalogue } from '@/lib/competitor-prices/fetch'
import { logAuditEvent } from '@/lib/audit-log'

export const maxDuration = 60

const MIN_GAP_MS = 10 * 60 * 1000

// "Check now": read each competitor's public price list (Shopify /products.json or the
// WooCommerce store API), keep the latest price per listing, and record a price
// observation for every listing the owner has confirmed as the same machine.
// Owner-only, on demand, polite (<= 14 requests per site, at most one run per site per 10 min).
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const only = typeof body.competitor_id === 'string' ? body.competitor_id : null

  let q = supabaseAdmin.from('seo_competitors').select('id, label, base_url').eq('is_self', false)
  if (only) q = q.eq('id', only)
  const { data: competitors, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!competitors || competitors.length === 0) return NextResponse.json({ error: 'No competitor websites to check. Add them under Website SEO → Competitor websites.' }, { status: 404 })

  const results: { competitor: string; status: 'ok' | 'skipped' | 'error'; listings?: number; message: string }[] = []
  const fetcher = (url: string) => guardedFetch(url, { timeoutMs: 15000, maxBytes: 4_000_000 })

  for (const c of competitors as any[]) {
    const { data: last } = await supabaseAdmin.from('competitor_listings').select('fetched_at').eq('competitor_id', c.id).order('fetched_at', { ascending: false }).limit(1)
    if (last?.[0] && Date.now() - new Date(last[0].fetched_at).getTime() < MIN_GAP_MS) {
      results.push({ competitor: c.label, status: 'skipped', message: 'Checked less than 10 minutes ago; showing the latest prices.' })
      continue
    }
    const runStart = new Date().toISOString()
    const cat = await fetchCatalogue(c.base_url, fetcher)
    if (cat.error || cat.listings.length === 0) {
      results.push({ competitor: c.label, status: 'error', message: cat.error || 'The site returned no products.' })
      continue
    }

    const rows = cat.listings.map((l) => ({
      competitor_id: c.id, listing_key: l.listingKey, title: l.title.slice(0, 300), url: l.url, brand: l.brand, model: l.model,
      cpu: l.cpu, generation: l.generation != null ? String(l.generation) : null, ram_gb: l.ramGb, ssd_gb: l.ssdGb,
      warranty_months: l.warrantyMonths, price: l.price, in_stock: l.inStock, fetched_at: runStart,
    }))
    for (let i = 0; i < rows.length; i += 500) {
      const { error: upErr } = await supabaseAdmin.from('competitor_listings').upsert(rows.slice(i, i + 500), { onConflict: 'competitor_id,listing_key' })
      if (upErr) { results.push({ competitor: c.label, status: 'error', message: upErr.message }); break }
    }
    // listings the shop no longer shows are gone from its catalogue
    await supabaseAdmin.from('competitor_listings').delete().eq('competitor_id', c.id).lt('fetched_at', runStart)

    // observations for owner-confirmed matches, only when the price moved
    const { data: links } = await supabaseAdmin.from('competitor_price_links').select('sku_id, listing_key').eq('competitor_id', c.id).eq('status', 'confirmed')
    let logged = 0
    for (const link of links || []) {
      const l = cat.listings.find((x) => x.listingKey === link.listing_key)
      if (!l) continue
      const note = `fetched:${link.listing_key}`
      const { data: prev } = await supabaseAdmin.from('market_price_observations').select('price').eq('sku_id', link.sku_id).eq('notes', note).eq('is_deleted', false).order('observed_at', { ascending: false }).limit(1)
      if (prev?.[0] && Number(prev[0].price) === l.price) continue
      const { error: obsErr } = await supabaseAdmin.from('market_price_observations').insert({
        sku_id: link.sku_id, competitor: c.label, price: l.price, warranty_months: l.warrantyMonths, source_url: l.url, notes: note, observed_by: sessionUser.id,
      })
      if (!obsErr) logged++
    }
    results.push({ competitor: c.label, status: 'ok', listings: cat.listings.length, message: `${cat.listings.length} listings read (${cat.platform}, ${cat.requests} requests)` + (logged ? `; ${logged} price change(s) logged for confirmed matches` : '') })
  }

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'settings', tableName: 'competitor_listings', recordId: null, recordLabel: 'Competitor price check',
    metadata: { results },
  })
  return NextResponse.json({ results })
}

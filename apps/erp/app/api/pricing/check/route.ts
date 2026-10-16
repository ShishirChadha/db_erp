import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { fetchCatalogue, type PriceSource } from '@/lib/competitor-prices/fetch'
import { priceFetcher } from '@/lib/competitor-prices/probe'
import { parseTitle, skuConfig } from '@/lib/competitor-prices/parse'
import type { Wanted } from '@/lib/competitor-prices/jsonld'
import { fetchAll, BOARD_CATEGORIES } from '@/lib/pricing-board'
import { logAuditEvent } from '@/lib/audit-log'

export const maxDuration = 60

const MIN_GAP_MS = 10 * 60 * 1000

type Result = { competitor: string; status: 'ok' | 'skipped' | 'error' | 'blocked'; listings?: number; products?: number; message: string }

// "Check now": read each enabled competitor's public prices (every RAM/SSD/warranty variant),
// keep the latest per variant, grouped by product. Owner-only, on demand, polite
// (<= 14 requests per feed shop; <= 80 product pages for page-markup shops; one run per
// site per 10 minutes). Sites run in parallel to stay inside the 60 s function limit.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const only = typeof body.competitor_id === 'string' ? body.competitor_id : null

  let q = supabaseAdmin.from('seo_competitors').select('id, label, base_url, price_source, price_enabled, last_price_check_at, last_price_check_note').eq('is_self', false).eq('price_enabled', true)
  if (only) q = q.eq('id', only)
  const { data: competitors, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!competitors || competitors.length === 0) return NextResponse.json({ error: 'No competitors with price checks switched on. Add one under Competitors.' }, { status: 404 })

  // Models we carry: page-markup shops are only read for these.
  const skus = await fetchAll<any>((a, b) => supabaseAdmin.from('sku_master').select('brand, model_name, specifications').in('category', BOARD_CATEGORIES).eq('status', 'active').range(a, b))
  const seen = new Set<string>()
  const wanted: Wanted[] = []
  for (const s of skus) {
    const c = skuConfig(s)
    if (!c.modelTokens.length) continue
    const key = `${c.brand}|${c.modelTokens.join(',')}`
    if (!seen.has(key)) { seen.add(key); wanted.push({ brand: c.brand, modelTokens: c.modelTokens }) }
  }

  const runOne = async (c: any): Promise<Result> => {
    const last = c.last_price_check_at ? new Date(c.last_price_check_at).getTime() : 0
    if (last && Date.now() - last < MIN_GAP_MS && !/^(blocked|error)/i.test(c.last_price_check_note || '')) {
      return { competitor: c.label, status: 'skipped', message: 'Checked less than 10 minutes ago; showing the latest prices.' }
    }
    const runStart = new Date().toISOString()
    const cat = await fetchCatalogue(c.base_url, priceFetcher, { source: (c.price_source as PriceSource | null) ?? null, wanted })
    const note = (text: string) => supabaseAdmin.from('seo_competitors').update({ last_price_check_at: runStart, last_price_check_note: text }).eq('id', c.id)

    if (!cat.error && cat.listings.length === 0 && cat.platform) {
      // readable shop, but none of the models we carry are on it: not a failure, and nothing is deleted
      const msg = 'Readable, but none of the models you carry were found on it.'
      await note(`${cat.platform}: ${msg}`)
      return { competitor: c.label, status: 'ok', listings: 0, products: 0, message: msg }
    }
    if (cat.error || cat.listings.length === 0) {
      const msg = cat.error || 'The site returned no products.'
      await note(`${cat.blocked ? 'blocked' : 'error'}: ${msg}`.slice(0, 300))
      return { competitor: c.label, status: cat.blocked ? 'blocked' : 'error', message: msg }
    }

    const rows = cat.listings.map((l) => ({
      competitor_id: c.id, listing_key: l.listingKey, product_key: l.productKey, title: l.title.slice(0, 300), url: l.url, brand: l.brand, model: l.model,
      cpu: l.cpu, generation: l.generation != null ? String(l.generation) : null, ram_gb: l.ramGb, ssd_gb: l.ssdGb,
      warranty_months: l.warrantyMonths, condition: l.condition, variant_label: l.variantLabel, price: l.price, in_stock: l.inStock, fetched_at: runStart,
    }))
    for (let i = 0; i < rows.length; i += 500) {
      const { error: upErr } = await supabaseAdmin.from('competitor_listings').upsert(rows.slice(i, i + 500), { onConflict: 'competitor_id,listing_key' })
      if (upErr) { await note(`error: ${upErr.message}`.slice(0, 300)); return { competitor: c.label, status: 'error', message: upErr.message } }
    }
    if (cat.complete) {
      // whole catalogue read: anything not re-seen has been taken down by the shop
      await supabaseAdmin.from('competitor_listings').delete().eq('competitor_id', c.id).lt('fetched_at', runStart)
    } else {
      // partial read: only retire variants of products we actually re-read
      const keys = [...new Set(cat.listings.map((l) => l.productKey))]
      for (let i = 0; i < keys.length; i += 100) {
        await supabaseAdmin.from('competitor_listings').delete().eq('competitor_id', c.id).in('product_key', keys.slice(i, i + 100)).lt('fetched_at', runStart)
      }
    }
    const products = new Set(cat.listings.map((l) => l.productKey)).size
    const msg = `${products} products, ${cat.listings.length} variants (${cat.platform}, ${cat.requests} requests)`
    await note(`${cat.platform}: ${msg}`)
    return { competitor: c.label, status: 'ok', listings: cat.listings.length, products, message: msg }
  }

  const results = await Promise.all((competitors as any[]).map((c) => runOne(c).catch((e): Result => ({ competitor: c.label, status: 'error', message: e?.message || 'Check failed' }))))

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'update', module: 'settings', tableName: 'competitor_listings', recordId: null, recordLabel: 'Competitor price check',
    metadata: { results },
  })
  return NextResponse.json({ results })
}

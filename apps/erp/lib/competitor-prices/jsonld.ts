// Generic reader for stores that publish schema.org Product pages (Edify and any similar
// storefront): sitemap -> product URLs -> JSON-LD Product with one Offer per RAM/storage.

import { decodeEntities, parseCpu, parseGeneration, parseTitle } from './parse'
import { variantLabel, type Listing } from './adapters'

const sizeGb = (raw: string | null): number | null => {
  const m = String(raw ?? '').match(/(\d+(?:\.\d+)?)\s*(gb|tb)/i)
  if (!m) return null
  return Math.round(Number(m[1]) * (/t/i.test(m[2]) ? 1024 : 1))
}

function productFromJsonLd(html: string): any | null {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const node = JSON.parse(m[1])
      const list = Array.isArray(node) ? node : node?.['@graph'] ? node['@graph'] : [node]
      const p = list.find((x: any) => x && (x['@type'] === 'Product' || (Array.isArray(x['@type']) && x['@type'].includes('Product'))))
      if (p) return p
    } catch { /* next block */ }
  }
  return null
}

/** Pull the page's own "device_condition" (Edify embeds it next to the product slug in its data payload). */
function conditionNearSlug(html: string, slug: string): string | null {
  const flat = html.replace(/\\"/g, '"')
  if (!slug) return null
  // The slug appears many times (canonical link, related products...); the product record's
  // device_condition is the closest one that follows an occurrence of its slug.
  let best: { dist: number; value: string } | null = null
  for (let at = flat.indexOf(slug); at >= 0; at = flat.indexOf(slug, at + slug.length)) {
    const m = flat.slice(at, at + 2500).match(/"device_condition":"([A-Za-z ]{3,20})"/)
    if (m && m.index != null && (!best || m.index < best.dist)) best = { dist: m.index, value: m[1].trim() }
  }
  return best ? best.value : null
}

export function slugOf(url: string): string {
  try { return new URL(url).pathname.split('/').filter(Boolean).pop() ?? '' } catch { return '' }
}

/** One Listing per Offer on a product page, or [] when the page has no priced Product markup. */
export function parseProductPage(html: string, pageUrl: string): Listing[] {
  const p = productFromJsonLd(html)
  if (!p) return []
  const title = decodeEntities(String(p.name ?? '')).trim()
  if (!title) return []
  const offers: any[] = Array.isArray(p.offers) ? p.offers : p.offers ? [p.offers] : []
  const slug = slugOf(pageUrl)
  const c = parseTitle(title)
  const pageCondition = conditionNearSlug(html, slug)
  const out: Listing[] = []
  for (const o of offers) {
    const price = Number(o.price ?? o.lowPrice)
    if (!Number.isFinite(price) || price <= 0) continue
    let ram: number | null = null, ssd: number | null = null
    try {
      const u = new URL(String(o.url ?? ''), pageUrl)
      ram = sizeGb(u.searchParams.get('ram'))
      ssd = sizeGb(u.searchParams.get('storage') ?? u.searchParams.get('ssd'))
    } catch { /* fall through */ }
    if ((ram == null || ssd == null) && o.sku) {
      const sku = String(o.sku)
      ram = ram ?? sizeGb((sku.match(/RAM-(\d+\s*[GT]B)/i) || [])[1] ?? null)
      ssd = ssd ?? sizeGb((sku.match(/ST-(\d+\s*[GT]B)/i) || [])[1] ?? null)
    }
    ram = ram ?? c.ramGb
    ssd = ssd ?? c.ssdGb
    const ic = String(o.itemCondition ?? '')
    const condition = pageCondition ?? (/Refurbished/i.test(ic) ? 'Refurbished' : /New/i.test(ic) ? 'New' : null)
    out.push({
      listingKey: `jsonld:${slug}:${ram ?? 'x'}-${ssd ?? 'x'}`,
      productKey: `jsonld:${slug}`,
      title,
      variantLabel: variantLabel(ram, ssd, null, condition),
      url: pageUrl,
      brand: typeof p.brand === 'string' ? p.brand.toLowerCase() : String(p.brand?.name ?? '').toLowerCase() || c.brand,
      model: c.modelTokens.join(' ') || null,
      cpu: parseCpu(title), generation: parseGeneration(title),
      ramGb: ram, ssdGb: ssd, warrantyMonths: null, condition,
      price, inStock: !/OutOfStock|SoldOut|Discontinued/i.test(String(o.availability ?? '')),
    })
  }
  return out
}

/** Which product pages are worth fetching: slug carries the brand and every model number we carry. */
export interface Wanted { brand: string | null; modelTokens: string[] }

export function pickProductUrls(sitemapLocs: string[], wanted: Wanted[], limit: number): string[] {
  const urls = sitemapLocs.filter((u) => /\/products?\//i.test(u))
  const out: string[] = []
  const seen = new Set<string>()
  for (const u of urls) {
    const toks = slugOf(u).toLowerCase().split('-')
    const hit = wanted.some((w) => {
      if (!w.modelTokens.length) return false
      if (w.brand && !toks.includes(w.brand)) return false
      return w.modelTokens.every((t) => toks.includes(t) || toks.includes('x' + t) || (t.startsWith('x') && toks.includes(t.slice(1))))
    })
    if (hit && !seen.has(u)) { seen.add(u); out.push(u); if (out.length >= limit) break }
  }
  return out
}

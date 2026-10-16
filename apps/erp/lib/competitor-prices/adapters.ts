// Turn a competitor's public catalogue JSON into one normalised listing per sellable
// configuration. Pure functions over already-fetched text.

import { decodeEntities, parseCpu, parseGeneration, parseRamGb, parseSsdGb, parseTitle, parseWarrantyMonths } from './parse'

export interface Listing {
  listingKey: string
  title: string
  url: string | null
  brand: string | null
  model: string | null
  cpu: string | null
  generation: number | null
  ramGb: number | null
  ssdGb: number | null
  warrantyMonths: number | null
  price: number
  inStock: boolean
}

const asNumber = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Shopify /products.json. Each variant is its own configuration (RAM / SSD / warranty).
 * "... Additional Wty" variants are paid warranty upsells, not the base offer, so they
 * are skipped: comparing them with our included-warranty price would mislead.
 */
export function parseShopify(json: string, baseUrl: string): Listing[] {
  let data: any
  try { data = JSON.parse(json) } catch { return [] }
  const out: Listing[] = []
  for (const p of data?.products ?? []) {
    const title = decodeEntities(String(p.title ?? ''))
    const base = parseTitle(title)
    for (const v of p.variants ?? []) {
      const vt = decodeEntities(String(v.title ?? ''))
      if (/additional/i.test(vt)) continue
      const price = asNumber(v.price)
      if (price == null || price <= 0) continue
      out.push({
        listingKey: `shopify:${p.id}:${v.id}`,
        title: vt && vt !== 'Default Title' ? `${title} (${vt})` : title,
        url: p.handle ? `${baseUrl.replace(/\/$/, '')}/products/${p.handle}` : null,
        brand: base.brand,
        model: base.modelTokens.join(' ') || null,
        cpu: parseCpu(title),
        generation: parseGeneration(title),
        ramGb: parseRamGb(vt) ?? base.ramGb,
        ssdGb: parseSsdGb(vt) ?? base.ssdGb,
        warrantyMonths: parseWarrantyMonths(vt),
        price,
        inStock: v.available !== false,
      })
    }
  }
  return out
}

/**
 * WooCommerce Store API (/wp-json/wc/store/v1/products). Prices are in minor units
 * (paise). The listed price is the lowest variant price, so it is the "from" price.
 */
export function parseWoo(json: string): Listing[] {
  let data: any
  try { data = JSON.parse(json) } catch { return [] }
  if (!Array.isArray(data)) return []
  const out: Listing[] = []
  for (const p of data) {
    const prices = p.prices || {}
    const minor = asNumber(prices.currency_minor_unit) ?? 2
    const raw = asNumber(prices.price_range?.min_amount) ?? asNumber(prices.price)
    if (raw == null || raw <= 0) continue
    const price = raw / Math.pow(10, minor)
    const title = decodeEntities(String(p.name ?? '')).replace(/\s*\|\s*EAZYPC\s*$/i, '').trim()
    const c = parseTitle(title)
    out.push({
      listingKey: `woo:${p.id}`,
      title,
      url: typeof p.permalink === 'string' ? p.permalink : null,
      brand: c.brand,
      model: c.modelTokens.join(' ') || null,
      cpu: c.cpu,
      generation: c.generation,
      ramGb: c.ramGb,
      ssdGb: c.ssdGb,
      warrantyMonths: null,
      price: Math.round(price * 100) / 100,
      inStock: p.is_in_stock !== false,
    })
  }
  return out
}

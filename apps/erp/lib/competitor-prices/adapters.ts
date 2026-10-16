// Turn a competitor's public catalogue into one normalised listing per sellable variant,
// grouped by product (productKey). Pure functions over already-fetched text.

import { decodeEntities, parseCpu, parseGeneration, parseRamGb, parseSsdGb, parseTitle, parseWarrantyMonths } from './parse'

export interface Listing {
  listingKey: string
  /** All variants of one product share this key (e.g. "woo:51296"). */
  productKey: string
  title: string
  variantLabel: string
  url: string | null
  brand: string | null
  model: string | null
  cpu: string | null
  generation: number | null
  ramGb: number | null
  ssdGb: number | null
  warrantyMonths: number | null
  condition: string | null
  price: number
  inStock: boolean
}

const asNumber = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function variantLabel(ramGb: number | null, ssdGb: number | null, warrantyMonths: number | null, condition: string | null): string {
  const parts: string[] = []
  const cfg = [ramGb != null ? `${ramGb} GB RAM` : null, ssdGb != null ? (ssdGb >= 1024 ? `${ssdGb / 1024} TB SSD` : `${ssdGb} GB SSD`) : null].filter(Boolean).join(' / ')
  if (cfg) parts.push(cfg)
  if (warrantyMonths != null) parts.push(`${warrantyMonths} m warranty`)
  if (condition) parts.push(condition)
  return parts.join(' · ') || 'Standard'
}

/** Shopify /products.json: every variant (RAM / SSD / warranty) is kept. */
export function parseShopify(json: string, baseUrl: string): Listing[] {
  let data: any
  try { data = JSON.parse(json) } catch { return [] }
  const out: Listing[] = []
  for (const p of data?.products ?? []) {
    const title = decodeEntities(String(p.title ?? ''))
    const base = parseTitle(title)
    for (const v of p.variants ?? []) {
      const vt = decodeEntities(String(v.title ?? ''))
      const price = asNumber(v.price)
      if (price == null || price <= 0) continue
      const ram = parseRamGb(vt) ?? base.ramGb
      const ssd = parseSsdGb(vt) ?? base.ssdGb
      const warranty = parseWarrantyMonths(vt)
      out.push({
        listingKey: `shopify:${p.id}:${v.id}`,
        productKey: `shopify:${p.id}`,
        title,
        variantLabel: variantLabel(ram, ssd, warranty, null),
        url: p.handle ? `${baseUrl.replace(/\/$/, '')}/products/${p.handle}` : null,
        brand: base.brand,
        model: base.modelTokens.join(' ') || null,
        cpu: parseCpu(title),
        generation: parseGeneration(title),
        ramGb: ram,
        ssdGb: ssd,
        warrantyMonths: warranty,
        condition: null,
        price,
        inStock: v.available !== false,
      })
    }
  }
  return out
}

/** "Ram: 16 GB, Storage: 512 GB, EazyCare Warranty: 30 days" (string) or [{attribute,value}] (array). */
export function wooVariationText(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((a: any) => `${a?.attribute ?? a?.name ?? ''}: ${a?.value ?? ''}`).join(', ')
  return ''
}

function wooPrice(prices: any): number | null {
  const minor = asNumber(prices?.currency_minor_unit) ?? 2
  const raw = asNumber(prices?.price)
  return raw != null && raw > 0 ? Math.round((raw / Math.pow(10, minor)) * 100) / 100 : null
}

/**
 * WooCommerce Store API. `products` = parent/simple products (?per_page=100),
 * `variations` = ?type=variation. Variable products are represented by their variations
 * only; simple products by themselves. Prices are in minor units (paise).
 */
export function parseWoo(productsJson: string, variationsJson: string | null): Listing[] {
  let products: any[] = [], variations: any[] = []
  try { products = JSON.parse(productsJson) } catch { return [] }
  if (variationsJson) { try { variations = JSON.parse(variationsJson) } catch { variations = [] } }
  if (!Array.isArray(products)) return []
  if (!Array.isArray(variations)) variations = []

  const clean = (name: string) => decodeEntities(String(name ?? '')).replace(/\s*\|\s*EAZYPC\s*$/i, '').trim()
  const out: Listing[] = []
  const variableIds = new Set<number>(variations.map((v) => Number(v.parent)))

  for (const p of products) {
    if (variableIds.has(Number(p.id)) || p.type === 'variable') continue
    const price = wooPrice(p.prices)
    if (price == null) continue
    const title = clean(p.name)
    const c = parseTitle(title)
    out.push({
      listingKey: `woo:${p.id}`, productKey: `woo:${p.id}`, title,
      variantLabel: variantLabel(c.ramGb, c.ssdGb, null, null),
      url: typeof p.permalink === 'string' ? p.permalink : null,
      brand: c.brand, model: c.modelTokens.join(' ') || null, cpu: c.cpu, generation: c.generation,
      ramGb: c.ramGb, ssdGb: c.ssdGb, warrantyMonths: null, condition: null, price, inStock: p.is_in_stock !== false,
    })
  }

  const parents = new Map<number, any>(products.map((p) => [Number(p.id), p]))
  for (const v of variations) {
    const price = wooPrice(v.prices)
    if (price == null) continue
    const parent = parents.get(Number(v.parent))
    const title = clean(parent?.name ?? v.name)
    const c = parseTitle(title)
    const attrs = wooVariationText(v.variation)
    const ramM = attrs.match(/ram:\s*(\d+)\s*gb/i)
    const stM = attrs.match(/storage:\s*(\d+)\s*(gb|tb)/i)
    const ram = ramM ? Number(ramM[1]) : parseRamGb(attrs) ?? c.ramGb
    const ssd = stM ? Number(stM[1]) * (/t/i.test(stM[2]) ? 1024 : 1) : c.ssdGb
    const warranty = parseWarrantyMonths(attrs)
    out.push({
      listingKey: `woo:${v.id}`, productKey: `woo:${v.parent}`, title,
      variantLabel: variantLabel(ram, ssd, warranty, null),
      url: typeof (parent?.permalink ?? v.permalink) === 'string' ? (parent?.permalink ?? v.permalink) : null,
      brand: c.brand, model: c.modelTokens.join(' ') || null, cpu: c.cpu, generation: c.generation,
      ramGb: ram, ssdGb: ssd, warrantyMonths: warranty, condition: null, price, inStock: v.is_in_stock !== false,
    })
  }
  return out
}

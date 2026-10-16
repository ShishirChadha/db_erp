// Fetch a competitor's public prices politely and safely. Same SSRF-guarded, robots-aware
// fetcher as the SEO competitor analyser. Three sources, auto-detected:
//   shopify     /products.json
//   woocommerce /wp-json/wc/store/v1/products (+ ?type=variation for every RAM/SSD/warranty)
//   jsonld      sitemap -> product pages carrying schema.org Product/Offer markup
// A site that answers with a bot-check challenge is reported as blocked, never bypassed.

import type { Fetcher } from '@/lib/seo-competitor'
import { parseRobots, robotsAllows, parseSitemapXml } from '@/lib/seo-competitor'
import { parseShopify, parseWoo, type Listing } from './adapters'
import { parseProductPage, pickProductUrls, type Wanted } from './jsonld'

export const MAX_FEED_REQUESTS = 14
export const MAX_PAGE_REQUESTS = 90
const PRODUCT_PAGE_LIMIT = 80
const SHOPIFY_PAGE = '/products.json?limit=100&page='
const WOO_PRODUCTS = '/wp-json/wc/store/v1/products?per_page=100&page='
const WOO_VARIATIONS = '/wp-json/wc/store/v1/products?type=variation&per_page=100&page='

export type PriceSource = 'shopify' | 'woocommerce' | 'jsonld'

export interface CatalogueOptions {
  source?: PriceSource | null
  /** Models we carry: the product-page reader only opens pages for these. */
  wanted?: Wanted[]
  /** Probe mode: read the smallest possible sample. */
  sample?: boolean
}

export interface CatalogueResult {
  platform: PriceSource | null
  listings: Listing[]
  requests: number
  error: string | null
  /** true = every product of the shop was read, so anything not seen has been removed by the shop. */
  complete: boolean
  blocked: boolean
}

const CHALLENGE = /cloudflare|captcha|cf-chl|attention required|just a moment|access denied|enable javascript and cookies/i

export function looksBlocked(res: { status: number; body: string }): boolean {
  if (res.status === 429) return true
  if ((res.status === 403 || res.status === 503) && CHALLENGE.test(res.body.slice(0, 6000))) return true
  return res.status === 403
}

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }))
  return out
}

const fail = (requests: number, error: string, blocked = false): CatalogueResult => ({ platform: null, listings: [], requests, error, complete: false, blocked })

export async function fetchCatalogue(baseUrl: string, fetcher: Fetcher, opts: CatalogueOptions = {}): Promise<CatalogueResult> {
  const base = baseUrl.replace(/\/$/, '')
  let requests = 0
  const get = async (path: string) => { requests++; return fetcher(path.startsWith('http') ? path : base + path) }
  try {
    const robotsRes = await get('/robots.txt')
    const robotsText = robotsRes.status === 200 ? robotsRes.body : ''
    const rules = parseRobots(robotsText)
    const allowed = (p: string) => robotsAllows(rules, p)
    if (!allowed('/')) return fail(requests, 'This site\'s robots.txt does not allow automated reading.', true)
    const want = opts.source ?? null
    const feedCap = MAX_FEED_REQUESTS

    // ---- Shopify
    if ((want == null || want === 'shopify') && allowed('/products.json')) {
      const first = await get(SHOPIFY_PAGE + 1)
      if (looksBlocked(first)) return fail(requests, 'The site answered with a bot check (HTTP ' + first.status + ').', true)
      if (first.status === 200 && /"products"\s*:/.test(first.body.slice(0, 200))) {
        if (first.truncated) return fail(requests, 'A catalogue page was larger than the safety limit.')
        const all = parseShopify(first.body, base)
        let count = (JSON.parse(first.body).products ?? []).length
        let complete = count < 100
        for (let page = 2; count === 100 && !opts.sample; page++) {
          if (requests >= feedCap) { complete = false; break }
          const r = await get(SHOPIFY_PAGE + page)
          if (r.status !== 200 || r.truncated) { complete = false; break }
          all.push(...parseShopify(r.body, base))
          count = (JSON.parse(r.body).products ?? []).length
          complete = count < 100
        }
        return { platform: 'shopify', listings: all, requests, error: null, complete: complete && !opts.sample, blocked: false }
      }
    }

    // ---- WooCommerce
    if ((want == null || want === 'woocommerce') && allowed('/wp-json/wc/store/v1/products')) {
      const first = await get(WOO_PRODUCTS + 1)
      if (looksBlocked(first)) return fail(requests, 'The site answered with a bot check (HTTP ' + first.status + ').', true)
      if (first.status === 200 && first.body.trimStart().startsWith('[')) {
        if (first.truncated) return fail(requests, 'A catalogue page was larger than the safety limit.')
        const products: any[] = [...JSON.parse(first.body)]
        let complete = products.length < 100
        for (let page = 2; products.length === (page - 1) * 100 && !opts.sample; page++) {
          if (requests >= feedCap) { complete = false; break }
          const r = await get(WOO_PRODUCTS + page)
          if (r.status !== 200 || r.truncated || !r.body.trimStart().startsWith('[')) { complete = false; break }
          products.push(...JSON.parse(r.body))
          complete = JSON.parse(r.body).length < 100
        }
        const variations: any[] = []
        const v1 = await get(WOO_VARIATIONS + 1)
        if (v1.status === 200 && !v1.truncated && v1.body.trimStart().startsWith('[')) {
          variations.push(...JSON.parse(v1.body))
          for (let page = 2; variations.length === (page - 1) * 100 && !opts.sample; page++) {
            if (requests >= feedCap) { complete = false; break }
            const r = await get(WOO_VARIATIONS + page)
            if (r.status !== 200 || r.truncated || !r.body.trimStart().startsWith('[')) { complete = false; break }
            variations.push(...JSON.parse(r.body))
          }
        }
        const listings = parseWoo(JSON.stringify(products), JSON.stringify(variations))
        return { platform: 'woocommerce', listings, requests, error: null, complete: complete && !opts.sample, blocked: false }
      }
    }

    // ---- schema.org product pages via the sitemap
    if (want == null || want === 'jsonld') {
      const sitemapUrls = [...robotsText.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1])
      const smStart = sitemapUrls[0] ?? `${base}/sitemap.xml`
      const sm = await get(smStart)
      if (looksBlocked(sm)) return fail(requests, 'The site answered with a bot check (HTTP ' + sm.status + ').', true)
      if (sm.status === 200) {
        let locs = parseSitemapXml(sm.body)
        let all = locs.locs
        if (locs.index) {
          const children = all.filter((u) => /product/i.test(u)).slice(0, 3)
          const use = children.length ? children : all.slice(0, 2)
          all = []
          for (const c of use) {
            if (requests >= 6) break
            const r = await get(c)
            if (r.status === 200) all.push(...parseSitemapXml(r.body).locs)
          }
        }
        const productUrls = all.filter((u) => /\/products?\//i.test(u))
        let chosen: string[]
        if (opts.sample) chosen = productUrls.slice(0, 2)
        else chosen = pickProductUrls(all, opts.wanted ?? [], PRODUCT_PAGE_LIMIT)
        chosen = chosen.filter((u) => { try { return allowed(new URL(u).pathname) } catch { return false } }).slice(0, opts.sample ? 2 : PRODUCT_PAGE_LIMIT)
        if (productUrls.length > 0) {
          let blockedHits = 0
          const pages = await pool(chosen, 4, async (u) => {
            if (requests >= MAX_PAGE_REQUESTS) return [] as Listing[]
            const r = await get(u)
            if (looksBlocked(r)) { blockedHits++; return [] as Listing[] }
            return r.status === 200 ? parseProductPage(r.body, u) : []
          })
          const listings = pages.flat()
          if (listings.length === 0 && blockedHits > 0) return fail(requests, 'Product pages answered with a bot check.', true)
          if (listings.length > 0 || chosen.length === 0) {
            return { platform: 'jsonld', listings, requests, error: null, complete: false, blocked: false }
          }
        }
      }
    }

    return fail(requests, 'No public price list found (not a Shopify or WooCommerce shop, and no product pages with price markup).')
  } catch (e: any) {
    return fail(requests, e?.message || 'Fetch failed')
  }
}

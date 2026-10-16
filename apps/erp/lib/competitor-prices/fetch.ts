// Fetch a competitor's public catalogue politely and safely. Uses the same SSRF-guarded,
// robots-aware fetcher as the SEO competitor analyser. Reads only public JSON catalogue
// endpoints (Shopify /products.json, WooCommerce Store API) and stores prices only.

import type { Fetcher } from '@/lib/seo-competitor'
import { parseRobots, robotsAllows } from '@/lib/seo-competitor'
import { parseShopify, parseWoo, type Listing } from './adapters'

export const MAX_CATALOGUE_REQUESTS = 14
const SHOPIFY_PAGE = '/products.json?limit=100&page='
const WOO_PAGE = '/wp-json/wc/store/v1/products?per_page=100&page='

export interface CatalogueResult {
  platform: 'shopify' | 'woocommerce' | null
  listings: Listing[]
  requests: number
  error: string | null
}

export async function fetchCatalogue(baseUrl: string, fetcher: Fetcher): Promise<CatalogueResult> {
  const base = baseUrl.replace(/\/$/, '')
  let requests = 0
  const get = async (path: string) => {
    requests++
    return fetcher(base + path)
  }
  try {
    const robotsRes = await get('/robots.txt')
    const rules = robotsRes.status === 200 ? parseRobots(robotsRes.body) : parseRobots('')
    const allowed = (p: string) => robotsAllows(rules, p)

    // Try Shopify first (cheap probe = first real page), then WooCommerce.
    if (allowed('/products.json')) {
      const first = await get(SHOPIFY_PAGE + 1)
      if (first.status === 200 && /"products"\s*:/.test(first.body.slice(0, 200))) {
        if (first.truncated) return { platform: 'shopify', listings: [], requests, error: 'Catalogue page was larger than the safety limit.' }
        const all = parseShopify(first.body, base)
        let pageCount = (JSON.parse(first.body).products ?? []).length
        for (let page = 2; pageCount === 100 && requests < MAX_CATALOGUE_REQUESTS; page++) {
          const r = await get(SHOPIFY_PAGE + page)
          if (r.status !== 200 || r.truncated) break
          all.push(...parseShopify(r.body, base))
          pageCount = (JSON.parse(r.body).products ?? []).length
        }
        return { platform: 'shopify', listings: all, requests, error: null }
      }
    }
    if (allowed('/wp-json/wc/store/v1/products')) {
      const first = await get(WOO_PAGE + 1)
      if (first.status === 200 && first.body.trimStart().startsWith('[')) {
        if (first.truncated) return { platform: 'woocommerce', listings: [], requests, error: 'Catalogue page was larger than the safety limit.' }
        const all = parseWoo(first.body)
        let pageCount = (JSON.parse(first.body) as unknown[]).length
        for (let page = 2; pageCount === 100 && requests < MAX_CATALOGUE_REQUESTS; page++) {
          const r = await get(WOO_PAGE + page)
          if (r.status !== 200 || r.truncated) break
          all.push(...parseWoo(r.body))
          pageCount = (JSON.parse(r.body) as unknown[]).length
        }
        return { platform: 'woocommerce', listings: all, requests, error: null }
      }
    }
    return { platform: null, listings: [], requests, error: 'No public price list found (not a Shopify or WooCommerce shop, or it blocks bots). Add prices for this site by hand.' }
  } catch (e: any) {
    return { platform: null, listings: [], requests, error: e?.message || 'Fetch failed' }
  }
}

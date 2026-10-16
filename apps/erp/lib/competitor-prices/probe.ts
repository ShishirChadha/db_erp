// Before a competitor is added, find out whether its prices can be read automatically.

import type { Fetcher } from '@/lib/seo-competitor'
import { assertPublicHttps, guardedFetch } from '@/lib/net-guard'
import { fetchCatalogue, looksBlocked, type PriceSource } from './fetch'

export interface ProbeResult {
  status: 'ok' | 'blocked' | 'unsupported'
  platform: PriceSource | null
  sampleListings: number
  message: string
}

export async function probeSite(baseUrl: string, fetcher: Fetcher): Promise<ProbeResult> {
  const base = baseUrl.replace(/\/$/, '')
  try {
    const home = await fetcher(base + '/')
    if (looksBlocked(home)) {
      return { status: 'blocked', platform: null, sampleListings: 0, message: `This site blocks automated readers (it answered HTTP ${home.status}, a bot check). Its prices cannot be read automatically; you would have to type them in.` }
    }
  } catch (e: any) {
    return { status: 'unsupported', platform: null, sampleListings: 0, message: `The site could not be reached: ${e?.message ?? 'error'}` }
  }
  const r = await fetchCatalogue(base, fetcher, { sample: true })
  if (r.blocked) return { status: 'blocked', platform: null, sampleListings: 0, message: r.error || 'This site blocks automated readers.' }
  if (r.platform && r.listings.length > 0) {
    const name = r.platform === 'jsonld' ? 'product pages with price markup' : r.platform === 'woocommerce' ? 'WooCommerce' : 'Shopify'
    return { status: 'ok', platform: r.platform, sampleListings: r.listings.length, message: `Prices can be read automatically (${name}).` }
  }
  return { status: 'unsupported', platform: null, sampleListings: 0, message: r.error || 'No readable price list found. Prices would have to be typed in by hand.' }
}

/** Fetcher used for every competitor price request: SSRF-guarded, same-site redirects only. */
export const priceFetcher: Fetcher = (url) => guardedFetch(url, { timeoutMs: 15000, maxBytes: 4_000_000 })

/** "eazypc.in" / "http://x.com/page" -> "https://x.com" (public https hosts only). */
export async function normalizeBase(raw: string): Promise<string> {
  const text = String(raw ?? '').trim()
  const url = await assertPublicHttps(/^https?:\/\//i.test(text) ? text.replace(/^http:\/\//i, 'https://') : `https://${text}`)
  return `https://${url.hostname}`
}

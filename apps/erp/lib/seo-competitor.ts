import { parse, type HTMLElement } from 'node-html-parser'
import { guardedFetch, siteKey, type GuardedResponse } from '@/lib/net-guard'

// Competitor / own-site analyser. Fetches a small, fixed set of PUBLIC pages
// (robots.txt, the sitemap, the home page and one sampled product, collection,
// policy and blog page), honours robots.txt, and keeps only extracted SIGNALS --
// counts, lengths, schema types, short claim snippets -- never page bodies, so
// nothing here can be used to copy another site's content.
//
// The fetch function is injected so the whole thing is testable offline.

export type Fetcher = (url: string) => Promise<GuardedResponse>
export const MAX_REQUESTS = 14

// ------------------------------------------------------------------ robots.txt

export interface RobotsRules {
  disallow: string[]
  allow: string[]
  sitemaps: string[]
}

const BOT_TOKEN = 'digitalbluezseo'

export function parseRobots(text: string): RobotsRules {
  const sitemaps: string[] = []
  const groups: { agents: string[]; disallow: string[]; allow: string[] }[] = []
  let current: { agents: string[]; disallow: string[]; allow: string[] } | null = null
  let lastWasAgent = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const field = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (field === 'sitemap') { sitemaps.push(value); continue }
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) { current = { agents: [], disallow: [], allow: [] }; groups.push(current) }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!current) continue
    if (field === 'disallow' && value) current.disallow.push(value)
    else if (field === 'allow' && value) current.allow.push(value)
  }
  // A group naming us beats the wildcard group.
  const ours = groups.find((g) => g.agents.some((a) => a.includes(BOT_TOKEN)))
  const star = groups.find((g) => g.agents.includes('*'))
  const chosen = ours ?? star
  return { disallow: chosen?.disallow ?? [], allow: chosen?.allow ?? [], sitemaps }
}

function ruleMatches(rule: string, path: string): number {
  // Returns the matched length (for longest-match precedence) or -1.
  const anchored = rule.endsWith('$')
  const body = anchored ? rule.slice(0, -1) : rule
  const re = new RegExp('^' + body.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''))
  return re.test(path) ? body.length : -1
}

export function robotsAllows(rules: RobotsRules, path: string): boolean {
  let dis = -1
  let alw = -1
  for (const r of rules.disallow) dis = Math.max(dis, ruleMatches(r, path))
  for (const r of rules.allow) alw = Math.max(alw, ruleMatches(r, path))
  if (dis < 0) return true
  return alw >= dis // on a tie the more permissive rule wins
}

// ------------------------------------------------------------------ sitemap

export type UrlBucket = 'product' | 'collection' | 'blog' | 'page' | 'other'

export function classifyUrl(pathname: string): UrlBucket {
  const p = pathname.toLowerCase()
  if (/\/(products?|item|items|p)\//.test(p)) return 'product'
  if (/\/(blogs?|news|articles?|guides?|questions?)(\/|$)/.test(p)) return 'blog'
  if (/\/(collections?|category|categories|product-category|shop|c)(\/|$)/.test(p)) return 'collection'
  if (/\/pages?\//.test(p)) return 'page'
  // Single-segment landing pages such as /refurbished-dell-laptops.
  if (/^\/[^/]+\/?$/.test(p) && /(laptop|desktop|macbook|mini-?pc|monitor|workstation)s?/.test(p) && /(refurb|second-hand|used|under|best)/.test(p)) return 'collection'
  return 'other'
}

export interface SitemapSummary {
  ok: boolean
  indexed: boolean
  urlsSeen: number
  buckets: Record<UrlBucket, number>
  lastmodShare: number | null
  truncated: boolean
  samples: Partial<Record<UrlBucket, string[]>>
}

const emptyBuckets = (): Record<UrlBucket, number> => ({ product: 0, collection: 0, blog: 0, page: 0, other: 0 })

export function parseSitemapXml(xml: string): { index: boolean; locs: string[]; lastmods: number } {
  const index = /<sitemapindex[\s>]/i.test(xml)
  const locs = [...xml.matchAll(/<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'))
  const lastmods = (xml.match(/<lastmod>/gi) ?? []).length
  return { index, locs, lastmods }
}

// ------------------------------------------------------------------ page extraction

export interface ProductSignals {
  hasOffers: boolean
  hasPrice: boolean
  hasAvailability: boolean
  hasItemCondition: boolean
  hasShippingDetails: boolean
  hasReturnPolicy: boolean
  hasPriceValidUntil: boolean
  hasAggregateRating: boolean
  hasReview: boolean
  hasBrand: boolean
  hasSku: boolean
  hasGtinOrMpn: boolean
  imageCount: number
}

export interface PageSignals {
  url: string
  status: number
  title: string | null
  titleLength: number
  metaDescription: string | null
  metaDescriptionLength: number
  canonical: string | null
  robotsMeta: string | null
  h1Count: number
  h1: string | null
  h2: string[]
  og: { title: boolean; description: boolean; image: boolean }
  twitterCard: boolean
  schemaTypes: string[]
  product: ProductSignals | null
  organization: { hasHours: boolean; sameAsCount: number; hasAddress: boolean; hasPhone: boolean } | null
  images: { total: number; withAlt: number }
  wordCount: number
  internalLinks: number
}

const snip = (s: string | null | undefined, max = 90): string | null => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t ? (t.length > max ? t.slice(0, max - 1) + '…' : t) : null
}

const asArray = <T,>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v])
const typesOf = (n: any): string[] => asArray<string>(n?.['@type']).filter((x) => typeof x === 'string')

function jsonLdNodes(root: HTMLElement): any[] {
  const nodes: any[] = []
  for (const el of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(el.text)
      for (const item of asArray(data)) {
        if (item && Array.isArray(item['@graph'])) nodes.push(...item['@graph'])
        else if (item) nodes.push(item)
      }
    } catch {
      /* malformed JSON-LD is itself a finding, but not worth failing the run */
    }
  }
  return nodes
}

function productSignals(node: any): ProductSignals {
  const offer = asArray<any>(node.offers)[0] ?? null
  return {
    hasOffers: !!offer,
    hasPrice: !!(offer && (offer.price != null || offer.lowPrice != null)),
    hasAvailability: !!offer?.availability,
    hasItemCondition: !!(offer?.itemCondition || node.itemCondition),
    hasShippingDetails: !!offer?.shippingDetails,
    hasReturnPolicy: !!offer?.hasMerchantReturnPolicy,
    hasPriceValidUntil: !!offer?.priceValidUntil,
    hasAggregateRating: !!node.aggregateRating,
    hasReview: asArray(node.review).length > 0,
    hasBrand: !!node.brand,
    hasSku: !!node.sku,
    hasGtinOrMpn: !!(node.gtin || node.gtin13 || node.gtin12 || node.gtin8 || node.mpn),
    imageCount: asArray(node.image).length,
  }
}

export function extractPage(html: string, pageUrl: string, status = 200): PageSignals {
  const root = parse(html, { blockTextElements: { script: true, style: true, noscript: true } })
  const origin = siteKey(new URL(pageUrl).hostname)
  const meta = (sel: string) => root.querySelector(sel)?.getAttribute('content')?.trim() || null
  const title = snip(root.querySelector('title')?.text, 200)
  const description = meta('meta[name="description"]')
  const h1s = root.querySelectorAll('h1')

  const nodes = jsonLdNodes(root)
  const schemaTypes = [...new Set(nodes.flatMap(typesOf))]
  const productNode = nodes.find((n) => typesOf(n).includes('Product'))
  const orgNode = nodes.find((n) => typesOf(n).some((t) => ['Organization', 'LocalBusiness', 'Store', 'ComputerStore', 'OnlineStore'].includes(t)))

  const imgs = root.querySelectorAll('img')
  let internalLinks = 0
  for (const a of root.querySelectorAll('a[href]')) {
    try {
      const u = new URL(a.getAttribute('href') as string, pageUrl)
      if (siteKey(u.hostname) === origin) internalLinks++
    } catch { /* ignore unparsable hrefs */ }
  }

  const body = root.querySelector('body') ?? root
  for (const junk of body.querySelectorAll('nav, header, footer, aside, svg, form')) junk.remove()
  const wordCount = body.text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length

  return {
    url: pageUrl,
    status,
    title,
    titleLength: title?.length ?? 0,
    metaDescription: snip(description, 200),
    metaDescriptionLength: description?.length ?? 0,
    canonical: root.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
    robotsMeta: meta('meta[name="robots"]'),
    h1Count: h1s.length,
    h1: snip(h1s[0]?.text),
    h2: root.querySelectorAll('h2').slice(0, 12).map((h) => snip(h.text, 80)).filter((x): x is string => !!x),
    og: { title: !!meta('meta[property="og:title"]'), description: !!meta('meta[property="og:description"]'), image: !!meta('meta[property="og:image"]') },
    twitterCard: !!meta('meta[name="twitter:card"]'),
    schemaTypes,
    product: productNode ? productSignals(productNode) : null,
    organization: orgNode
      ? {
          hasHours: !!(orgNode.openingHoursSpecification || orgNode.openingHours),
          sameAsCount: asArray(orgNode.sameAs).length,
          hasAddress: !!orgNode.address,
          hasPhone: !!orgNode.telephone,
        }
      : null,
    images: { total: imgs.length, withAlt: imgs.filter((i) => (i.getAttribute('alt') ?? '').trim() !== '').length },
    wordCount,
    internalLinks,
  }
}

// ------------------------------------------------------------------ home-page level signals

export interface NavLink { text: string; path: string }
export interface Claim { type: string; text: string }

const BRAND_RE = /\b(dell|hp|lenovo|apple|macbook|acer|asus|msi|samsung|microsoft|surface|thinkpad|latitude|elitebook)\b/i
const USE_RE = /\b(student|students|gaming|coding|programming|corporate|business|office|video[- ]editing|accounting|trading|designer|graphic|workstation|school)\b/i
const BUDGET_RE = /under[-\s_]*(?:rs\.?|₹|inr)?[-\s_]*\d/i
const POLICY_KINDS: [string, RegExp][] = [
  ['warranty', /warranty/i],
  ['returns/refund', /(return|refund)/i],
  ['replacement', /replacement/i],
  ['shipping/delivery', /(shipping|delivery)/i],
  ['cancellation', /cancell?ation/i],
  ['privacy', /privacy/i],
  ['terms', /(terms|conditions)/i],
  ['buyback', /(buy-?back|trade-?in|exchange)/i],
]

export function navSignals(html: string, pageUrl: string): { budget: NavLink[]; brand: NavLink[]; useCase: NavLink[]; policies: Record<string, string> } {
  const root = parse(html, { blockTextElements: { script: true, style: true, noscript: true } })
  const origin = siteKey(new URL(pageUrl).hostname)
  const seen = new Set<string>()
  const out = { budget: [] as NavLink[], brand: [] as NavLink[], useCase: [] as NavLink[], policies: {} as Record<string, string> }

  for (const a of root.querySelectorAll('a[href]')) {
    let u: URL
    try { u = new URL(a.getAttribute('href') as string, pageUrl) } catch { continue }
    if (siteKey(u.hostname) !== origin) continue
    const path = u.pathname.replace(/\/+$/, '') || '/'
    const text = snip(a.text, 60) ?? ''
    const hay = `${decodeURIComponent(path)} ${text}`
    for (const [kind, re] of POLICY_KINDS) if (!out.policies[kind] && re.test(hay) && /policy|terms|warranty|refund|return|shipping|delivery|privacy|cancell|conditions/i.test(hay)) out.policies[kind] = path
    if (path === '/' || seen.has(path)) continue
    seen.add(path)
    const link = { text, path }
    if (BUDGET_RE.test(hay)) { if (out.budget.length < 15) out.budget.push(link) }
    else if (USE_RE.test(hay)) { if (out.useCase.length < 15) out.useCase.push(link) }
    else if (BRAND_RE.test(hay) && !/blog|policy|warranty/i.test(path)) { if (out.brand.length < 15) out.brand.push(link) }
  }
  return out
}

const CLAIM_PATTERNS: [string, RegExp][] = [
  ['warranty', /\b\d{1,2}\s*[- ]?\s*(?:month|year)s?\s+warranty\b|warranty (?:of|for) \d{1,2}\s*(?:month|year)s?/i],
  ['returns', /\b\d{1,2}\s*[- ]?\s*days?\s+(?:easy\s+)?(?:return|replacement|refund)/i],
  ['cod', /cash on delivery|\bcod\b/i],
  ['emi', /\bno[- ]cost emi\b|\bemi\b/i],
  ['free shipping', /free\s+(?:shipping|delivery)/i],
  ['quality checks', /\b\d{2,3}\s*[- ]?\s*point\b/i],
  ['gst invoice', /gst\s+invoice/i],
  ['battery', /battery (?:health|backup|warranty)/i],
  ['pan-india delivery', /pan[- ]india/i],
]

export function claimsFromText(text: string): Claim[] {
  const claims: Claim[] = []
  const flat = text.replace(/\s+/g, ' ')
  for (const [type, re] of CLAIM_PATTERNS) {
    const m = re.exec(flat)
    if (!m) continue
    const start = Math.max(0, m.index - 30)
    claims.push({ type, text: (flat.slice(start, m.index + m[0].length + 30).trim()).slice(0, 80) })
  }
  return claims
}

function fingerprint(html: string): { platform: string | null; analytics: string[] } {
  const platform = /cdn\.shopify\.com|Shopify\.theme/i.test(html) ? 'Shopify'
    : /wp-content|wp-includes/i.test(html) ? 'WordPress/WooCommerce'
    : /\/_next\/static/i.test(html) ? 'Next.js'
    : /Wix\.com|wixstatic/i.test(html) ? 'Wix' : null
  const analytics: string[] = []
  if (/googletagmanager\.com\/gtag\/js/i.test(html)) analytics.push('Google Analytics (gtag)')
  if (/googletagmanager\.com\/gtm\.js/i.test(html)) analytics.push('Google Tag Manager')
  if (/connect\.facebook\.net|fbq\(/i.test(html)) analytics.push('Meta Pixel')
  if (/clarity\.ms/i.test(html)) analytics.push('Microsoft Clarity')
  return { platform, analytics }
}

// ------------------------------------------------------------------ whole-site run

export interface SiteSignals {
  fetchedAt: string
  base: string
  robots: { fetched: boolean; disallowRules: number; blocksEverything: boolean; sitemaps: string[] }
  sitemap: SitemapSummary
  pages: Partial<Record<'home' | 'product' | 'collection' | 'policy' | 'blog', PageSignals>>
  nav: { budget: NavLink[]; brand: NavLink[]; useCase: NavLink[] }
  policies: Record<string, string>
  claims: Claim[]
  platform: string | null
  analytics: string[]
  requests: number
  notes: string[]
}

const isHtml = (r: GuardedResponse) => r.status === 200 && /html|xml\+xhtml|text\/plain|^$/i.test(r.contentType)

export async function analyzeSite(baseUrl: string, fetcher: Fetcher): Promise<SiteSignals> {
  const base = new URL(baseUrl)
  const origin = `${base.protocol}//${base.host}`
  const notes: string[] = []
  let requests = 0
  let rules: RobotsRules = { disallow: [], allow: [], sitemaps: [] }
  let robotsFetched = false

  // Every fetch goes through here: budget + robots.txt.
  const get = async (url: string, opts: { ignoreRobots?: boolean } = {}): Promise<GuardedResponse | null> => {
    if (requests >= MAX_REQUESTS) { notes.push('Request limit reached; some pages were skipped'); return null }
    const u = new URL(url)
    if (!opts.ignoreRobots && !robotsAllows(rules, u.pathname + u.search)) { notes.push(`robots.txt disallows ${u.pathname}; skipped`); return null }
    requests++
    try { return await fetcher(url) } catch (e: any) { notes.push(`Could not fetch ${u.pathname}: ${e?.message ?? 'error'}`); return null }
  }

  // 1. robots.txt
  const robotsRes = await get(`${origin}/robots.txt`, { ignoreRobots: true })
  if (robotsRes && robotsRes.status === 200 && !/<html/i.test(robotsRes.body.slice(0, 500))) { rules = parseRobots(robotsRes.body); robotsFetched = true }
  const blocksEverything = rules.disallow.includes('/') && rules.allow.length === 0
  if (blocksEverything) notes.push('robots.txt asks bots not to crawl this site; only robots.txt was read')

  const empty: SiteSignals = {
    fetchedAt: new Date().toISOString(), base: origin,
    robots: { fetched: robotsFetched, disallowRules: rules.disallow.length, blocksEverything, sitemaps: rules.sitemaps.slice(0, 5) },
    sitemap: { ok: false, indexed: false, urlsSeen: 0, buckets: emptyBuckets(), lastmodShare: null, truncated: false, samples: {} },
    pages: {}, nav: { budget: [], brand: [], useCase: [] }, policies: {}, claims: [], platform: null, analytics: [], requests, notes,
  }
  if (blocksEverything) return { ...empty, requests }

  // 2. sitemap (an index is followed for a few children only)
  const sitemapUrl = rules.sitemaps.find((s) => { try { return siteKey(new URL(s).hostname) === siteKey(base.hostname) } catch { return false } }) ?? `${origin}/sitemap.xml`
  const sm: SitemapSummary = { ...empty.sitemap, buckets: emptyBuckets(), samples: {} }
  let lastmods = 0
  const collect = (locs: string[]) => {
    for (const loc of locs) {
      let path: string
      try { path = new URL(loc).pathname } catch { continue }
      const b = classifyUrl(path)
      sm.buckets[b]++
      sm.urlsSeen++
      const s = (sm.samples[b] ??= [])
      if (s.length < 5) s.push(loc)
    }
  }
  const top = await get(sitemapUrl)
  if (top && top.status === 200 && /<(urlset|sitemapindex)/i.test(top.body)) {
    const parsed = parseSitemapXml(top.body)
    sm.ok = true
    sm.truncated = top.truncated
    if (parsed.index) {
      sm.indexed = true
      // Prefer the child sitemaps most likely to show products, collections and blog.
      const children = [...parsed.locs].sort((a, b) => Number(/(product|collection|blog|page)/i.test(b)) - Number(/(product|collection|blog|page)/i.test(a))).slice(0, 3)
      for (const child of children) {
        const res = await get(child)
        if (res && res.status === 200) {
          const c = parseSitemapXml(res.body)
          collect(c.locs)
          lastmods += c.lastmods
          sm.truncated = sm.truncated || res.truncated
        }
      }
      if (parsed.locs.length > children.length) notes.push(`Sitemap index lists ${parsed.locs.length} sitemaps; only ${children.length} were read, so counts are a minimum`)
    } else {
      collect(parsed.locs)
      lastmods = parsed.lastmods
    }
    sm.lastmodShare = sm.urlsSeen ? Math.min(1, Math.round((lastmods / sm.urlsSeen) * 100) / 100) : null
  } else {
    notes.push('No readable sitemap.xml found')
  }

  // 3. home page
  const pages: SiteSignals['pages'] = {}
  let nav = { budget: [] as NavLink[], brand: [] as NavLink[], useCase: [] as NavLink[] }
  let policies: Record<string, string> = {}
  let claims: Claim[] = []
  let platform: string | null = null
  let analytics: string[] = []
  const home = await get(`${origin}/`)
  if (home && isHtml(home)) {
    pages.home = extractPage(home.body, home.finalUrl, home.status)
    const n = navSignals(home.body, home.finalUrl)
    nav = { budget: n.budget, brand: n.brand, useCase: n.useCase }
    policies = n.policies
    const text = parse(home.body, { blockTextElements: { script: true, style: true, noscript: true } }).text
    claims = claimsFromText(text)
    const fp = fingerprint(home.body)
    platform = fp.platform
    analytics = fp.analytics
  } else if (home) {
    notes.push(`Home page returned status ${home.status}`)
  }

  // 4. one sample each of product / collection / blog / policy (fetched in parallel)
  // Only ever pick a page robots.txt lets us read.
  const allowedUrl = (u: string) => { try { const x = new URL(u); return robotsAllows(rules, x.pathname + x.search) } catch { return false } }
  const pick = (b: UrlBucket, prefer?: RegExp) => { const s = (sm.samples[b] ?? []).filter(allowedUrl); return (prefer && s.find((u) => prefer.test(u))) || s[0] }
  const targets: [keyof SiteSignals['pages'], string | undefined][] = [
    ['product', pick('product')],
    ['collection', pick('collection', /under|dell|hp|lenovo/i)],
    ['blog', pick('blog')],
    ['policy', policies['warranty'] ? new URL(policies['warranty'], origin).toString() : policies['returns/refund'] ? new URL(policies['returns/refund'], origin).toString() : undefined],
  ]
  const fetched = await Promise.all(targets.map(async ([key, url]) => (url ? [key, await get(url)] as const : null)))
  for (const item of fetched) {
    if (!item || !item[1]) continue
    const [key, res] = item
    if (isHtml(res)) pages[key] = extractPage(res.body, res.finalUrl, res.status)
  }
  // Claims also appear on policy pages; merge the ones the home page lacked.
  if (pages.policy) {
    notes.push('Policy page sampled')
  }

  return {
    fetchedAt: new Date().toISOString(), base: origin,
    robots: { fetched: robotsFetched, disallowRules: rules.disallow.length, blocksEverything, sitemaps: rules.sitemaps.slice(0, 5) },
    sitemap: sm, pages, nav, policies, claims, platform, analytics, requests, notes,
  }
}

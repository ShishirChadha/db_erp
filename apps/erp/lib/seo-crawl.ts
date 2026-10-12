// Turns a Screaming Frog "Internal: All" export (plus, optionally, our own live
// sitemap) into a short list of fixable problems. Pure functions -- no database
// access -- so the rules can be tested directly. Thresholds are practical
// guidelines (search results truncate around 60-70 / 160 characters), not
// anything Google publishes as a ranking rule.

export interface CrawlPage {
  url: string
  status_code: number | null
  indexability: string | null
  title: string | null
  meta_description: string | null
  h1: string | null
  word_count: number | null
  inlinks: number | null
  response_time: number | null
  canonical: string | null
  redirect_url: string | null
}

export type Severity = 'error' | 'warning'

export interface CrawlIssue {
  code: string
  severity: Severity
  label: string
  hint: string
  count: number
  urls: string[]
}

const MAX_URLS = 25
const norm = (u: string) => u.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase()
const blank = (s: string | null | undefined) => !s || !s.trim()

export function deriveCrawlIssues(pages: CrawlPage[], sitemapUrls: string[] | null): { pages: number; issues: CrawlIssue[] } {
  const issues = new Map<string, CrawlIssue>()
  const add = (code: string, severity: Severity, label: string, hint: string, url: string) => {
    let i = issues.get(code)
    if (!i) issues.set(code, (i = { code, severity, label, hint, count: 0, urls: [] }))
    i.count++
    if (i.urls.length < MAX_URLS) i.urls.push(url)
  }

  const html200 = pages.filter((p) => p.status_code === 200)
  const indexable = html200.filter((p) => !p.indexability || /^indexable$/i.test(p.indexability.trim()))

  for (const p of pages) {
    const s = p.status_code ?? 0
    if (s >= 500) add('http_5xx', 'error', 'Server errors (5xx)', 'The page failed on the server. Check the website logs.', p.url)
    else if (s >= 400) add('http_4xx', 'error', 'Broken pages (4xx)', 'Find what links here and fix the link, or add a redirect in Website SEO → Redirects.', p.url)
    else if (s >= 300) add('redirecting', 'warning', 'Addresses that redirect', 'Links should point straight at the final page, not through a redirect.', p.url)
    if (s === 200 && p.canonical && norm(p.canonical) !== norm(p.url)) {
      add('canonical_elsewhere', 'warning', 'Canonical points to a different page', 'Intended for filtered or paginated pages; unexpected on a normal page.', p.url)
    }
    if (p.response_time != null && p.response_time > 1) add('slow', 'warning', 'Slow responses (over 1 second)', 'Check caching/rendering for these pages.', p.url)
  }

  for (const p of indexable) {
    if (blank(p.title)) add('title_missing', 'error', 'Missing page title', 'Every indexable page needs a unique title.', p.url)
    else if (p.title!.trim().length > 65) add('title_long', 'warning', 'Titles over 65 characters', 'Likely to be cut off in search results.', p.url)
    if (blank(p.h1)) add('h1_missing', 'error', 'Missing main heading (H1)', 'Every indexable page should have one H1.', p.url)
    if (blank(p.meta_description)) add('desc_missing', 'warning', 'Missing meta description', 'Add a description, or let the default template fill it.', p.url)
    else {
      const n = p.meta_description!.trim().length
      if (n > 160) add('desc_long', 'warning', 'Descriptions over 160 characters', 'Likely to be cut off in search results.', p.url)
      else if (n < 70) add('desc_short', 'warning', 'Descriptions under 70 characters', 'Too short to be useful as a search snippet.', p.url)
    }
    if (p.word_count != null && p.word_count < 150) add('thin', 'warning', 'Thin pages (under 150 words)', 'Little original text. Fine for a product listing, a risk for a collection or guide.', p.url)
  }

  // duplicates among indexable pages
  for (const [field, code, label] of [['title', 'title_duplicate', 'Duplicate page titles'], ['meta_description', 'desc_duplicate', 'Duplicate meta descriptions']] as const) {
    const groups = new Map<string, CrawlPage[]>()
    for (const p of indexable) {
      const v = (p[field] ?? '').trim().toLowerCase()
      if (v) groups.set(v, [...(groups.get(v) ?? []), p])
    }
    for (const g of groups.values()) if (g.length > 1) for (const p of g) add(code, 'warning', label, 'Give each page its own wording (Website SEO → Page metadata).', p.url)
  }

  if (sitemapUrls) {
    const crawled = new Map(pages.map((p) => [norm(p.url), p]))
    const inMap = new Set(sitemapUrls.map(norm))
    for (const u of sitemapUrls) {
      const p = crawled.get(norm(u))
      if (!p) add('sitemap_not_crawled', 'warning', 'In the sitemap but not found by the crawl', 'No page links to it (orphan) or the crawl was limited.', u)
      else if (p.status_code !== 200) add('sitemap_bad_status', 'error', 'In the sitemap but not returning 200', 'Remove it from the sitemap or fix the page.', u)
      else if (p.indexability && !/^indexable$/i.test(p.indexability.trim())) add('sitemap_noindex', 'error', 'In the sitemap but not indexable', 'A page should be either in the sitemap and indexable, or in neither.', u)
      else if ((p.inlinks ?? 0) === 0) add('orphan', 'warning', 'Orphan pages (nothing links to them)', 'Link to it from a category, collection or guide.', u)
    }
    for (const p of indexable) {
      if (!inMap.has(norm(p.url)) && !/[?&]/.test(p.url)) add('indexable_not_in_sitemap', 'warning', 'Indexable pages missing from the sitemap', 'Intentional for some pages; otherwise add them.', p.url)
    }
  }

  const order = { error: 0, warning: 1 } as const
  return { pages: pages.length, issues: [...issues.values()].sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count) }
}

// Screaming Frog headers -> our columns, matched loosely so a renamed or
// reordered export still imports.
const HEADER_MAP: Record<keyof CrawlPage, string[]> = {
  url: ['address', 'url'],
  status_code: ['status code', 'status'],
  indexability: ['indexability'],
  title: ['title 1', 'title'],
  meta_description: ['meta description 1', 'meta description'],
  h1: ['h1-1', 'h1'],
  word_count: ['word count'],
  inlinks: ['inlinks', 'unique inlinks'],
  response_time: ['response time'],
  canonical: ['canonical link element 1', 'canonical'],
  redirect_url: ['redirect url', 'redirect uri'],
}

export function mapCrawlRow(raw: Record<string, unknown>): CrawlPage | null {
  const byLower = new Map(Object.entries(raw).map(([k, v]) => [k.trim().toLowerCase(), v]))
  const pick = (field: keyof CrawlPage) => {
    for (const h of HEADER_MAP[field]) if (byLower.has(h)) return byLower.get(h)
    return undefined
  }
  const text = (v: unknown) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim())
  const num = (v: unknown) => {
    const n = Number(String(v ?? '').replace(/,/g, ''))
    return v === undefined || v === null || String(v).trim() === '' || !Number.isFinite(n) ? null : n
  }
  const url = text(pick('url'))
  if (!url || !/^https?:\/\//i.test(url)) return null
  return {
    url,
    status_code: num(pick('status_code')),
    indexability: text(pick('indexability')),
    title: text(pick('title')),
    meta_description: text(pick('meta_description')),
    h1: text(pick('h1')),
    word_count: num(pick('word_count')),
    inlinks: num(pick('inlinks')),
    response_time: num(pick('response_time')),
    canonical: text(pick('canonical')),
    redirect_url: text(pick('redirect_url')),
  }
}

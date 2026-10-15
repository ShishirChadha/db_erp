import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { guardedFetch } from '@/lib/net-guard'
import { deriveCrawlIssues, type CrawlPage } from '@/lib/seo-crawl'
import { loadCollectionsWithState } from '@/lib/seo-collections-state'
import { loadCompetitorsWithIdeas } from '@/lib/seo-competitors-state'
import { buildSuggestions, GA_ID_PATTERN, type Facts, type SuggestionState } from '@/lib/seo-suggestions'
import { stripPlaceholderSegments } from '@db/shared'

// Live read of everything the suggestion rules need, then the pure engine in
// lib/seo-suggestions.ts decides what to show. Nothing is cached or stored except
// the owner's done / snooze / dismiss choices (seo_suggestion_state).
export const maxDuration = 30

const STOREFRONT = (process.env.NEXT_PUBLIC_STOREFRONT_URL || 'https://www.digitalbluez.com').replace(/\/+$/, '')
const BANDS = [15000, 20000, 25000, 30000, 40000, 50000]

async function googleFacts(): Promise<Facts['google'] & { serviceAccountEmail: string | null; expectedMeasurementId: string | null; gscSiteUrl: string | null; propertyIdSet: boolean }> {
  const env = {
    gscConfigured: !!(process.env.GSC_SITE_URL && process.env.GA4_CLIENT_EMAIL && process.env.GA4_PRIVATE_KEY),
    ga4Configured: !!(process.env.GA4_PROPERTY_ID && process.env.GA4_CLIENT_EMAIL && process.env.GA4_PRIVATE_KEY),
    serviceAccountEmail: process.env.GA4_CLIENT_EMAIL || null,
    expectedMeasurementId: process.env.WEB_GA_MEASUREMENT_ID || null,
    gscSiteUrl: process.env.GSC_SITE_URL || null,
    propertyIdSet: !!process.env.GA4_PROPERTY_ID,
  }
  let homepageFetched = false, gaIdOnSite: string | null = null, verificationMetaFound = false, sitemapOk = false
  try {
    const home = await guardedFetch(`${STOREFRONT}/`, { timeoutMs: 8000 })
    if (home.status === 200) {
      homepageFetched = true
      gaIdOnSite = home.body.match(/googletagmanager\.com\/gtag\/js\?id=([A-Za-z0-9-]+)/)?.[1] ?? null
      verificationMetaFound = /<meta[^>]+name=["']google-site-verification["']/i.test(home.body)
    }
  } catch { /* reported as "could not be checked" */ }
  try {
    const sm = await guardedFetch(`${STOREFRONT}/sitemap.xml`, { timeoutMs: 8000 })
    sitemapOk = sm.status === 200 && /<urlset|<sitemapindex/i.test(sm.body)
  } catch { /* sitemapOk stays false */ }
  return { homepageFetched, gaIdOnSite, gaIdLooksValid: !!gaIdOnSite && GA_ID_PATTERN.test(gaIdOnSite), verificationMetaFound, sitemapOk, ...env }
}

export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const now = new Date()
  const head = { count: 'exact' as const, head: true }
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString()

  const [google, products, collections, noDesc, noAlt, notFound, redirects, crawlImport, keywords, arrivals, competitors, stateRows] = await Promise.all([
    googleFacts(),
    supabaseAdmin.from('public_products').select('brand, web_price, availability_bucket').in('category', ['LAP', 'DES']).range(0, 999),
    loadCollectionsWithState().catch(() => []),
    supabaseAdmin.from('sku_master').select('id', head).eq('is_published', true).or('web_description.is.null,web_description.eq.'),
    supabaseAdmin.from('product_images').select('id, sku_master!inner(is_published)', head).eq('sku_master.is_published', true).or('alt_text.is.null,alt_text.eq.'),
    supabaseAdmin.from('seo_404_log').select('path, hits').order('hits', { ascending: false }).limit(30),
    supabaseAdmin.from('seo_redirects').select('from_path').range(0, 4999),
    supabaseAdmin.from('seo_crawl_imports').select('id, created_at').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('seo_keywords').select('keyword, cluster, target_url, avg_position, impressions, clicks').range(0, 4999),
    supabaseAdmin.from('public_products').select('web_title, brand, model_name').in('category', ['LAP', 'DES']).neq('availability_bucket', 'sold_out').gte('published_at', weekAgo).limit(5),
    loadCompetitorsWithIdeas().catch(() => []),
    supabaseAdmin.from('seo_suggestion_state').select('*'),
  ])

  // stock by brand / price band (available units only)
  const available = (products.data ?? []).filter((p: any) => p.availability_bucket !== 'sold_out')
  const brandCount = new Map<string, number>()
  for (const p of available as any[]) if (p.brand) brandCount.set(p.brand, (brandCount.get(p.brand) ?? 0) + 1)

  // crawl errors from the latest import (no sitemap compare here; that lives on the Crawl screen)
  let crawl: Facts['crawl'] = null
  if (crawlImport.data) {
    const { data: pages } = await supabaseAdmin
      .from('seo_crawl_pages')
      .select('url, status_code, indexability, title, meta_description, h1, word_count, inlinks, response_time, canonical, redirect_url')
      .eq('import_id', crawlImport.data.id)
      .range(0, 4999)
    const { issues } = deriveCrawlIssues((pages ?? []) as CrawlPage[], null)
    crawl = {
      importedAt: crawlImport.data.created_at,
      errors: issues.filter((i) => i.severity === 'error').reduce((n, i) => n + i.count, 0),
      warnings: issues.filter((i) => i.severity === 'warning').reduce((n, i) => n + i.count, 0),
    }
  }

  // keywords
  const kws = keywords.data ?? []
  const byCluster = new Map<string, Set<string>>()
  for (const k of kws) if (k.cluster && k.target_url) byCluster.set(k.cluster, (byCluster.get(k.cluster) ?? new Set()).add(k.target_url))
  const withMetrics = kws.filter((k) => k.avg_position != null && (k.impressions ?? 0) >= 100)

  const redirectSet = new Set((redirects.data ?? []).map((r) => r.from_path))
  const facts: Facts = {
    google,
    stockByBrand: [...brandCount.entries()].map(([brand, n]) => ({ brand, available: n })),
    priceBands: BANDS.map((max) => ({ max, available: (available as any[]).filter((p) => Number(p.web_price) <= max).length })),
    collections: collections.map((c: any) => ({
      slug: c.slug,
      name: c.name,
      status: c.status,
      indexable: c.indexable,
      reason: [!c.gate.published && 'it is a draft', !c.gate.enough_products && `only ${c.available} available (needs ${c.min_products})`, !c.gate.enough_text && `intro has ${c.intro_words} words (needs ${c.min_intro_words})`].filter(Boolean).join(', '),
      brands: Array.isArray(c.filter?.brand) ? c.filter.brand : [],
      maxPrice: typeof c.filter?.maxPrice === 'number' ? c.filter.maxPrice : null,
    })),
    publishedWithoutDescription: noDesc.count ?? 0,
    imagesWithoutAlt: noAlt.count ?? 0,
    notFound: (notFound.data ?? []).map((n) => ({ path: n.path, hits: n.hits, hasRedirect: redirectSet.has(n.path) })),
    crawl,
    keywords: {
      total: kws.length,
      withoutTarget: kws.filter((k) => !k.target_url).length,
      clusterConflicts: [...byCluster.entries()].filter(([, urls]) => urls.size > 1).map(([c]) => c),
      striking: withMetrics
        .filter((k) => Number(k.avg_position) >= 8 && Number(k.avg_position) <= 20 && k.target_url)
        .map((k) => ({ keyword: k.keyword, position: Number(k.avg_position), impressions: k.impressions ?? 0, target: k.target_url as string })),
      lowCtr: withMetrics
        .filter((k) => Number(k.avg_position) <= 5 && (k.clicks ?? 0) / Math.max(1, k.impressions ?? 1) < 0.02)
        .map((k) => ({ keyword: k.keyword, position: Number(k.avg_position), ctrPct: ((k.clicks ?? 0) / Math.max(1, k.impressions ?? 1)) * 100 })),
    },
    newArrivals: (arrivals.data ?? []).map((a) => (a.web_title ? stripPlaceholderSegments(a.web_title) : [a.brand, a.model_name].filter(Boolean).join(' ')).trim()).filter(Boolean),
    competitorIdeas: competitors.filter((c) => !c.is_self).flatMap((c) => c.ideas.map((idea) => ({ site: c.label, idea }))),
  }

  const state: Record<string, SuggestionState> = {}
  for (const s of stateRows.data ?? []) state[s.key] = s as SuggestionState
  const { active, hidden } = buildSuggestions(facts, state, now)

  return NextResponse.json({ generated_at: now.toISOString(), suggestions: active, hidden, google })
}

// Mark a suggestion done, snooze it, dismiss it, or bring it back.
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { key, action, days } = (await req.json()) as { key?: string; action?: string; days?: number }
  if (!key || key.length > 160 || !/^[\w:.\-/ ()&+,'₹%]+$/.test(key)) return NextResponse.json({ error: 'Invalid suggestion' }, { status: 400 })
  const now = new Date()

  if (action === 'reopen') {
    await supabaseAdmin.from('seo_suggestion_state').delete().eq('key', key)
    return NextResponse.json({ success: true })
  }
  const row: Record<string, unknown> = { key, updated_at: now.toISOString(), updated_by: sessionUser.id, snoozed_until: null, done_at: null }
  if (action === 'done') { row.status = 'done'; row.done_at = now.toISOString() }
  else if (action === 'dismiss') row.status = 'dismissed'
  else if (action === 'snooze') {
    const n = Number(days ?? 7)
    if (!Number.isInteger(n) || n < 1 || n > 90) return NextResponse.json({ error: 'Snooze for 1 to 90 days' }, { status: 400 })
    row.status = 'snoozed'
    row.snoozed_until = new Date(now.getTime() + n * 86400000).toISOString()
  } else return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  const { error } = await supabaseAdmin.from('seo_suggestion_state').upsert(row, { onConflict: 'key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { deriveCrawlIssues, mapCrawlRow, type CrawlPage } from '@/lib/seo-crawl'

const KEEP_IMPORTS = 3

// POST { filename, rows } -- rows are the parsed rows of a Screaming Frog
// "Internal: All" CSV export. Only HTML pages are kept (images/CSS/JS are noise).
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const b = (await req.json()) as { filename?: string; rows?: Record<string, unknown>[] }
  if (!Array.isArray(b.rows) || b.rows.length === 0 || b.rows.length > 5000) {
    return NextResponse.json({ error: 'Upload an export with between 1 and 5000 rows' }, { status: 400 })
  }

  const pages: CrawlPage[] = []
  for (const raw of b.rows) {
    const ct = Object.entries(raw).find(([k]) => k.trim().toLowerCase() === 'content type')?.[1]
    if (typeof ct === 'string' && ct.trim() && !/html/i.test(ct)) continue
    const page = mapCrawlRow(raw)
    if (page) pages.push(page)
  }
  if (pages.length === 0) {
    return NextResponse.json({ error: 'No page rows found. Export "Internal" → "All" from Screaming Frog (it must include the Address column).' }, { status: 400 })
  }

  const { data: imp, error } = await supabaseAdmin
    .from('seo_crawl_imports')
    .insert({ filename: (b.filename ?? '').slice(0, 200) || null, row_count: pages.length, created_by: sessionUser.id })
    .select()
    .single()
  if (error || !imp) return NextResponse.json({ error: error?.message ?? 'Failed to save import' }, { status: 500 })

  for (let i = 0; i < pages.length; i += 500) {
    const { error: pErr } = await supabaseAdmin.from('seo_crawl_pages').insert(pages.slice(i, i + 500).map((p) => ({ ...p, import_id: imp.id })))
    if (pErr) {
      await supabaseAdmin.from('seo_crawl_imports').delete().eq('id', imp.id) // cascades to its pages
      return NextResponse.json({ error: pErr.message }, { status: 500 })
    }
  }

  // Keep only the newest few imports so this never grows without bound.
  const { data: all } = await supabaseAdmin.from('seo_crawl_imports').select('id').order('created_at', { ascending: false })
  const old = (all ?? []).slice(KEEP_IMPORTS).map((r) => r.id)
  if (old.length) await supabaseAdmin.from('seo_crawl_imports').delete().in('id', old)

  await logAuditEvent({
    actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
    actionType: 'create',
    module: 'settings',
    tableName: 'seo_crawl_imports',
    recordId: imp.id,
    recordLabel: `Crawl import (${pages.length} pages)`,
  })
  return NextResponse.json({ id: imp.id, pages: pages.length })
}

// Latest import + the problems derived from it (and from the live sitemap).
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { data: imp } = await supabaseAdmin.from('seo_crawl_imports').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!imp) return NextResponse.json({ import: null, issues: [] })

  const { data: pages, error } = await supabaseAdmin
    .from('seo_crawl_pages')
    .select('url, status_code, indexability, title, meta_description, h1, word_count, inlinks, response_time, canonical, redirect_url')
    .eq('import_id', imp.id)
    .range(0, 4999)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // The sitemap comparison uses what the live site serves right now. If it can't
  // be fetched we say so rather than silently skipping those checks.
  let sitemapUrls: string[] | null = null
  const base = (process.env.NEXT_PUBLIC_STOREFRONT_URL || 'https://www.digitalbluez.com').replace(/\/+$/, '')
  try {
    const res = await fetch(`${base}/sitemap.xml`, { signal: AbortSignal.timeout(8000), cache: 'no-store' })
    if (res.ok) sitemapUrls = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())
  } catch {
    /* reported below via sitemap_checked */
  }

  const result = deriveCrawlIssues((pages ?? []) as CrawlPage[], sitemapUrls)
  return NextResponse.json({ import: imp, ...result, sitemap_checked: sitemapUrls !== null, sitemap_source: `${base}/sitemap.xml` })
}

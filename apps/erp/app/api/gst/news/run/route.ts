// Fetches the configured official GST sources, has Claude pick out genuine GST changes and say
// what (if anything) the ERP/owner must do, and stores the new ones. Called daily by pg_cron
// (x-cron-secret, see dispatch_gst_news()) or on demand by the owner ("Check now").
//
// Safeguards: the model may only cite URLs that literally appear in the fetched page; every item
// is flagged as an AI summary in the UI; a source that returns no readable text is recorded as
// "empty" rather than silently looking quiet.
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, isOwner } from '@/lib/auth/session'
import { generateStructured } from '@/lib/ai/structured'
import { notify } from '@/lib/notifications'
import { probeDocument } from '@/lib/recon/pdf-text'

export const maxDuration = 120

const ItemsSchema = z.object({
  items: z.array(z.object({
    title: z.string(),
    url: z.string(),
    published_on: z.string().nullable(),
    summary: z.string(),
    impact: z.enum(['action_required', 'review', 'info']),
    erp_area: z.enum(['invoicing', 'hsn', 'e_invoice', 'e_way_bill', 'returns_gstr1', 'returns_gstr3b', 'itc', 'rates', 'rentals', 'repairs', 'portal', 'other']),
    suggested_action: z.string().nullable(),
    effective_date: z.string().nullable(),
  })).max(25),
})

const EnrichSchema = z.object({
  relevant: z.boolean(),
  summary: z.string(),
  impact: z.enum(['action_required', 'review', 'info']),
  erp_area: z.enum(['invoicing', 'hsn', 'e_invoice', 'e_way_bill', 'returns_gstr1', 'returns_gstr3b', 'itc', 'rates', 'rentals', 'repairs', 'portal', 'other']),
  suggested_action: z.string().nullable(),
  effective_date: z.string().nullable(),
})

const ENRICH_RULES = `
You are now given the FULL TEXT of ONE official document. Write what it changes for this business in at most 3 sentences, naming the concrete provisions (rule / section / form numbers, thresholds, dates).
- Say clearly whether it is a Council RECOMMENDATION (not law until notified) or a NOTIFIED / in-force change; never present a recommendation as already effective.
- relevant=false if nothing in it affects a regular-scheme taxpayer that sells, rents or repairs computers; then keep the summary to one short sentence.
- effective_date only if the document states one explicitly, as YYYY-MM-DD; otherwise null.`

const SYSTEM = `You monitor official Indian GST sources for a small business and report ONLY genuine GST law / rate / rule / form / deadline / portal changes.

The business: Digitalbluez, GST-registered in Uttar Pradesh (regular monthly filer, files GSTR-1 by the 11th and GSTR-3B by the 20th). It sells refurbished laptops, desktops, monitors, tablets and accessories (HSN 8471 and related), also rents out laptops (SAC 997315) and does computer repair (SAC 998713). Invoices are issued in Zoho Books; an in-house ERP does the reconciliation and prepares the returns.

Rules:
- Ignore menus, generic pages, FAQs, user manuals and anything that is not a dated update or notification.
- Include an item only if it plausibly matters to a regular-scheme taxpayer like this business. SKIP items that only concern tax officers' internal procedures (appeals handling, registration-processing instructions to officers, audit/recovery procedure), or taxpayer classes that do not apply (composition, exporters/SEZ, ISD, TDS/TCS deductors, casual or non-resident taxpayers, online-gaming, insurance, banking) unless the change also touches regular taxpayers.
- A consolidated "clarification" circular is worth listing only if it plausibly touches computers/electronics, rental or leasing of equipment, repair/maintenance services, e-commerce, invoicing, e-way bills, returns, ITC or due dates.
- Use ONLY urls that appear in the page text inside [square brackets]. Never invent or alter a URL.
- impact = "action_required" only if the ERP or the owner's process must change (rate change on our goods or services, new/changed return table or form, HSN digit or e-invoice/e-way-bill threshold change, changed due date or late fee, new portal rule affecting our invoices or ITC). "review" = may affect us, worth reading. "info" = everything else.
- suggested_action: one concrete sentence for what to do in the ERP or in the filing process, or null if nothing.
- Dates as YYYY-MM-DD, or null when not stated. Do not guess.
- Be factual and brief in summary (max 2 sentences). Do not add legal advice.`

function htmlToDigest(html: string, base: string): { text: string; links: Set<string> } {
  const links = new Set<string>()
  const decode = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  let h = html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
  h = h.replace(/<a\s+[^>]*?href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
    let abs: string
    try { abs = new URL(decode(href), base).href } catch { return ' ' }
    if (!/^https?:/.test(abs)) return ' '
    links.add(abs)
    const label = decode(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    return ` ${label} [${abs}] `
  })
  const text = decode(h.replace(/<[^>]+>/g, ' ')).replace(/[ \t\r\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\s{2,}/g, ' ').trim()
  return { text: text.slice(0, 40000), links }
}

// Reads a linked PDF and returns its text layer (or null for scans / oversized / unreadable files).
async function fetchPdfText(url: string): Promise<string | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30000)
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DigitalbluezERP-GSTNews/1.0)' } })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength > 12 * 1024 * 1024) return null
    const probe = await probeDocument(buf)
    if (probe.likelyScanned) return null
    return probe.text.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').slice(0, 45000)
  } catch { return null } finally { clearTimeout(timer) }
}

async function fetchPage(url: string): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 25000)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal, redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DigitalbluezERP-GSTNews/1.0)', Accept: 'text/html,application/xhtml+xml' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally { clearTimeout(timer) }
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (secret) {
    const { data: cfg } = await supabaseAdmin.from('gst_news_config').select('dispatch_secret').eq('id', true).maybeSingle()
    const expected = cfg?.dispatch_secret ?? ''
    const a = Buffer.from(secret), b = Buffer.from(expected)
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else {
    const sessionUser = await getSessionUser(req)
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isOwner(sessionUser)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { data: sources } = await supabaseAdmin.from('gst_news_sources').select('*').eq('active', true)
  const report: { source: string; status: string; found: number; added: number; error?: string }[] = []
  const urgent: { title: string; action: string | null }[] = []

  // Sources are independent, so run them side by side: sequentially, a few slow pages would
  // approach the function time limit.
  await Promise.all((sources ?? []).map(async (src: any) => {
    let status = 'ok', error: string | null = null, found = 0, added = 0
    try {
      const html = await fetchPage(src.url)
      const { text, links } = htmlToDigest(html, src.url)
      if (text.length < 500 || links.size < 3) {
        status = 'empty'
        error = 'The page returned almost no readable text (likely rendered by JavaScript, or blocked). Nothing was checked.'
      } else {
        const { data } = await generateStructured({
          toolName: 'report_gst_updates',
          toolDescription: 'Report the genuine GST updates found on this page.',
          schema: ItemsSchema,
          system: SYSTEM,
          content: `Source: ${src.name} (${src.url})\nToday: ${new Date().toISOString().slice(0, 10)}\n\nPage text:\n${text}`,
        })
        const valid = data.items.filter((i) => links.has(i.url))
        found = valid.length
        if (valid.length) {
          const { data: existing } = await supabaseAdmin.from('gst_news_items').select('url').in('url', valid.map((i) => i.url))
          const have = new Set((existing ?? []).map((e: any) => e.url))
          // The first successful read of a source is a baseline of what was already on the page,
          // not news: file it as seen so only what appears AFTER we started watching is "new".
          const { count: prior } = await supabaseAdmin.from('gst_news_items').select('id', { count: 'exact', head: true }).eq('source_id', src.id)
          const baseline = (prior ?? 0) === 0
          const cutoff = Date.now() - 90 * 86400000
          const fresh = valid.filter((i) => !have.has(i.url)).map((i) => ({
            source_id: src.id, url: i.url, title: i.title.slice(0, 300), published_on: /^\d{4}-\d{2}-\d{2}$/.test(i.published_on ?? '') ? i.published_on : null,
            summary: i.summary, impact: i.impact, erp_area: i.erp_area, suggested_action: i.suggested_action,
            effective_date: /^\d{4}-\d{2}-\d{2}$/.test(i.effective_date ?? '') ? i.effective_date : null,
            // Old items found on the first run are history, not news.
            status: baseline || (i.published_on && new Date(i.published_on).getTime() < cutoff) ? 'seen' : 'new',
          }))
          if (fresh.length) {
            const { error: insErr } = await supabaseAdmin.from('gst_news_items').upsert(fresh, { onConflict: 'url', ignoreDuplicates: true })
            if (insErr) throw new Error(insErr.message)
            added = fresh.length
            for (const f of fresh) if (f.impact === 'action_required' && f.status === 'new') urgent.push({ title: f.title, action: f.suggested_action })
          }
        }
      }
    } catch (e: any) {
      status = 'error'
      error = e?.name === 'AbortError' ? 'Timed out fetching the page.' : (e?.message || 'Failed')
    }
    await supabaseAdmin.from('gst_news_sources')
      .update({ last_run_at: new Date().toISOString(), last_status: status, last_error: error }).eq('id', src.id)
    report.push({ source: src.name, status, found, added, ...(error ? { error } : {}) })
  }))

  // Second pass: read each recent linked PDF and replace the index-page guess with a specific
  // summary. Capped per run; anything left over is picked up the next day (enriched_at stays null).
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const { data: toEnrich } = await supabaseAdmin
    .from('gst_news_items').select('id, url, title, status, published_on')
    .is('enriched_at', null).ilike('url', '%.pdf')
    .or(`status.eq.new,published_on.gte.${since}`)
    .order('published_on', { ascending: false, nullsFirst: false }).limit(8)
  let enriched = 0
  await Promise.all((toEnrich ?? []).map(async (it: any) => {
    try {
      const text = await fetchPdfText(it.url)
      if (!text || text.length < 400) {
        await supabaseAdmin.from('gst_news_items').update({ enriched_at: new Date().toISOString() }).eq('id', it.id)
        return
      }
      const { data } = await generateStructured({
        toolName: 'report_document_impact',
        toolDescription: 'Report what this document changes for the business.',
        schema: EnrichSchema, system: SYSTEM + ENRICH_RULES, maxTokens: 1024,
        content: `Document title: ${it.title}\n\nFull text:\n${text}`,
      })
      const ok = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null)
      const patch: Record<string, any> = {
        summary: data.summary, impact: data.relevant ? data.impact : 'info', erp_area: data.erp_area,
        suggested_action: data.relevant ? data.suggested_action : null, effective_date: ok(data.effective_date),
        enriched_at: new Date().toISOString(),
      }
      if (!data.relevant && it.status === 'new') patch.status = 'seen'
      await supabaseAdmin.from('gst_news_items').update(patch).eq('id', it.id)
      enriched++
      if (data.relevant && data.impact === 'action_required' && it.status === 'new') urgent.push({ title: it.title, action: data.suggested_action })
    } catch { /* leave enriched_at null so tomorrow's run retries */ }
  }))

  if (urgent.length) {
    const { data: owners } = await supabaseAdmin.from('profiles').select('id').eq('role', 'owner').eq('is_active', true)
    for (const o of owners ?? []) {
      await notify({
        recipientId: o.id, type: 'gst_news', actorId: null, link: '/dashboard/gst',
        title: urgent.length === 1 ? `GST update: ${urgent[0].title}` : `${urgent.length} GST updates need your attention`,
        body: urgent.map((u) => `${u.title}${u.action ? ` — ${u.action}` : ''}`).join('\n'),
      })
    }
  }
  return NextResponse.json({ sources: report, enriched })
}

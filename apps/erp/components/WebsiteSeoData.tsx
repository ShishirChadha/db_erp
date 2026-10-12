'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Papa from 'papaparse'
import { apiFetch } from '@/lib/api-client'

// Keywords + Crawl & 404s tabs of Settings -> Website SEO. Split from
// WebsiteSeoManager only to keep each file readable.

const inputCls = 'border p-2 rounded w-full text-sm bg-background'
const btnPrimary = 'bg-primary text-primary-foreground px-4 py-2 rounded text-sm disabled:opacity-50'
const btnGhost = 'border px-3 py-2 rounded text-sm hover:bg-muted disabled:opacity-50'

const errorOf = (res: Response, fallback: string) => res.json().then((j) => j.error || fallback).catch(() => fallback)

// ---------------------------------------------------------------- Keywords

interface Keyword {
  id: string
  keyword: string
  cluster: string | null
  intent: string | null
  geo: string | null
  target_url: string | null
  priority: number | null
  volume: number | null
  volume_source: string | null
  clicks: number | null
  impressions: number | null
  avg_position: number | null
  metrics_source: string | null
  metrics_as_of: string | null
  notes: string | null
}

const INTENTS = ['informational', 'commercial', 'transactional', 'navigational', 'local']
const emptyKw = { id: '', keyword: '', cluster: '', intent: '', geo: '', target_url: '', priority: '', notes: '' }

// Column names the usual exports use, matched loosely.
const KEYWORD_COLS = ['keyword', 'top queries', 'query', 'queries', 'search term', 'search query']
const VOLUME_COLS = ['avg. monthly searches', 'avg monthly searches', 'monthly searches', 'volume', 'search volume']

function pickCol(row: Record<string, any>, names: string[]) {
  const lower = new Map(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]))
  for (const n of names) if (lower.has(n)) return lower.get(n)
  return undefined
}

export function KeywordsSection() {
  const [rows, setRows] = useState<Keyword[]>([])
  const [cannibal, setCannibal] = useState<{ cluster: string; urls: string[] }[]>([])
  const [form, setForm] = useState(emptyKw)
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [source, setSource] = useState('gsc')
  const [sourceLabel, setSourceLabel] = useState('')
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10))
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const res = await apiFetch('/api/website-seo/keywords')
    if (res.ok) { const d = await res.json(); setRows(d.keywords); setCannibal(d.cannibalisation) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const save = async () => {
    setError(''); setMessage(''); setBusy(true)
    const res = await apiFetch('/api/website-seo/keywords', { method: 'PUT', body: JSON.stringify({ ...form, id: form.id || undefined, priority: form.priority ? Number(form.priority) : null }) })
    if (res.ok) { setForm(emptyKw); await load() } else setError(await errorOf(res, 'Failed to save'))
    setBusy(false)
  }

  const remove = async (k: Keyword) => {
    if (!confirm(`Remove "${k.keyword}"?`)) return
    await apiFetch(`/api/website-seo/keywords?id=${k.id}`, { method: 'DELETE' })
    await load()
  }

  const importFile = (file: File) => {
    setError(''); setMessage('')
    Papa.parse<Record<string, any>>(file, {
      header: true, skipEmptyLines: true,
      complete: async (result) => {
        // Keyword Planner exports begin with a few title lines; if the header row
        // wasn't found, say so instead of importing nonsense.
        const parsed = result.data.map((r) => ({
          keyword: pickCol(r, KEYWORD_COLS),
          volume: pickCol(r, VOLUME_COLS),
          clicks: pickCol(r, ['clicks']),
          impressions: pickCol(r, ['impressions']),
          position: pickCol(r, ['position', 'avg. position', 'average position']),
        })).filter((r) => r.keyword)
        if (parsed.length === 0) { setError('No keyword column found. Expected a header such as "Keyword" or "Top queries". For Keyword Planner, delete the lines above the header row first.'); return }
        setBusy(true)
        const res = await apiFetch('/api/website-seo/keywords', { method: 'POST', body: JSON.stringify({ source, source_label: sourceLabel, as_of: asOf, rows: parsed }) })
        if (res.ok) { const d = await res.json(); setMessage(`Imported: ${d.inserted} new, ${d.updated} updated, ${d.skipped} skipped.`); await load() }
        else setError(await errorOf(res, 'Import failed'))
        setBusy(false)
        if (fileRef.current) fileRef.current.value = ''
      },
      error: () => setError('Could not read that file'),
    })
  }

  const exportCsv = () => {
    const csv = Papa.unparse(rows.map((k) => ({
      keyword: k.keyword, cluster: k.cluster, intent: k.intent, geo: k.geo, target_url: k.target_url, priority: k.priority,
      volume: k.volume, volume_source: k.volume_source, clicks: k.clicks, impressions: k.impressions, avg_position: k.avg_position, metrics_source: k.metrics_source, metrics_as_of: k.metrics_as_of, notes: k.notes,
    })))
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `keywords-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  const shown = rows.filter((k) => !filter || `${k.keyword} ${k.cluster ?? ''} ${k.target_url ?? ''}`.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        Map each search phrase to the one page that should rank for it. Numbers appear here <b>only</b> when they come from a file you
        import (with the tool named) — nothing is estimated. Get the files from Search Console (Performance → Queries → Export),
        Google Keyword Planner (Download keyword ideas) or Google Trends (Download CSV).
      </p>

      {cannibal.length > 0 && (
        <div className="border border-amber-500/60 rounded-lg p-3 mb-4 text-sm">
          <div className="font-medium text-amber-700 mb-1">Possible overlap: one cluster is aimed at more than one page</div>
          <ul className="list-disc pl-5">{cannibal.map((c) => <li key={c.cluster}><b>{c.cluster}</b> → {c.urls.join(', ')}</li>)}</ul>
        </div>
      )}

      <div className="border rounded-lg p-4 mb-4 space-y-3">
        <div className="text-sm font-semibold">{form.id ? 'Edit keyword' : 'Add a keyword'}</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input className={inputCls} placeholder="Keyword, e.g. refurbished dell laptop" value={form.keyword} onChange={(e) => setForm((f) => ({ ...f, keyword: e.target.value }))} />
          <input className={inputCls} placeholder="Cluster, e.g. dell laptops" value={form.cluster} onChange={(e) => setForm((f) => ({ ...f, cluster: e.target.value }))} />
          <input className={inputCls} placeholder="Target page, e.g. /laptops/dell" value={form.target_url} onChange={(e) => setForm((f) => ({ ...f, target_url: e.target.value }))} />
          <select className={inputCls} value={form.intent} onChange={(e) => setForm((f) => ({ ...f, intent: e.target.value }))}>
            <option value="">Intent…</option>{INTENTS.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
          <input className={inputCls} placeholder="Area, e.g. India or Noida" value={form.geo} onChange={(e) => setForm((f) => ({ ...f, geo: e.target.value }))} />
          <select className={inputCls} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
            <option value="">Priority…</option><option value="1">1 – first</option><option value="2">2</option><option value="3">3 – later</option>
          </select>
        </div>
        <input className={inputCls} placeholder="Notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        <div className="flex gap-2">
          <button className={btnPrimary} onClick={save} disabled={busy || !form.keyword.trim()}>{form.id ? 'Save' : 'Add keyword'}</button>
          {form.id && <button className={btnGhost} onClick={() => setForm(emptyKw)}>Cancel</button>}
        </div>
      </div>

      <div className="border rounded-lg p-4 mb-4 space-y-3">
        <div className="text-sm font-semibold">Import a CSV</div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium mb-1">Where it came from</label>
            <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="gsc">Search Console (clicks, impressions, position)</option>
              <option value="keyword_planner">Keyword Planner (monthly searches)</option>
              <option value="trends">Google Trends</option>
              <option value="other">Another tool (volume)</option>
            </select>
          </div>
          {source === 'other' && (
            <div><label className="block text-xs font-medium mb-1">Tool name</label><input className={inputCls} value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} placeholder="Ubersuggest" /></div>
          )}
          <div><label className="block text-xs font-medium mb-1">Data is from (date)</label><input type="date" className={inputCls} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
          <div>
            <input ref={fileRef} type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} className="text-sm" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Existing keywords are updated; new ones are added with no cluster or target page for you to fill in.</p>
      </div>

      {error && <div className="text-destructive text-sm mb-2">{error}</div>}
      {message && <div className="text-green-700 text-sm mb-2">{message}</div>}

      <div className="flex gap-2 mb-2">
        <input className={inputCls} placeholder="Filter keywords, clusters, pages…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className={btnGhost} onClick={exportCsv} disabled={rows.length === 0}>Export CSV</button>
      </div>
      {loading ? <div className="text-sm text-muted-foreground">Loading…</div> : shown.length === 0 ? (
        <div className="text-sm text-muted-foreground">No keywords yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left"><tr>
              <th className="p-2">Keyword</th><th className="p-2">Cluster</th><th className="p-2">Target page</th>
              <th className="p-2 text-right">Searches / month</th><th className="p-2 text-right">Clicks</th><th className="p-2 text-right">Impr.</th><th className="p-2 text-right">Avg. pos.</th><th className="p-2" />
            </tr></thead>
            <tbody>
              {shown.map((k) => (
                <tr key={k.id} className="border-t">
                  <td className="p-2">{k.keyword}{k.priority ? <span className="ml-1 text-xs text-muted-foreground">P{k.priority}</span> : null}</td>
                  <td className="p-2">{k.cluster ?? '—'}</td>
                  <td className="p-2 break-all">{k.target_url ?? '—'}</td>
                  <td className="p-2 text-right tabular-nums" title={k.volume_source ?? ''}>{k.volume ?? '—'}</td>
                  <td className="p-2 text-right tabular-nums" title={k.metrics_source ? `${k.metrics_source}, ${k.metrics_as_of}` : ''}>{k.clicks ?? '—'}</td>
                  <td className="p-2 text-right tabular-nums">{k.impressions ?? '—'}</td>
                  <td className="p-2 text-right tabular-nums">{k.avg_position ?? '—'}</td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <button className="text-primary mr-3" onClick={() => setForm({ id: k.id, keyword: k.keyword, cluster: k.cluster ?? '', intent: k.intent ?? '', geo: k.geo ?? '', target_url: k.target_url ?? '', priority: k.priority ? String(k.priority) : '', notes: k.notes ?? '' })}>Edit</button>
                    <button className="text-destructive" onClick={() => remove(k)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Crawl & 404s

interface Issue { code: string; severity: 'error' | 'warning'; label: string; hint: string; count: number; urls: string[] }
interface CrawlResult {
  import: { filename: string | null; row_count: number; created_at: string } | null
  pages?: number
  issues: Issue[]
  sitemap_checked?: boolean
  sitemap_source?: string
}
interface NotFoundRow { path: string; hits: number; last_seen: string; last_referrer: string | null }

// Only the columns we use are sent (an export has ~60).
const CRAWL_COLS = ['address', 'status code', 'indexability', 'title 1', 'meta description 1', 'h1-1', 'word count', 'inlinks', 'response time', 'canonical link element 1', 'redirect url', 'content type']

export function CrawlSection() {
  const [crawl, setCrawl] = useState<CrawlResult | null>(null)
  const [nf, setNf] = useState<NotFoundRow[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const [c, n] = await Promise.all([apiFetch('/api/website-seo/crawl'), apiFetch('/api/website-seo/not-found-log')])
    if (c.ok) setCrawl(await c.json())
    if (n.ok) setNf(await n.json())
  }, [])
  useEffect(() => { load() }, [load])

  const upload = (file: File) => {
    setError(''); setMessage(''); setBusy(true)
    Papa.parse<Record<string, any>>(file, {
      header: true, skipEmptyLines: true,
      complete: async (result) => {
        const rows = result.data.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => CRAWL_COLS.includes(k.trim().toLowerCase()))))
        const res = await apiFetch('/api/website-seo/crawl', { method: 'POST', body: JSON.stringify({ filename: file.name, rows }) })
        if (res.ok) { const d = await res.json(); setMessage(`Imported ${d.pages} pages.`); await load() } else setError(await errorOf(res, 'Import failed'))
        setBusy(false)
        if (fileRef.current) fileRef.current.value = ''
      },
      error: () => { setError('Could not read that file'); setBusy(false) },
    })
  }

  const clear404 = async (path: string) => {
    await apiFetch(`/api/website-seo/not-found-log?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
    await load()
  }

  const errors = crawl?.issues.filter((i) => i.severity === 'error').reduce((n, i) => n + i.count, 0) ?? 0
  const warnings = crawl?.issues.filter((i) => i.severity === 'warning').reduce((n, i) => n + i.count, 0) ?? 0

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-2">Site crawl</h3>
        <details className="text-sm border rounded-lg p-3 mb-3">
          <summary className="cursor-pointer font-medium">How to run the crawl (Screaming Frog, about 10 minutes)</summary>
          <ol className="list-decimal pl-5 mt-2 space-y-1 text-muted-foreground">
            <li>Install Screaming Frog SEO Spider (free up to 500 pages — enough for this site).</li>
            <li>Mode: Spider. Enter <b>https://www.digitalbluez.com</b> and press Start. Wait for 100%.</li>
            <li>Choose the <b>Internal</b> tab, filter <b>All</b>, then <b>Export</b> → save the CSV.</li>
            <li>Upload that CSV below. Do this monthly and after each website release.</li>
          </ol>
        </details>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <input ref={fileRef} type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="text-sm" />
          {busy && <span className="text-sm text-muted-foreground">Importing…</span>}
        </div>
        {error && <div className="text-destructive text-sm mb-2">{error}</div>}
        {message && <div className="text-green-700 text-sm mb-2">{message}</div>}

        {!crawl?.import ? (
          <div className="text-sm text-muted-foreground">No crawl uploaded yet.</div>
        ) : (
          <div>
            <p className="text-sm mb-3">
              Latest: <b>{crawl.import.filename ?? 'crawl'}</b>, {crawl.pages} pages, uploaded {new Date(crawl.import.created_at).toLocaleDateString()}.{' '}
              <span className={errors ? 'text-destructive font-medium' : 'text-green-700'}>{errors} to fix</span>,{' '}
              <span className={warnings ? 'text-amber-700' : 'text-green-700'}>{warnings} to review</span>.
              {crawl.sitemap_checked === false && <span className="text-amber-700"> The live sitemap could not be fetched, so sitemap checks were skipped.</span>}
            </p>
            {crawl.issues.length === 0 ? <div className="text-sm text-green-700">No problems found.</div> : (
              <div className="space-y-2">
                {crawl.issues.map((i) => (
                  <div key={i.code} className={`border rounded-lg p-3 ${i.severity === 'error' ? 'border-destructive/50' : ''}`}>
                    <button className="w-full text-left flex justify-between gap-3" onClick={() => setOpen(open === i.code ? null : i.code)}>
                      <span className="text-sm"><span className={`text-xs font-semibold mr-2 ${i.severity === 'error' ? 'text-destructive' : 'text-amber-700'}`}>{i.severity === 'error' ? 'FIX' : 'REVIEW'}</span>{i.label}</span>
                      <span className="text-sm tabular-nums">{i.count}</span>
                    </button>
                    {open === i.code && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        <p className="mb-1">{i.hint}</p>
                        <ul className="list-disc pl-5 break-all">{i.urls.map((u) => <li key={u}>{u}</li>)}</ul>
                        {i.count > i.urls.length && <p className="mt-1">…and {i.count - i.urls.length} more.</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-1">Pages visitors could not find (404s)</h3>
        <p className="text-sm text-muted-foreground mb-2">
          Recorded when a visitor&apos;s browser shows the “page not found” page — crawlers that don&apos;t run scripts won&apos;t appear
          (Search Console&apos;s Pages report covers those). Fix a repeated one with a redirect (Redirects tab), then mark it done.
        </p>
        {nf.length === 0 ? <div className="text-sm text-muted-foreground">Nothing recorded yet.</div> : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left"><tr><th className="p-2">Last seen</th><th className="p-2">Address</th><th className="p-2 text-right">Times</th><th className="p-2">Came from</th><th className="p-2" /></tr></thead>
              <tbody>
                {nf.map((r) => (
                  <tr key={r.path} className="border-t">
                    <td className="p-2 whitespace-nowrap">{new Date(r.last_seen).toLocaleDateString()}</td>
                    <td className="p-2 break-all">{r.path}</td>
                    <td className="p-2 text-right tabular-nums">{r.hits}</td>
                    <td className="p-2 break-all text-muted-foreground">{r.last_referrer || '—'}</td>
                    <td className="p-2 text-right"><button className="text-primary" onClick={() => clear404(r.path)}>Done</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

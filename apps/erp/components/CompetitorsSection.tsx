'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { ListHeader, ListItem, Panes, Pill } from '@/components/MasterDetail'
import type { SiteSignals, PageSignals } from '@/lib/seo-competitor'
import type { Idea, IdeaScreen } from '@/lib/seo-competitor-ideas'

// Settings -> Website SEO -> Competitor websites. The owner lists sites; the
// server reads a handful of their PUBLIC pages (politely, honouring robots.txt)
// and keeps only signals -- counts, lengths, markup types, short claim snippets.
// The ideas compare each site with ours and say where to apply what we learn.

const inputCls = 'border p-2 rounded w-full text-sm bg-background'
const btnPrimary = 'bg-primary text-primary-foreground px-4 py-2 rounded text-sm disabled:opacity-50'
const btnGhost = 'border px-3 py-2 rounded text-sm hover:bg-muted disabled:opacity-50'
const errorOf = (res: Response, fallback: string) => res.json().then((j) => j.error || fallback).catch(() => fallback)

interface Site {
  id: string
  label: string
  base_url: string
  is_self: boolean
  last_analyzed_at: string | null
  snapshot: { fetched_at: string; signals: SiteSignals | null; error: string | null } | null
  ideas: Idea[]
}

type Go = (tab: IdeaScreen) => void

const AREA_TONE = { Collections: 'green', Schema: 'gray', 'Page metadata': 'amber', Policies: 'gray', Content: 'amber', Trust: 'red' } as const

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border p-3">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      <div className="space-y-1 text-sm">{children}</div>
    </section>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right break-words">{v}</span>
    </div>
  )
}

function PageCard({ label, p }: { label: string; p: PageSignals }) {
  return (
    <div className="rounded border p-2">
      <div className="text-xs font-semibold">{label} <span className="font-normal text-muted-foreground break-all">{p.url.replace(/^https:\/\//, '')}</span></div>
      <div className="mt-1 break-words text-sm">{p.title ?? <i>no title</i>}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        Title {p.titleLength} chars · description {p.metaDescriptionLength} · {p.h1Count} H1 · {p.wordCount} words · markup: {p.schemaTypes.join(', ') || 'none'}
      </div>
    </div>
  )
}

export default function CompetitorsSection({ go }: { go: Go }) {
  const [sites, setSites] = useState<Site[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [unreadable, setUnreadable] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const res = await apiFetch('/api/website-seo/competitors')
    if (res.ok) setSites(await res.json())
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const selected = sites.find((s) => s.id === selectedId) ?? null
  const g = selected?.snapshot?.signals ?? null

  const analyze = async (s: Site) => {
    setBusy(true); setError(''); setMessage('')
    const res = await apiFetch('/api/website-seo/competitors/analyze', { method: 'POST', body: JSON.stringify({ id: s.id }) })
    if (res.ok) {
      const d = await res.json()
      setMessage(d.ok ? `Done (${d.requests} pages read).` : '')
      if (!d.ok) setError(d.error || 'Nothing could be read from this website')
    } else {
      setError(await errorOf(res, 'Analysis failed'))
    }
    await load()
    setBusy(false)
  }

  const add = async (confirmUnreadable = false) => {
    setBusy(true); setError(''); setUnreadable(null)
    const res = await apiFetch('/api/website-seo/competitors', { method: 'POST', body: JSON.stringify({ label, base_url: url, confirm_unreadable: confirmUnreadable }) })
    if (res.ok) {
      const d = await res.json()
      setLabel(''); setUrl(''); setAdding(false)
      await load()
      setSelectedId(d.id); setOpen(true)
    } else if (res.status === 409) {
      const d = await res.json().catch(() => ({}))
      if (d.needs_confirmation) setUnreadable(d.error || 'This website\'s prices cannot be read automatically.')
      else setError(d.error || 'Could not add this website')
    } else {
      setError(await errorOf(res, 'Could not add this website'))
    }
    setBusy(false)
  }

  const remove = async (s: Site) => {
    if (!confirm(`Stop tracking ${s.label}?`)) return
    await apiFetch(`/api/website-seo/competitors?id=${s.id}`, { method: 'DELETE' })
    setSelectedId(null); setOpen(false)
    await load()
  }

  return (
    <Panes
      bp="xl"
      open={open}
      onBack={() => setOpen(false)}
      backLabel="Back to websites"
      list={
        <div>
          <ListHeader title={`${sites.length} website${sites.length === 1 ? '' : 's'}`} onNew={() => { setAdding(true); setSelectedId(null); setOpen(true); setError(''); setMessage('') }} newLabel="+ Add" />
          {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <div className="space-y-1">
              {sites.map((s) => (
                <ListItem
                  key={s.id}
                  selected={s.id === selectedId && !adding}
                  onClick={() => { setSelectedId(s.id); setAdding(false); setOpen(true); setError(''); setMessage('') }}
                  title={s.label}
                  sub={s.base_url.replace('https://', '')}
                  right={<Pill tone={s.is_self ? 'green' : s.snapshot?.signals ? 'gray' : 'amber'}>{s.is_self ? 'ours' : s.snapshot?.signals ? `${s.ideas.length} ideas` : 'not run'}</Pill>}
                />
              ))}
            </div>
          )}
        </div>
      }
    >
      <p className="mb-4 text-sm text-muted-foreground">
        Add a website you want to learn from. We read a few of its public pages (its robots.txt rules are respected, at most about
        14 requests, once an hour per site) and keep only what we measured: page titles, markup types, menu structure, policy pages
        and the selling points it states. Ideas show what they do that we don&apos;t and where to apply it. They never suggest copying
        their text.
      </p>

      {error && <div className="mb-3 text-sm text-destructive">{error}</div>}
      {message && <div className="mb-3 text-sm text-green-700">{message}</div>}

      {adding && (
        <div className="max-w-md space-y-3 rounded-lg border p-4">
          <div>
            <label className="mb-1 block text-xs font-medium">Name</label>
            <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. EazyPC" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Website address</label>
            <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
            <p className="mt-1 text-xs text-muted-foreground">Public https websites only.</p>
          </div>
          {unreadable && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
              <p className="font-medium">Heads up: this website blocks or hides its prices.</p>
              <p className="mt-1 text-xs">{unreadable}</p>
              <p className="mt-1 text-xs">The page analysis here can still work, but the Price Board cannot read its prices. Add it only if you want the SEO analysis.</p>
              <button className={`${btnGhost} mt-2`} onClick={() => add(true)} disabled={busy}>Add anyway</button>
            </div>
          )}
          <div className="flex gap-2">
            <button className={btnPrimary} onClick={() => add(false)} disabled={busy || !label.trim() || !url.trim()}>Add website</button>
            <button className={btnGhost} onClick={() => { setAdding(false); setOpen(false) }}>Cancel</button>
          </div>
        </div>
      )}

      {!adding && !selected && <p className="text-sm text-muted-foreground">Choose a website on the left.</p>}

      {!adding && selected && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-base font-semibold">{selected.label}{selected.is_self && <span className="ml-2 text-xs font-normal text-muted-foreground">(baseline for comparisons)</span>}</div>
              <a href={selected.base_url} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-primary hover:underline">{selected.base_url}</a>
              <div className="text-xs text-muted-foreground">
                {selected.snapshot ? `Last analysed ${new Date(selected.snapshot.fetched_at).toLocaleString()}` : 'Not analysed yet'}
              </div>
            </div>
            <div className="flex gap-2">
              <button className={btnPrimary} onClick={() => analyze(selected)} disabled={busy}>{busy ? 'Reading pages…' : selected.snapshot ? 'Analyse again' : 'Analyse now'}</button>
              {!selected.is_self && <button className={btnGhost} onClick={() => remove(selected)} disabled={busy}>Remove</button>}
            </div>
          </div>

          {selected.snapshot?.error && <div className="rounded border border-amber-500/60 p-3 text-sm text-amber-700">{selected.snapshot.error}</div>}

          {!selected.is_self && selected.ideas.length > 0 && (
            <section>
              <h4 className="mb-2 text-sm font-semibold">Ideas to apply</h4>
              <div className="space-y-2">
                {selected.ideas.map((i) => (
                  <div key={i.key} className="rounded-lg border p-3">
                    <div className="mb-1 flex items-center gap-2"><Pill tone={AREA_TONE[i.area]}>{i.area}</Pill><span className="text-sm font-medium">{i.title}</span></div>
                    <p className="text-sm text-muted-foreground">{i.evidence}</p>
                    <p className="mt-1 text-sm"><b>What to do:</b> {i.apply}</p>
                    {i.screen && <button className="mt-2 text-sm text-primary hover:underline" onClick={() => go(i.screen as IdeaScreen)}>Open this screen →</button>}
                  </div>
                ))}
              </div>
            </section>
          )}
          {!selected.is_self && g && selected.ideas.length === 0 && <p className="text-sm text-muted-foreground">No gaps found against our current site.</p>}
          {!selected.is_self && g && !sites.find((s) => s.is_self)?.snapshot?.signals && (
            <p className="text-sm text-amber-700">Analyse our own site first so ideas can compare against it.</p>
          )}

          {g && (
            <div className="space-y-3">
              <Block title="Site">
                <Row k="Built with" v={g.platform ?? 'not detected'} />
                <Row k="Analytics seen" v={g.analytics.join(', ') || 'none'} />
                <Row k="robots.txt" v={g.robots.fetched ? `${g.robots.disallowRules} blocked path rules${g.robots.blocksEverything ? ' (blocks all bots)' : ''}` : 'not found'} />
                <Row k="Pages read" v={g.requests} />
              </Block>
              <Block title="Sitemap">
                {g.sitemap.ok ? (
                  <>
                    <Row k="URLs read" v={`${g.sitemap.urlsSeen}${g.sitemap.indexed ? '+ (index)' : ''}`} />
                    <Row k="Products" v={g.sitemap.buckets.product} />
                    <Row k="Category / collection pages" v={g.sitemap.buckets.collection} />
                    <Row k="Blog / guides" v={g.sitemap.buckets.blog} />
                    <Row k="Lists last-changed dates" v={g.sitemap.lastmodShare == null ? '—' : `${Math.round(g.sitemap.lastmodShare * 100)}% of URLs`} />
                  </>
                ) : <p className="text-muted-foreground">No readable sitemap.xml</p>}
              </Block>
              <Block title="Shop-by menus on the home page">
                <Row k="Price bands" v={g.nav.budget.map((l) => l.text).join(', ') || 'none'} />
                <Row k="Brands" v={g.nav.brand.map((l) => l.text).join(', ') || 'none'} />
                <Row k="Uses" v={g.nav.useCase.map((l) => l.text).join(', ') || 'none'} />
              </Block>
              <Block title="Policy pages linked">
                {Object.keys(g.policies).length ? Object.entries(g.policies).map(([k, v]) => <Row key={k} k={k} v={v} />) : <p className="text-muted-foreground">None found</p>}
              </Block>
              <Block title="Selling points stated on the home page">
                {g.claims.length ? g.claims.map((c) => <Row key={c.type} k={c.type} v={<i>“{c.text}”</i>} />) : <p className="text-muted-foreground">None detected</p>}
              </Block>
              <Block title="Sample pages">
                {(['home', 'product', 'collection', 'policy', 'blog'] as const).map((k) => (g.pages[k] ? <PageCard key={k} label={k} p={g.pages[k] as PageSignals} /> : null))}
              </Block>
              {g.notes.length > 0 && (
                <Block title="Notes">{g.notes.map((n) => <p key={n} className="text-muted-foreground">{n}</p>)}</Block>
              )}
            </div>
          )}
        </div>
      )}
    </Panes>
  )
}

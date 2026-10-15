'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { CrawlSection, KeywordsSection } from '@/components/WebsiteSeoData'
import { ListHeader, ListItem, NavList, Panes, Pill, type NavEntry } from '@/components/MasterDetail'
import CompetitorsSection from '@/components/CompetitorsSection'
import { GoogleSetupSection, SuggestionsSection } from '@/components/SuggestionsSection'

// Owner-only Settings -> Website SEO. Everything here is stored in the seo_*
// tables (migration 20261015) and read by apps/web through public_seo_* views,
// so a change shows up on the storefront within its 60 s revalidate window.
// Enforcement is in app/api/website-seo/** (isOwner); this component is UX only.

const SITE = 'https://www.digitalbluez.com'

type TabKey = 'overview' | 'suggestions' | 'google' | 'defaults' | 'overrides' | 'collections' | 'keywords' | 'redirects' | 'images' | 'crawl' | 'competitors' | 'history'
const NAV: (NavEntry & { key: TabKey })[] = [
  { key: 'overview', label: 'Overview', hint: 'What needs attention' },
  { key: 'suggestions', label: 'Suggestions', hint: 'What to do next, week by week' },
  { key: 'google', label: 'Google setup', hint: 'Analytics, Search Console, Business Profile' },
  { key: 'defaults', label: 'Site defaults', hint: 'Descriptions and share image' },
  { key: 'overrides', label: 'Page metadata', hint: 'Titles, descriptions, indexing' },
  { key: 'collections', label: 'Collections', hint: 'Brand, budget and spec pages' },
  { key: 'keywords', label: 'Keywords', hint: 'Phrase to page map, imports' },
  { key: 'redirects', label: 'Redirects', hint: 'Old addresses to live pages' },
  { key: 'images', label: 'Image alt text', hint: 'Photo descriptions' },
  { key: 'crawl', label: 'Crawl & 404s', hint: 'Site audit and dead links' },
  { key: 'competitors', label: 'Competitor websites', hint: 'Analyse sites, get ideas' },
  { key: 'history', label: 'History', hint: 'Undo earlier changes' },
]

const STATIC_PATHS = ['/', '/about', '/contact', '/faq', '/blog', '/privacy', '/terms', '/return-policy', '/warranty', '/buyback']
const CATEGORY_CODES = ['LAP', 'DES', 'MON', 'TAB', 'ACC', 'ADP', 'RAM', 'SSD', 'KBD', 'MOUSE', 'CPU', 'GPU', 'CCTV', 'OTHER']

const inputCls = 'border p-2 rounded w-full text-sm bg-background'
const btnPrimary = 'bg-primary text-primary-foreground px-4 py-2 rounded text-sm disabled:opacity-50'
const btnGhost = 'border px-3 py-2 rounded text-sm hover:bg-muted disabled:opacity-50'

function publicImageUrl(storagePath: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images/${storagePath}`
}

function errorOf(res: Response, fallback: string): Promise<string> {
  return res.json().then((j) => j.error || fallback).catch(() => fallback)
}

// Counter that turns amber/red as a field approaches what Google shows.
function Counter({ value, warn, max }: { value: string; warn: number; max: number }) {
  const n = value.length
  const tone = n > max ? 'text-destructive' : n > warn ? 'text-amber-600' : 'text-muted-foreground'
  return <span className={`text-xs ${tone}`}>{n}/{max}</span>
}

// ---------------------------------------------------------------- Overview

interface Overview {
  published_products: number
  published_without_description: number
  images_without_alt: number
  redirects: number
  overrides_published: number
  overrides_draft: number
  last_change_at: string | null
}

function OverviewSection({ go }: { go: (t: TabKey) => void }) {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch('/api/website-seo/overview').then(async (res) => {
      if (res.ok) setData(await res.json())
      else setError(await errorOf(res, 'Failed to load overview'))
    })
  }, [])

  if (error) return <div className="text-destructive text-sm">{error}</div>
  if (!data) return <div className="text-sm text-muted-foreground">Loading…</div>

  const cards: { label: string; value: number; hint: string; tab?: TabKey; attention?: boolean }[] = [
    { label: 'Published products', value: data.published_products, hint: 'Live on the website' },
    {
      label: 'Published without a description',
      value: data.published_without_description,
      hint: 'These fall back to the description template',
      attention: data.published_without_description > 0,
    },
    {
      label: 'Photos without alt text',
      value: data.images_without_alt,
      hint: 'Screen readers and image search see the product title instead',
      tab: 'images',
      attention: data.images_without_alt > 0,
    },
    { label: 'Redirects', value: data.redirects, hint: 'Old URLs that forward to a live page', tab: 'redirects' },
    { label: 'Page overrides live', value: data.overrides_published, hint: 'Custom title/description in use', tab: 'overrides' },
    { label: 'Page overrides in draft', value: data.overrides_draft, hint: 'Saved but not yet published', tab: 'overrides' },
  ]

  return (
    <div>
      <button type="button" onClick={() => go('suggestions')} className="mb-4 w-full rounded-lg border border-primary/40 bg-primary/5 p-4 text-left hover:bg-primary/10">
        <div className="text-sm font-semibold">See this week&apos;s suggestions →</div>
        <div className="text-xs text-muted-foreground">Google setup problems, new pages worth creating, Google Business Profile routine, dead links and competitor ideas.</div>
      </button>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map((c) => (
          <button
            key={c.label}
            type="button"
            disabled={!c.tab}
            onClick={() => c.tab && go(c.tab)}
            className={`text-left border rounded-lg p-4 ${c.tab ? 'hover:bg-muted' : 'cursor-default'} ${c.attention ? 'border-amber-500/60' : ''}`}
          >
            <div className="text-2xl font-semibold tabular-nums text-foreground">{c.value}</div>
            <div className="text-sm font-medium text-foreground">{c.label}</div>
            <div className="text-xs text-muted-foreground mt-1">{c.hint}</div>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-4">
        Last change: {data.last_change_at ? new Date(data.last_change_at).toLocaleString() : 'none yet'}. Search traffic,
        top queries and site health are in Reports → Website.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------- Defaults

interface SeoSettings {
  default_description: string | null
  default_og_image_path: string | null
  product_description_template: string | null
}

function DefaultsSection() {
  const [form, setForm] = useState<SeoSettings>({ default_description: '', default_og_image_path: '', product_description_template: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch('/api/website-seo/settings').then(async (res) => {
      if (res.ok) {
        const d = await res.json()
        setForm({
          default_description: d?.default_description ?? '',
          default_og_image_path: d?.default_og_image_path ?? '',
          product_description_template: d?.product_description_template ?? '',
        })
      }
      setLoading(false)
    })
  }, [])

  const save = async () => {
    setSaving(true)
    setError('')
    setMessage('')
    const res = await apiFetch('/api/website-seo/settings', { method: 'PATCH', body: JSON.stringify(form) })
    if (res.ok) setMessage('Saved. The website picks this up within a minute.')
    else setError(await errorOf(res, 'Failed to save'))
    setSaving(false)
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>

  const sample = (form.product_description_template || '')
    .replace('{title}', 'Certified Refurbished Dell Latitude 5410 — i7 / 8GB / 512GB')
    .replace('{brand}', 'Dell')
    .replace('{model}', 'Latitude 5410')
    .replace('{price}', '₹40,000')

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-muted-foreground">
        Used wherever a page has no description of its own. Leave a field empty to keep the built-in wording.
      </p>
      <div>
        <div className="flex justify-between">
          <label className="block text-xs font-medium mb-1">Site description (home page and any page without its own)</label>
          <Counter value={form.default_description ?? ''} warn={160} max={200} />
        </div>
        <textarea
          rows={2}
          className={inputCls}
          value={form.default_description ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, default_description: e.target.value }))}
          placeholder="Quality-checked refurbished laptops, desktops, monitors and accessories, backed by warranty."
        />
      </div>
      <div>
        <label className="block text-xs font-medium mb-1">
          Product description template <span className="text-muted-foreground">(used when a product has no description of its own)</span>
        </label>
        <textarea
          rows={2}
          className={inputCls}
          value={form.product_description_template ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, product_description_template: e.target.value }))}
          placeholder="{title}, quality-checked and backed by warranty. Buy online from DigitalBluez, Greater Noida."
        />
        <p className="text-xs text-muted-foreground mt-1">Placeholders: {'{title}'} {'{brand}'} {'{model}'} {'{price}'}</p>
        {sample && <p className="text-xs mt-1">Preview: <span className="text-foreground">{sample}</span></p>}
      </div>
      <div>
        <label className="block text-xs font-medium mb-1">
          Default social-share image <span className="text-muted-foreground">(path inside the product-images storage bucket; empty = DigitalBluez logo)</span>
        </label>
        <input
          className={inputCls}
          value={form.default_og_image_path ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, default_og_image_path: e.target.value }))}
          placeholder="banners/share-image.png"
        />
      </div>
      {error && <div className="text-destructive text-sm">{error}</div>}
      {message && <div className="text-sm text-green-700">{message}</div>}
      <button className={btnPrimary} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save defaults'}</button>
    </div>
  )
}

// ---------------------------------------------------------------- Overrides

interface Override {
  id: string
  entity_type: 'product' | 'category' | 'static' | 'blog'
  entity_key: string
  meta_title: string | null
  meta_description: string | null
  og_image_path: string | null
  robots_index: boolean | null
  canonical_override: string | null
  status: 'draft' | 'published'
  updated_at: string
}

interface SkuHit {
  id: string
  full_sku_code: string
  brand?: string | null
  model_name?: string | null
  web_title?: string | null
}

const emptyOverride = {
  entity_type: 'static' as Override['entity_type'],
  entity_key: '/',
  meta_title: '',
  meta_description: '',
  og_image_path: '',
  robots_index: '' as '' | 'true' | 'false',
  canonical_override: '',
}

function previewUrl(type: Override['entity_type'], key: string, skuSlug?: string) {
  if (type === 'static') return `${SITE}${key === '/' ? '' : key}`
  if (type === 'blog') return `${SITE}/blog/${key}`
  if (type === 'product') return `${SITE}/product/${skuSlug || '…'}`
  return `${SITE}/…`
}

function OverridesSection() {
  const [rows, setRows] = useState<Override[]>([])
  const [form, setForm] = useState(emptyOverride)
  const [skuLabel, setSkuLabel] = useState('')
  const [skuQuery, setSkuQuery] = useState('')
  const [skuHits, setSkuHits] = useState<SkuHit[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    const res = await apiFetch('/api/website-seo/overrides')
    if (res.ok) setRows(await res.json())
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (form.entity_type !== 'product' || skuQuery.trim().length < 2) { setSkuHits([]); return }
    const t = setTimeout(async () => {
      const res = await apiFetch(`/api/sku-master?search=${encodeURIComponent(skuQuery.trim())}&is_published=true`)
      if (res.ok) {
        const d = await res.json()
        setSkuHits((Array.isArray(d) ? d : d.data ?? []).slice(0, 8))
      }
    }, 300)
    return () => clearTimeout(t)
  }, [skuQuery, form.entity_type])

  const edit = (o: Override) => {
    setForm({
      entity_type: o.entity_type,
      entity_key: o.entity_key,
      meta_title: o.meta_title ?? '',
      meta_description: o.meta_description ?? '',
      og_image_path: o.og_image_path ?? '',
      robots_index: o.robots_index === null ? '' : (String(o.robots_index) as 'true' | 'false'),
      canonical_override: o.canonical_override ?? '',
    })
    setSkuLabel(o.entity_type === 'product' ? o.entity_key : '')
    setError('')
    setWarnings([])
    setOpen(true)
  }

  const reset = () => { setForm(emptyOverride); setSkuLabel(''); setSkuQuery(''); setError(''); setWarnings([]) }

  const save = async (status: 'draft' | 'published') => {
    setError('')
    setWarnings([])
    if (!form.entity_key.trim()) { setError('Choose which page this applies to'); return }
    setSaving(true)
    const res = await apiFetch('/api/website-seo/overrides', {
      method: 'PUT',
      body: JSON.stringify({
        ...form,
        robots_index: form.robots_index === '' ? null : form.robots_index === 'true',
        status,
      }),
    })
    if (res.ok) {
      const d = await res.json()
      setWarnings(d.warnings ?? [])
      await load()
      if (!(d.warnings ?? []).length) { reset(); setOpen(false) }
    } else {
      setError(await errorOf(res, 'Failed to save'))
    }
    setSaving(false)
  }

  const remove = async (o: Override) => {
    if (!confirm(`Remove the override for ${o.entity_type}: ${o.entity_key}? You can restore it from History.`)) return
    await apiFetch(`/api/website-seo/overrides?id=${o.id}`, { method: 'DELETE' })
    reset()
    setOpen(false)
    await load()
  }

  const shownTitle = form.meta_title || '(page title as built by the website)'
  const shownDesc = form.meta_description || '(description as built by the website)'

  const current = rows.find((r) => r.entity_type === form.entity_type && r.entity_key === form.entity_key)
  const labelOf = (o: Override) => `${o.entity_type}: ${o.entity_type === 'product' ? o.entity_key.slice(0, 8) + '…' : o.entity_key}`

  return (
    <Panes
      bp="xl"
      open={open}
      onBack={() => setOpen(false)}
      backLabel="Back to pages"
      list={
        <div>
          <ListHeader title={`${rows.length} page${rows.length === 1 ? '' : 's'} customised`} onNew={() => { reset(); setOpen(true) }} />
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet. Use “+ New”.</p>
          ) : (
            <div className="space-y-1">
              {rows.map((o) => (
                <ListItem
                  key={o.id}
                  selected={current?.id === o.id}
                  onClick={() => edit(o)}
                  title={labelOf(o)}
                  sub={o.meta_title || 'no title set'}
                  right={<Pill tone={o.status === 'published' ? 'green' : 'amber'}>{o.status}</Pill>}
                />
              ))}
            </div>
          )}
        </div>
      }
    >
      <p className="text-sm text-muted-foreground mb-4">
        Override how one page appears in search results, or flip it between indexed and hidden. Only <b>Published</b> overrides
        reach the website. Product titles and descriptions normally come from the SKU&apos;s Website dialog — use this when you
        want a search-specific wording without touching the product itself.
      </p>

      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">Applies to</label>
            <select
              className={inputCls}
              value={form.entity_type}
              onChange={(e) => {
                const t = e.target.value as Override['entity_type']
                setForm((f) => ({ ...f, entity_type: t, entity_key: t === 'static' ? '/' : t === 'category' ? 'LAP' : '' }))
                setSkuLabel(''); setSkuQuery('')
              }}
            >
              <option value="static">Fixed page (home, about, policies…)</option>
              <option value="category">Category page</option>
              <option value="product">One product</option>
              <option value="blog">Blog post</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium mb-1">
              {form.entity_type === 'product' ? 'Product' : form.entity_type === 'blog' ? 'Post slug' : 'Page'}
            </label>
            {form.entity_type === 'static' && (
              <select className={inputCls} value={form.entity_key} onChange={(e) => setForm((f) => ({ ...f, entity_key: e.target.value }))}>
                {STATIC_PATHS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
            {form.entity_type === 'category' && (
              <select className={inputCls} value={form.entity_key} onChange={(e) => setForm((f) => ({ ...f, entity_key: e.target.value }))}>
                {CATEGORY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            {form.entity_type === 'blog' && (
              <input className={inputCls} value={form.entity_key} onChange={(e) => setForm((f) => ({ ...f, entity_key: e.target.value }))} placeholder="how-to-choose-a-refurbished-laptop" />
            )}
            {form.entity_type === 'product' && (
              <div className="relative">
                <input
                  className={inputCls}
                  value={skuLabel || skuQuery}
                  onChange={(e) => { setSkuLabel(''); setSkuQuery(e.target.value); setForm((f) => ({ ...f, entity_key: '' })) }}
                  placeholder="Search a published product by SKU code…"
                />
                {skuHits.length > 0 && !skuLabel && (
                  <div className="absolute z-10 left-0 right-0 mt-1 bg-background border rounded shadow">
                    {skuHits.map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-muted"
                        onClick={() => { setForm((f) => ({ ...f, entity_key: h.id })); setSkuLabel(h.full_sku_code); setSkuHits([]) }}
                      >
                        {h.full_sku_code}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="flex justify-between">
            <label className="block text-xs font-medium mb-1">Search title</label>
            <Counter value={form.meta_title} warn={60} max={70} />
          </div>
          <input className={inputCls} value={form.meta_title} onChange={(e) => setForm((f) => ({ ...f, meta_title: e.target.value }))} placeholder="Leave empty to keep the current title (&quot; | DigitalBluez&quot; is added automatically)" />
        </div>
        <div>
          <div className="flex justify-between">
            <label className="block text-xs font-medium mb-1">Search description</label>
            <Counter value={form.meta_description} warn={160} max={200} />
          </div>
          <textarea rows={2} className={inputCls} value={form.meta_description} onChange={(e) => setForm((f) => ({ ...f, meta_description: e.target.value }))} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">Search engines</label>
            <select className={inputCls} value={form.robots_index} onChange={(e) => setForm((f) => ({ ...f, robots_index: e.target.value as '' | 'true' | 'false' }))}>
              <option value="">Keep the page&apos;s default</option>
              <option value="true">Allow indexing</option>
              <option value="false">Hide from search (noindex)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Canonical URL <span className="text-muted-foreground">(optional)</span></label>
            <input className={inputCls} value={form.canonical_override} onChange={(e) => setForm((f) => ({ ...f, canonical_override: e.target.value }))} placeholder="/laptops" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Share image <span className="text-muted-foreground">(storage path)</span></label>
            <input className={inputCls} value={form.og_image_path} onChange={(e) => setForm((f) => ({ ...f, og_image_path: e.target.value }))} />
          </div>
        </div>

        <div className="rounded border bg-muted/40 p-3">
          <div className="text-xs text-muted-foreground mb-1">Search result preview</div>
          <div className="text-xs text-muted-foreground truncate">{previewUrl(form.entity_type, form.entity_key, skuLabel)}</div>
          <div className="text-[#1a0dab] dark:text-blue-400 text-base leading-snug">{shownTitle} | DigitalBluez</div>
          <div className="text-sm text-muted-foreground">{shownDesc}</div>
        </div>

        {error && <div className="text-destructive text-sm">{error}</div>}
        {warnings.length > 0 && (
          <ul className="text-sm text-amber-700 list-disc pl-5">
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <button className={btnPrimary} onClick={() => save('published')} disabled={saving}>Publish</button>
          <button className={btnGhost} onClick={() => save('draft')} disabled={saving}>Save as draft</button>
          <button className={btnGhost} onClick={reset} disabled={saving}>Clear</button>
        </div>
      </div>

      {current && (
        <button className="mt-3 text-sm text-destructive" onClick={() => remove(current)}>Remove this customisation</button>
      )}
    </Panes>
  )
}


// ---------------------------------------------------------------- Collections

interface Collection {
  id: string
  category: 'LAP' | 'DES'
  slug: string
  kind: 'brand' | 'budget' | 'spec' | 'use_case'
  name: string
  h1: string | null
  meta_title: string | null
  meta_description: string | null
  intro_md: string | null
  faq: { q: string; a: string }[]
  filter: Record<string, any>
  min_products: number
  min_intro_words: number
  status: 'draft' | 'published'
  matching: number
  available: number
  intro_words: number
  indexable: boolean
  gate: { published: boolean; enough_products: boolean; enough_text: boolean }
  url: string
}

const emptyCollection = {
  id: '' as string,
  category: 'LAP' as 'LAP' | 'DES',
  slug: '',
  kind: 'brand' as Collection['kind'],
  name: '',
  h1: '',
  meta_title: '',
  meta_description: '',
  intro_md: '',
  faq: [] as { q: string; a: string }[],
  brand: '',
  cpu: '',
  ram: '',
  ssd: '',
  gpuType: '',
  minPrice: '',
  maxPrice: '',
  min_products: 3,
  min_intro_words: 120,
}

const csv = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean)

function CollectionsSection() {
  const [rows, setRows] = useState<Collection[]>([])
  const [form, setForm] = useState(emptyCollection)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    const res = await apiFetch('/api/website-seo/collections')
    if (res.ok) setRows(await res.json())
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const reset = () => { setForm(emptyCollection); setError(''); setWarnings([]) }

  const edit = (c: Collection) => {
    setForm({
      id: c.id, category: c.category, slug: c.slug, kind: c.kind, name: c.name,
      h1: c.h1 ?? '', meta_title: c.meta_title ?? '', meta_description: c.meta_description ?? '', intro_md: c.intro_md ?? '',
      faq: c.faq ?? [],
      brand: (c.filter.brand ?? []).join(', '), cpu: (c.filter.cpu ?? []).join(', '), ram: (c.filter.ram ?? []).join(', '),
      ssd: (c.filter.ssd ?? []).join(', '), gpuType: (c.filter.gpuType ?? [])[0] ?? '',
      minPrice: c.filter.minPrice != null ? String(c.filter.minPrice) : '', maxPrice: c.filter.maxPrice != null ? String(c.filter.maxPrice) : '',
      min_products: c.min_products, min_intro_words: c.min_intro_words,
    })
    setError(''); setWarnings([]); setNote('')
    setOpen(true)
  }

  const save = async (status: 'draft' | 'published') => {
    setError(''); setWarnings([]); setNote('')
    setSaving(true)
    const filter: Record<string, unknown> = {}
    for (const k of ['brand', 'cpu', 'ram', 'ssd'] as const) if (csv(form[k]).length) filter[k] = csv(form[k])
    if (form.gpuType) filter.gpuType = [form.gpuType]
    if (form.minPrice !== '') filter.minPrice = Number(form.minPrice)
    if (form.maxPrice !== '') filter.maxPrice = Number(form.maxPrice)
    const res = await apiFetch('/api/website-seo/collections', {
      method: 'PUT',
      body: JSON.stringify({
        id: form.id || undefined, category: form.category, slug: form.slug, kind: form.kind, name: form.name,
        h1: form.h1, meta_title: form.meta_title, meta_description: form.meta_description, intro_md: form.intro_md,
        faq: form.faq, filter, min_products: form.min_products, min_intro_words: form.min_intro_words, status,
      }),
    })
    if (res.ok) {
      const d = await res.json()
      setWarnings(d.warnings ?? [])
      if (d.redirected) setNote('The old address now redirects to the new one.')
      await load()
      if (!(d.warnings ?? []).length) { reset(); setOpen(false) }
    } else {
      setError(await errorOf(res, 'Failed to save'))
    }
    setSaving(false)
  }

  const remove = async (c: Collection) => {
    if (!confirm(`Delete "${c.name}"? ${c.status === 'published' ? 'Its address will redirect to the category page. ' : ''}You can restore it from History.`)) return
    await apiFetch(`/api/website-seo/collections?id=${c.id}`, { method: 'DELETE' })
    reset()
    setOpen(false)
    await load()
  }

  const words = form.intro_md.trim().split(/\s+/).filter(Boolean).length
  const setFaq = (i: number, patch: Partial<{ q: string; a: string }>) =>
    setForm((f) => ({ ...f, faq: f.faq.map((x, j) => (j === i ? { ...x, ...patch } : x)) }))

  const current = rows.find((r) => r.id === form.id)
  const why = (c: Collection) =>
    c.indexable
      ? 'In Google'
      : [!c.gate.published && 'draft', !c.gate.enough_products && 'too few products', !c.gate.enough_text && 'intro too short'].filter(Boolean).join(', ')

  return (
    <Panes
      bp="xl"
      open={open}
      onBack={() => setOpen(false)}
      backLabel="Back to collections"
      list={
        <div>
          <ListHeader title={`${rows.length} collection${rows.length === 1 ? '' : 's'}`} onNew={() => { reset(); setOpen(true) }} />
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No collections yet. Use “+ New”.</p>
          ) : (
            <div className="space-y-1">
              {rows.map((c) => (
                <ListItem
                  key={c.id}
                  selected={c.id === form.id}
                  onClick={() => edit(c)}
                  title={c.name}
                  sub={`${c.url} · ${c.available}/${c.min_products} products · ${c.intro_words}/${c.min_intro_words} words · ${why(c)}`}
                  right={<Pill tone={c.indexable ? 'green' : c.status === 'published' ? 'amber' : 'gray'}>{c.indexable ? 'Live' : c.status === 'published' ? 'Hidden' : 'Draft'}</Pill>}
                />
              ))}
            </div>
          )}
        </div>
      }
    >
      <p className="text-sm text-muted-foreground mb-4">
        A collection is a saved search with your own wording, shown as its own page such as <b>/laptops/dell</b> or{' '}
        <b>/laptops/under-20000</b>. It only appears in search results while it has <b>enough available products</b> and{' '}
        <b>enough original text</b> (both thresholds are yours to set); otherwise visitors can still open it, but it is hidden
        from Google. Write the intro yourself — copying text between collections or from other sites is what gets pages ignored.
      </p>

      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">Category</label>
            <select className={inputCls} value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as 'LAP' | 'DES' }))}>
              <option value="LAP">Laptops</option><option value="DES">Desktops</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Type</label>
            <select className={inputCls} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as Collection['kind'] }))}>
              <option value="brand">Brand</option><option value="budget">Budget</option><option value="spec">Specification</option><option value="use_case">Use case</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Name (shown on chips)</label>
            <input className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Dell" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Web address</label>
            <input className={inputCls} value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }))} placeholder="dell" />
          </div>
        </div>

        <div>
          <div className="text-xs font-medium mb-1">Which products belong <span className="text-muted-foreground">(comma-separate several values; at least one filter is required)</span></div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <input className={inputCls} placeholder="Brand: Dell, HP" value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} />
            <input className={inputCls} placeholder="CPU: i5, i7" value={form.cpu} onChange={(e) => setForm((f) => ({ ...f, cpu: e.target.value }))} />
            <input className={inputCls} placeholder="RAM: 16GB" value={form.ram} onChange={(e) => setForm((f) => ({ ...f, ram: e.target.value }))} />
            <input className={inputCls} placeholder="SSD: 512GB" value={form.ssd} onChange={(e) => setForm((f) => ({ ...f, ssd: e.target.value }))} />
            <input className={inputCls} type="number" min={0} placeholder="Min price ₹" value={form.minPrice} onChange={(e) => setForm((f) => ({ ...f, minPrice: e.target.value }))} />
            <input className={inputCls} type="number" min={0} placeholder="Max price ₹" value={form.maxPrice} onChange={(e) => setForm((f) => ({ ...f, maxPrice: e.target.value }))} />
            <select className={inputCls} value={form.gpuType} onChange={(e) => setForm((f) => ({ ...f, gpuType: e.target.value }))}>
              <option value="">Any graphics</option><option value="Integrated">Integrated</option><option value="Dedicated">Dedicated</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">Page heading <span className="text-muted-foreground">(empty = “Refurbished {'{name}'} Laptops”)</span></label>
            <input className={inputCls} value={form.h1} onChange={(e) => setForm((f) => ({ ...f, h1: e.target.value }))} />
          </div>
          <div>
            <div className="flex justify-between"><label className="block text-xs font-medium mb-1">Search title</label><Counter value={form.meta_title} warn={60} max={70} /></div>
            <input className={inputCls} value={form.meta_title} onChange={(e) => setForm((f) => ({ ...f, meta_title: e.target.value }))} />
          </div>
        </div>
        <div>
          <div className="flex justify-between"><label className="block text-xs font-medium mb-1">Search description</label><Counter value={form.meta_description} warn={160} max={200} /></div>
          <textarea rows={2} className={inputCls} value={form.meta_description} onChange={(e) => setForm((f) => ({ ...f, meta_description: e.target.value }))} />
        </div>

        <div>
          <div className="flex justify-between">
            <label className="block text-xs font-medium mb-1">Intro text <span className="text-muted-foreground">(Markdown; what to look for, who it suits, what the units here are like)</span></label>
            <span className={`text-xs ${words >= form.min_intro_words ? 'text-green-700' : 'text-amber-600'}`}>{words}/{form.min_intro_words} words</span>
          </div>
          <textarea rows={8} className={`${inputCls} font-mono`} value={form.intro_md} onChange={(e) => setForm((f) => ({ ...f, intro_md: e.target.value }))} />
        </div>

        <div>
          <div className="text-xs font-medium mb-1">Common questions <span className="text-muted-foreground">(optional, max 10)</span></div>
          {form.faq.map((f, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_auto] gap-2 mb-2">
              <input className={inputCls} placeholder="Question" value={f.q} onChange={(e) => setFaq(i, { q: e.target.value })} />
              <input className={inputCls} placeholder="Answer" value={f.a} onChange={(e) => setFaq(i, { a: e.target.value })} />
              <button type="button" className="text-destructive text-sm" onClick={() => setForm((x) => ({ ...x, faq: x.faq.filter((_, j) => j !== i) }))}>Remove</button>
            </div>
          ))}
          {form.faq.length < 10 && (
            <button type="button" className="text-sm text-primary" onClick={() => setForm((f) => ({ ...f, faq: [...f.faq, { q: '', a: '' }] }))}>+ Add a question</button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 max-w-md">
          <div>
            <label className="block text-xs font-medium mb-1">Hide from Google below this many available products</label>
            <input className={inputCls} type="number" min={1} max={50} value={form.min_products} onChange={(e) => setForm((f) => ({ ...f, min_products: Number(e.target.value) }))} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">…or below this many intro words</label>
            <input className={inputCls} type="number" min={0} max={1000} value={form.min_intro_words} onChange={(e) => setForm((f) => ({ ...f, min_intro_words: Number(e.target.value) }))} />
          </div>
        </div>

        {error && <div className="text-destructive text-sm">{error}</div>}
        {note && <div className="text-sm text-green-700">{note}</div>}
        {warnings.length > 0 && <ul className="text-sm text-amber-700 list-disc pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        <div className="flex flex-wrap gap-2">
          <button className={btnPrimary} onClick={() => save('published')} disabled={saving}>{form.id ? 'Save & publish' : 'Publish'}</button>
          <button className={btnGhost} onClick={() => save('draft')} disabled={saving}>Save as draft</button>
          <button className={btnGhost} onClick={reset} disabled={saving}>{form.id ? 'Cancel edit' : 'Clear'}</button>
        </div>
      </div>

      {current && (
        <button className="mt-3 text-sm text-destructive" onClick={() => remove(current)}>Delete this collection</button>
      )}
    </Panes>
  )
}


// ---------------------------------------------------------------- Redirects

interface Redirect { id: string; from_path: string; to_path: string; source: 'manual' | 'auto'; note: string | null; created_at: string }

function RedirectsSection() {
  const [rows, setRows] = useState<Redirect[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Redirect | null>(null)

  const load = useCallback(async () => {
    const res = await apiFetch('/api/website-seo/redirects')
    if (res.ok) setRows(await res.json())
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const add = async () => {
    setError('')
    setSaving(true)
    const res = await apiFetch('/api/website-seo/redirects', { method: 'POST', body: JSON.stringify({ from_path: from, to_path: to, note }) })
    if (res.ok) { setFrom(''); setTo(''); setNote(''); await load(); setOpen(false) }
    else setError(await errorOf(res, 'Failed to save redirect'))
    setSaving(false)
  }

  const remove = async (r: Redirect) => {
    if (!confirm(`Stop redirecting ${r.from_path}? That address will show "not found" again.`)) return
    await apiFetch(`/api/website-seo/redirects?id=${r.id}`, { method: 'DELETE' })
    setSelected(null)
    setOpen(false)
    await load()
  }

  const startNew = () => { setSelected(null); setFrom(''); setTo(''); setNote(''); setError(''); setOpen(true) }

  return (
    <Panes
      bp="xl"
      open={open}
      onBack={() => setOpen(false)}
      backLabel="Back to redirects"
      list={
        <div>
          <ListHeader title={`${rows.length} redirect${rows.length === 1 ? '' : 's'}`} onNew={startNew} />
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No redirects yet. Use “+ New”.</p>
          ) : (
            <div className="space-y-1">
              {rows.map((r) => (
                <ListItem
                  key={r.id}
                  selected={selected?.id === r.id}
                  onClick={() => { setSelected(r); setOpen(true) }}
                  title={r.from_path}
                  sub={`→ ${r.to_path}`}
                  right={<Pill tone={r.source === 'auto' ? 'gray' : 'green'}>{r.source === 'auto' ? 'auto' : 'manual'}</Pill>}
                />
              ))}
            </div>
          )}
        </div>
      }
    >
      <p className="text-sm text-muted-foreground mb-4">
        Send an old address to a live page so visitors and Google follow it instead of hitting &quot;not found&quot;. Changing a
        published product&apos;s web address creates one automatically. These work for the home-level addresses the website
        already routes (a product, a category, a blog post or a single-segment page such as /service), not arbitrary
        deep paths.
      </p>

      {selected ? (
        <div className="space-y-2 rounded-lg border p-4 text-sm">
          <div><span className="text-muted-foreground">Old address</span><div className="break-all font-medium">{selected.from_path}</div></div>
          <div><span className="text-muted-foreground">Sends visitors to</span><div className="break-all font-medium">{selected.to_path}</div></div>
          <div className="text-xs text-muted-foreground">
            {selected.source === 'auto' ? 'Created automatically' : 'Added manually'} on {new Date(selected.created_at).toLocaleDateString()}
            {selected.note ? ` · ${selected.note}` : ''}
          </div>
          <button className="text-sm text-destructive" onClick={() => remove(selected)}>Stop redirecting</button>
        </div>
      ) : (
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">Old address</label>
            <input className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="/service" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Send visitors to</label>
            <input className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} placeholder="/contact" />
          </div>
        </div>
        <div className="mt-3">
          <label className="block text-xs font-medium mb-1">Note (optional)</label>
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <div className="text-destructive text-sm mt-2">{error}</div>}
        <button className={`${btnPrimary} mt-3`} onClick={add} disabled={saving || !from.trim() || !to.trim()}>
          {saving ? 'Saving…' : 'Add redirect'}
        </button>
      </div>

      )}
    </Panes>
  )
}


// ---------------------------------------------------------------- Images

interface ImageRow {
  id: string
  sku_id: string
  storage_path: string
  alt_text: string | null
  sku_master: { full_sku_code: string; brand: string | null; model_name: string | null; web_title: string | null }
}

function ImagesSection() {
  const [rows, setRows] = useState<ImageRow[]>([])
  const [alts, setAlts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const res = await apiFetch('/api/website-seo/images')
    if (res.ok) setRows(await res.json())
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const [filling, setFilling] = useState(false)
  const [fillMsg, setFillMsg] = useState('')

  const fillAll = async () => {
    setError(''); setFillMsg('')
    const dry = await apiFetch('/api/website-seo/images/bulk-fill', { method: 'POST', body: JSON.stringify({ dry_run: true }) })
    if (!dry.ok) { setError(await errorOf(dry, 'Could not count photos')); return }
    const { would_update } = await dry.json()
    if (!would_update) { setFillMsg('Nothing to fill.'); return }
    if (!confirm(`Give ${would_update} photos a default description ("product name - photo N of M")? Photos that already have alt text are left alone.`)) return
    setFilling(true)
    const res = await apiFetch('/api/website-seo/images/bulk-fill', { method: 'POST', body: JSON.stringify({}) })
    if (res.ok) { const d = await res.json(); setFillMsg(`Filled ${d.updated} photos.`); await load() }
    else setError(await errorOf(res, 'Bulk fill failed'))
    setFilling(false)
  }

  const suggestion = (r: ImageRow) =>
    [r.sku_master.brand, r.sku_master.model_name].filter(Boolean).join(' ') || r.sku_master.full_sku_code

  const save = async (r: ImageRow) => {
    const alt = (alts[r.id] ?? '').trim()
    if (!alt) return
    setBusy(r.id)
    setError('')
    const res = await apiFetch(`/api/sku-master/${r.sku_id}/images/${r.id}`, { method: 'PATCH', body: JSON.stringify({ alt_text: alt }) })
    if (res.ok) await load()
    else setError(await errorOf(res, 'Failed to save alt text'))
    setBusy(null)
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        Photos of published products that have no description for screen readers and image search. Describe what the photo
        shows (&quot;Dell Latitude 5410 laptop, open, front view&quot;), not just the product name. Showing the first 100.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button className={btnGhost} onClick={fillAll} disabled={filling}>{filling ? 'Filling…' : 'Fill all missing with a default'}</button>
        {fillMsg && <span className="text-sm text-green-700">{fillMsg}</span>}
      </div>
      {error && <div className="text-destructive text-sm mb-2">{error}</div>}
      {loading ? <div className="text-sm text-muted-foreground">Loading…</div> : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">Every published photo has alt text.</div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="flex gap-3 items-start border rounded-lg p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={publicImageUrl(r.storage_path)} alt="" className="h-16 w-16 rounded object-contain bg-muted shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground mb-1">{r.sku_master.full_sku_code}</div>
                <input
                  className={inputCls}
                  value={alts[r.id] ?? ''}
                  onChange={(e) => setAlts((a) => ({ ...a, [r.id]: e.target.value }))}
                  placeholder={`e.g. ${suggestion(r)}, front view`}
                />
              </div>
              <button className={btnPrimary} onClick={() => save(r)} disabled={busy === r.id || !(alts[r.id] ?? '').trim()}>
                Save
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- History

interface Revision { id: string; entity_type: string; entity_key: string; action: string; created_at: string; snapshot: Record<string, unknown> }

function HistorySection() {
  const [rows, setRows] = useState<Revision[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Revision | null>(null)

  const load = useCallback(async () => {
    const res = await apiFetch('/api/website-seo/revisions')
    if (res.ok) setRows(await res.json())
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const restore = async (r: Revision) => {
    if (!confirm('Put this saved version back? The current version is kept in History so you can undo this.')) return
    setError(''); setMessage('')
    const res = await apiFetch('/api/website-seo/revisions', { method: 'POST', body: JSON.stringify({ id: r.id }) })
    if (res.ok) { setMessage('Restored.'); await load() } else setError(await errorOf(res, 'Failed to restore'))
  }

  const summary = (r: Revision) => {
    const s = r.snapshot as Record<string, any>
    if (r.entity_type === 'redirect') return `${s.from_path} → ${s.to_path}`
    if (r.entity_type === 'site_profile') return 'Company & About details'
    if (r.entity_type === 'collection') return s.name || s.slug || '—'
    if (r.entity_type === 'override') return s.meta_title || s.meta_description || (s.robots_index === false ? 'hidden from search' : '—')
    return s.default_description || s.product_description_template || '—'
  }

  const lines = (r: Revision) =>
    Object.entries(r.snapshot as Record<string, any>)
      .filter(([k, v]) => v !== null && v !== '' && !['id', 'created_at', 'updated_at', 'updated_by', 'created_by'].includes(k))
      .map(([k, v]) => [k.replace(/_/g, ' '), typeof v === 'object' ? JSON.stringify(v) : String(v)] as const)

  return (
    <Panes
      bp="xl"
      open={open}
      onBack={() => setOpen(false)}
      backLabel="Back to history"
      list={
        <div>
          <ListHeader title={`${rows.length} saved version${rows.length === 1 ? '' : 's'}`} />
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
          ) : (
            <div className="space-y-1">
              {rows.map((r) => (
                <ListItem
                  key={r.id}
                  selected={selected?.id === r.id}
                  onClick={() => { setSelected(r); setOpen(true); setMessage(''); setError('') }}
                  title={`${r.entity_type}: ${r.entity_key}`}
                  sub={`${new Date(r.created_at).toLocaleString()} · ${summary(r)}`}
                  right={<Pill tone={r.action === 'delete' ? 'red' : 'gray'}>{r.action === 'delete' ? 'removed' : 'edited'}</Pill>}
                />
              ))}
            </div>
          )}
        </div>
      }
    >
      <p className="text-sm text-muted-foreground mb-4">
        Each entry is the version a page had <b>before</b> it was changed or removed. Restore puts that version back.
      </p>
      {error && <div className="text-destructive text-sm mb-2">{error}</div>}
      {message && <div className="text-green-700 text-sm mb-2">{message}</div>}
      {selected ? (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="text-sm font-medium">{selected.entity_type}: {selected.entity_key}</div>
          <dl className="space-y-1 text-sm">
            {lines(selected).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs capitalize text-muted-foreground">{k}</dt>
                <dd className="break-words">{v}</dd>
              </div>
            ))}
          </dl>
          <button className={btnPrimary} onClick={() => restore(selected)}>Restore this version</button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Choose a saved version on the left.</p>
      )}
    </Panes>
  )
}


// ---------------------------------------------------------------- Shell

export default function WebsiteSeoManager() {
  const [tab, setTab] = useState<TabKey>('overview')
  const [open, setOpen] = useState(false)

  const go = (t: TabKey) => { setTab(t); setOpen(true) }

  return (
    <Panes
      bp="md"
      open={open}
      onBack={() => setOpen(false)}
      backLabel="Back to Website SEO"
      list={<NavList entries={NAV} active={tab} onSelect={(k) => go(k as TabKey)} />}
    >
      <h3 className="mb-3 text-base font-semibold">{NAV.find((n) => n.key === tab)?.label}</h3>
      {tab === 'overview' && <OverviewSection go={go} />}
      {tab === 'suggestions' && <SuggestionsSection go={go} />}
      {tab === 'google' && <GoogleSetupSection />}
      {tab === 'defaults' && <DefaultsSection />}
      {tab === 'overrides' && <OverridesSection />}
      {tab === 'collections' && <CollectionsSection />}
      {tab === 'keywords' && <KeywordsSection />}
      {tab === 'redirects' && <RedirectsSection />}
      {tab === 'images' && <ImagesSection />}
      {tab === 'crawl' && <CrawlSection />}
      {tab === 'competitors' && <CompetitorsSection go={go} />}
      {tab === 'history' && <HistorySection />}
    </Panes>
  )
}

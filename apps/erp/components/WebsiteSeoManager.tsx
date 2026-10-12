'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

// Owner-only Settings -> Website SEO. Everything here is stored in the seo_*
// tables (migration 20261015) and read by apps/web through public_seo_* views,
// so a change shows up on the storefront within its 60 s revalidate window.
// Enforcement is in app/api/website-seo/** (isOwner); this component is UX only.

const SITE = 'https://www.digitalbluez.com'

type TabKey = 'overview' | 'defaults' | 'overrides' | 'redirects' | 'images' | 'history'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'defaults', label: 'Site defaults' },
  { key: 'overrides', label: 'Page metadata' },
  { key: 'redirects', label: 'Redirects' },
  { key: 'images', label: 'Image alt text' },
  { key: 'history', label: 'History' },
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
      if (!(d.warnings ?? []).length) reset()
    } else {
      setError(await errorOf(res, 'Failed to save'))
    }
    setSaving(false)
  }

  const remove = async (o: Override) => {
    if (!confirm(`Remove the override for ${o.entity_type}: ${o.entity_key}? You can restore it from History.`)) return
    await apiFetch(`/api/website-seo/overrides?id=${o.id}`, { method: 'DELETE' })
    await load()
  }

  const shownTitle = form.meta_title || '(page title as built by the website)'
  const shownDesc = form.meta_description || '(description as built by the website)'

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        Override how one page appears in search results, or flip it between indexed and hidden. Only <b>Published</b> overrides
        reach the website. Product titles and descriptions normally come from the SKU&apos;s Website dialog — use this when you
        want a search-specific wording without touching the product itself.
      </p>

      <div className="border rounded-lg p-4 mb-4 space-y-3">
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

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">No overrides yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-2">Updated</th><th className="p-2">Applies to</th><th className="p-2">Title</th>
                <th className="p-2">Search engines</th><th className="p-2">Status</th><th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="p-2 whitespace-nowrap">{new Date(o.updated_at).toLocaleDateString()}</td>
                  <td className="p-2"><span className="text-muted-foreground">{o.entity_type}:</span> {o.entity_type === 'product' ? o.entity_key.slice(0, 8) + '…' : o.entity_key}</td>
                  <td className="p-2 max-w-[16rem] truncate">{o.meta_title || '—'}</td>
                  <td className="p-2">{o.robots_index === null ? 'default' : o.robots_index ? 'allow' : 'hidden'}</td>
                  <td className="p-2">{o.status}</td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <button className="text-primary mr-3" onClick={() => edit(o)}>Edit</button>
                    <button className="text-destructive" onClick={() => remove(o)}>Remove</button>
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
    if (res.ok) { setFrom(''); setTo(''); setNote(''); await load() }
    else setError(await errorOf(res, 'Failed to save redirect'))
    setSaving(false)
  }

  const remove = async (r: Redirect) => {
    if (!confirm(`Stop redirecting ${r.from_path}? That address will show "not found" again.`)) return
    await apiFetch(`/api/website-seo/redirects?id=${r.id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        Send an old address to a live page so visitors and Google follow it instead of hitting &quot;not found&quot;. Changing a
        published product&apos;s web address creates one automatically. These work for the home-level addresses the website
        already routes (a product, a category, a blog post or a single-segment page such as /service), not arbitrary
        deep paths.
      </p>
      <div className="border rounded-lg p-4 mb-4">
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

      {loading ? <div className="text-sm text-muted-foreground">Loading…</div> : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">No redirects yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr><th className="p-2">Created</th><th className="p-2">From</th><th className="p-2">To</th><th className="p-2">Source</th><th className="p-2" /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2 whitespace-nowrap">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td className="p-2 break-all">{r.from_path}</td>
                  <td className="p-2 break-all">{r.to_path}</td>
                  <td className="p-2">{r.source === 'auto' ? 'automatic' : 'manual'}</td>
                  <td className="p-2 text-right"><button className="text-destructive" onClick={() => remove(r)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
    if (r.entity_type === 'override') return s.meta_title || s.meta_description || (s.robots_index === false ? 'hidden from search' : '—')
    return s.default_description || s.product_description_template || '—'
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        Each row is the version a page had <b>before</b> it was changed or removed. Restore puts that version back.
      </p>
      {error && <div className="text-destructive text-sm mb-2">{error}</div>}
      {message && <div className="text-green-700 text-sm mb-2">{message}</div>}
      {loading ? <div className="text-sm text-muted-foreground">Loading…</div> : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">No changes recorded yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr><th className="p-2">When</th><th className="p-2">What</th><th className="p-2">Earlier version</th><th className="p-2">Change</th><th className="p-2" /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="p-2"><span className="text-muted-foreground">{r.entity_type}:</span> {r.entity_key}</td>
                  <td className="p-2 max-w-[18rem] truncate">{summary(r)}</td>
                  <td className="p-2">{r.action === 'delete' ? 'removed' : 'edited'}</td>
                  <td className="p-2 text-right"><button className="text-primary" onClick={() => restore(r)}>Restore</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Shell

export default function WebsiteSeoManager() {
  const [tab, setTab] = useState<TabKey>('overview')

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto border-b mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${
              tab === t.key ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewSection go={setTab} />}
      {tab === 'defaults' && <DefaultsSection />}
      {tab === 'overrides' && <OverridesSection />}
      {tab === 'redirects' && <RedirectsSection />}
      {tab === 'images' && <ImagesSection />}
      {tab === 'history' && <HistorySection />}
    </div>
  )
}

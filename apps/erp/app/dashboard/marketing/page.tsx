'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import RequirePageAccess from '@/components/RequirePageAccess'
import { useRole } from '@/lib/auth/useRole'
import { useCustomOptions } from '@/lib/useCustomOptions'
import { SearchableSelect } from '@/components/SearchableSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorBanner } from '@/components/ErrorBanner'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { MARKETING_ASSET_STATUS_TONES, toneFor } from '@db/shared'
import { Copy, Download, MessageCircle, Loader2, Sparkles, Share2, ImageOff, Save, Star } from 'lucide-react'

// A trimmed shape of lib/marketing/product-data.ts's MarketingProduct -- just what the
// browse grid (Today's Picks) and the Single Product search picker need to render.
interface PickProduct {
  id: string; brand: string | null; model_name: string | null; full_sku_code: string
  category: string; display_title: string; config_summary: string; config_diff: string
  web_price: number; primary_image_path: string | null; available_count?: number
}
interface MarketingAsset {
  id: string; kind: string; platform: string; format: string; title: string | null
  body_text: string | null; hashtags: string[]; cta_text: string | null; status: string
  source_sku_ids: string[]; scheduled_for: string | null; created_at: string
}
interface GeneratedProduct { id: string; primary_image_path: string | null }

const PLATFORMS = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'google_business', label: 'Google Business Profile' },
]
const CARD_FORMATS = [
  { value: 'wa_square', label: 'WhatsApp Square (1080x1080)' },
  { value: 'ig_portrait', label: 'Instagram Portrait (1080x1350)' },
  { value: 'ig_story', label: 'Instagram Story (1080x1920)' },
  { value: 'fb_link', label: 'Facebook Link (1200x630)' },
]

function productImageUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images/${path}`
}

function ProductThumb({ path, size = 56 }: { path: string | null; size?: number }) {
  if (!path) {
    return (
      <div className="flex items-center justify-center bg-muted rounded text-muted-foreground shrink-0" style={{ width: size, height: size }}>
        <ImageOff className="w-4 h-4" />
      </div>
    )
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={productImageUrl(path)} alt="" className="rounded border object-cover shrink-0" style={{ width: size, height: size }} />
}

// Groups Today's Picks' grid by brand, ascending -- Apple, then its items, then Dell,
// and so on -- matching the same grouping buildProductListWhatsAppMessage applies to
// the generated broadcast, so browsing here reads the same way the message will.
// /api/marketing/products already returns items brand-sorted, so this only needs to
// group adjacent-or-not entries under one heading per brand, not re-sort them.
function groupByBrand(products: PickProduct[]): [string, PickProduct[]][] {
  const groups = new Map<string, PickProduct[]>()
  for (const p of products) {
    const brand = p.brand || 'Other'
    const existing = groups.get(brand)
    if (existing) existing.push(p)
    else groups.set(brand, [p])
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
}

// Search-as-you-type over real current (live) stock, not the general SKU Master
// picker -- same findInStockProducts source Today's Picks and Product List use, so
// Single Product can promote any in-stock item over WhatsApp, not just published ones.
function useProductSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PickProduct[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      setLoading(true)
      const res = await apiFetch(`/api/marketing/products?search=${encodeURIComponent(query)}&limit=20`)
      if (res.ok) { const data = await res.json(); setResults(data.products || []) }
      setLoading(false)
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  return { query, setQuery, results, loading }
}

function NoPhotoWarning() {
  return (
    <p className="text-xs text-warning flex items-center gap-1">
      <ImageOff className="w-3.5 h-3.5" /> No photo uploaded for this item -- the card will be a plain color block.{' '}
      <a href="/dashboard/sku-master" className="underline">Upload one in SKU Master &rarr; Website</a>
    </p>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button" variant="outline" className="h-8"
      onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
    >
      <Copy className="w-3.5 h-3.5 mr-1.5" /> {copied ? 'Copied' : 'Copy text'}
    </Button>
  )
}

// Opens the OS's native share sheet with the photo and text handed over together in
// one action, when the browser supports the Web Share API's file-sharing capability
// (mainly mobile Chrome/Safari) -- same picker WhatsApp/Instagram/etc. all register
// into, so this is not "share to self," just a way to avoid the manual
// attach-the-photo-after-opening-the-chat step that the wa.me link alone can't avoid.
// Hidden entirely (not shown disabled) on browsers that don't support it, e.g. most desktop.
function ShareButton({ text, skuId }: { text: string; skuId?: string }) {
  const [supported, setSupported] = useState(false)
  useEffect(() => { setSupported(typeof navigator !== 'undefined' && typeof navigator.share === 'function') }, [])

  const { run, pending } = useAsyncAction(async () => {
    let files: File[] = []
    if (skuId) {
      try {
        const res = await apiFetch(`/api/marketing/card?sku_id=${skuId}&format=wa_square`)
        if (res.ok) {
          const blob = await res.blob()
          files = [new File([blob], 'product.png', { type: 'image/png' })]
        }
      } catch {
        // fall through to text-only share
      }
    }
    const shareData: ShareData = files.length && navigator.canShare?.({ files }) ? { text, files } : { text }
    try {
      await navigator.share(shareData)
    } catch {
      // user cancelled the share sheet -- not an error
    }
  })

  if (!supported) return null
  return (
    <Button type="button" variant="outline" className="h-8" onClick={() => run()} disabled={pending}>
      {pending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5 mr-1.5" />} Share
    </Button>
  )
}

function CardDownloadButton({ skuId, label, hasPhoto }: { skuId: string; label: string; hasPhoto: boolean }) {
  const [format, setFormat] = useState('wa_square')
  const { run, pending } = useAsyncAction(async () => {
    const res = await apiFetch(`/api/marketing/card?sku_id=${skuId}&format=${format}`)
    if (!res.ok) { alert('Card rendering failed'); return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${label.replace(/\s+/g, '-').toLowerCase()}-${format}.png`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  })
  return (
    <div className="space-y-1.5">
      {!hasPhoto && <NoPhotoWarning />}
      <div className="flex items-center gap-2">
        <Select value={format} onValueChange={setFormat}>
          <SelectTrigger className="h-8 w-64"><SelectValue /></SelectTrigger>
          <SelectContent>{CARD_FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
        </Select>
        <Button type="button" variant="outline" className="h-8" onClick={() => run()} disabled={pending}>
          {pending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1.5" />} Download card
        </Button>
      </div>
    </div>
  )
}

function GeneratedResult({ asset, whatsappShareLink, product }: { asset: MarketingAsset; whatsappShareLink?: string; product?: GeneratedProduct }) {
  const { isOwner } = useRole()
  const skuId = asset.source_sku_ids?.[0]
  const [body, setBody] = useState(asset.body_text || '')
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle')
  const dirty = body !== (asset.body_text || '')

  const { run: save, pending: saving } = useAsyncAction(async () => {
    const res = await apiFetch(`/api/marketing/assets/${asset.id}`, { method: 'PATCH', body: JSON.stringify({ body_text: body }) })
    if (res.ok) { setSaveState('saved'); setTimeout(() => setSaveState('idle'), 1500) }
  })

  const { run: saveFlavorLine, pending: savingFlavorLine } = useAsyncAction(async () => {
    const line = window.prompt('Save this as a WhatsApp flavor line (shown in future 💫 bullets):', '')
    if (!line || !line.trim()) return
    const current = await apiFetch('/api/settings/marketing')
    if (!current.ok) { alert('Only the owner can update Marketing settings.'); return }
    const settings = await current.json()
    const nextLines = [...(settings.whatsapp_flavor_lines || []), line.trim()]
    await apiFetch('/api/settings/marketing', { method: 'PUT', body: JSON.stringify({ whatsapp_flavor_lines: nextLines }) })
    alert('Saved -- it will show up in future WhatsApp generations.')
  })

  return (
    <Card className="mt-4">
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold">{asset.title}</div>
          <StatusBadge tone={toneFor(MARKETING_ASSET_STATUS_TONES, asset.status)}>{asset.status}</StatusBadge>
        </div>
        {product && !product.primary_image_path && <NoPhotoWarning />}
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="font-mono text-sm" />
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" className="h-7" disabled={!dirty || saving} onClick={() => save()}>
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
            {saveState === 'saved' ? 'Saved' : 'Save edits'}
          </Button>
          {asset.platform === 'whatsapp' && isOwner && (
            <Button type="button" size="sm" variant="ghost" className="h-7 text-muted-foreground" disabled={savingFlavorLine} onClick={() => saveFlavorLine()}>
              <Star className="w-3.5 h-3.5 mr-1.5" /> Save as flavor line
            </Button>
          )}
        </div>
        {asset.hashtags?.length > 0 && (
          <div className="text-sm text-muted-foreground">{asset.hashtags.map((h) => `#${h}`).join(' ')}</div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton text={[body, asset.hashtags?.length ? asset.hashtags.map((h) => `#${h}`).join(' ') : null].filter(Boolean).join('\n\n')} />
          {whatsappShareLink && (
            <a href={whatsappShareLink} target="_blank" rel="noreferrer">
              <Button type="button" variant="outline" className="h-8"><MessageCircle className="w-3.5 h-3.5 mr-1.5" /> Open in WhatsApp</Button>
            </a>
          )}
          <ShareButton text={body} skuId={skuId} />
        </div>
        {/* Card download is per-SKU (photo + spec) -- a product_list broadcast covers many
            SKUs (often not all published, since findInStockProducts isn't publish-gated)
            with no single "the" card to represent it, so this only shows for single_product. */}
        {asset.kind === 'single_product' && skuId && (
          <CardDownloadButton skuId={skuId} label={asset.title || 'product'} hasPhoto={!!product?.primary_image_path} />
        )}
      </CardContent>
    </Card>
  )
}

// Browse + multi-select over real current (live) stock -- replaces the old fixed
// P1-P4 priority-bucket suggestion engine (lib/marketing/suggest.ts, removed
// 2026-09-11): the owner wanted to hand-pick items directly instead. Same
// category/brand/CPU filters as Product List. Nothing ticked -> "Generate WhatsApp"
// covers every item currently matching the filters (same as Product List's own bulk
// generation); ticking specific items scopes generation to exactly those. Ticking 2+
// items also enables a photo collage (one photo per selected item).
function TodaysPicksTab() {
  const [category, setCategory] = useState('LAP')
  const [brand, setBrand] = useState('')
  const [cpu, setCpu] = useState('')
  const [theme, setTheme] = useState('')
  const [inStockOnly, setInStockOnly] = useState(true)
  const [products, setProducts] = useState<PickProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<{ asset: MarketingAsset; whatsapp_share_link?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { values: brandOptions } = useCustomOptions('brand')
  const { values: cpuOptions } = useCustomOptions('cpu')

  const load = async () => {
    setLoading(true); setLoadError(null)
    const params = new URLSearchParams({ in_stock: String(inStockOnly) })
    if (category.trim()) params.set('category', category.trim())
    if (brand.trim()) params.set('brand', brand.trim())
    if (cpu.trim()) params.set('cpu', cpu.trim())
    const res = await apiFetch(`/api/marketing/products?${params}`)
    const data = await res.json()
    if (!res.ok) { setLoadError(data.error || 'Failed to load'); setProducts([]) }
    else setProducts(data.products || [])
    setLoading(false)
  }
  useEffect(() => { load(); setSelected(new Set()) }, [category, brand, cpu, inStockOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const { run: generate, pending: generating } = useAsyncAction(async () => {
    setError(null); setResult(null)
    const ids = [...selected]
    const filter: Record<string, any> = ids.length > 0
      ? { skuIds: ids, inStockOnly }
      : { category: category || undefined, brand: brand || undefined, spec: cpu ? { cpu } : undefined, inStockOnly }
    const themeParts = ids.length > 0 ? [] : [brand, cpu, category].filter(Boolean)
    const autoTheme = ids.length > 0 ? `${ids.length} Selected Item${ids.length > 1 ? 's' : ''}` : `${themeParts.join(' ')} in stock`
    const res = await apiFetch('/api/marketing/generate', {
      method: 'POST',
      body: JSON.stringify({ mode: 'product_list', theme: theme.trim() || autoTheme, filter }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Generation failed'); return }
    setResult(data)
  })

  const { run: downloadCollage, pending: collaging } = useAsyncAction(async () => {
    const ids = [...selected]
    const res = await apiFetch(`/api/marketing/collage?sku_ids=${ids.join(',')}&format=wa_square`)
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Collage generation failed'); return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `collage-${ids.length}-items.png`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  })

  const selectedList = [...selected]
  const singleSelectedProduct = selectedList.length === 1 ? products.find((p) => p.id === selectedList[0]) : undefined

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Browse what's actually in stock right now. Tick items to hand-pick a broadcast -- leave nothing ticked to generate for everything matching the filters below. Tick 2 or more to also download a photo collage.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl">
        <div>
          <label className="text-sm font-medium mb-1 block">Category code</label>
          <Input value={category} onChange={(e) => setCategory(e.target.value.toUpperCase())} placeholder="LAP" />
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Brand</label>
          <div className="flex gap-1">
            <div className="flex-1"><SearchableSelect options={brandOptions} value={brand} onChange={setBrand} placeholder="Any brand" /></div>
            {brand && <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => setBrand('')}>Clear</Button>}
          </div>
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">CPU</label>
          <div className="flex gap-1">
            <div className="flex-1"><SearchableSelect options={cpuOptions} value={cpu} onChange={setCpu} placeholder="Any CPU" /></div>
            {cpu && <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => setCpu('')}>Clear</Button>}
          </div>
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Broadcast theme (optional)</label>
          <Input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="All Dell i5 laptops in stock" />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : loadError ? (
        <ErrorBanner message={loadError} />
      ) : products.length === 0 ? (
        <p className="text-sm text-muted-foreground">No items in stock match these filters.</p>
      ) : (
        // Grouped and ascending-sorted by brand -- Apple, then its items, then Dell, and
        // so on -- matching how the generated WhatsApp message itself is grouped
        // (buildProductListWhatsAppMessage), so picking here reads the same way the
        // broadcast it produces will.
        <div className="space-y-4">
          {groupByBrand(products).map(([brandName, items]) => (
            <div key={brandName}>
              <h4 className="text-sm font-semibold mb-1.5">{brandName}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {items.map((p) => {
                  const isSelected = selected.has(p.id)
                  return (
                    <button
                      type="button" key={p.id} onClick={() => toggle(p.id)}
                      className={`text-left border rounded-md p-2 flex gap-2 items-center ${isSelected ? 'border-primary ring-1 ring-primary bg-primary/5' : ''}`}
                    >
                      <Checkbox checked={isSelected} onCheckedChange={() => toggle(p.id)} />
                      <ProductThumb path={p.primary_image_path} />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate">{p.display_title}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{p.config_summary || p.config_diff || '\u00a0'}</div>
                        {(p.available_count ?? 0) > 1 && <div className="text-[11px] text-muted-foreground">{p.available_count} in stock</div>}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => generate()} disabled={generating || products.length === 0} className="h-8">
          {generating ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
          Generate WhatsApp {selected.size > 0 ? `(${selected.size} selected)` : '(all filtered)'}
        </Button>
        {selected.size >= 2 && (
          <Button onClick={() => downloadCollage()} disabled={collaging} variant="outline" className="h-8">
            {collaging ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1.5" />} Download collage ({selected.size} photos)
          </Button>
        )}
        {singleSelectedProduct && (
          <CardDownloadButton skuId={singleSelectedProduct.id} label={singleSelectedProduct.display_title} hasPhoto={!!singleSelectedProduct.primary_image_path} />
        )}
      </div>

      {error && <ErrorBanner message={error} />}
      {result && <GeneratedResult asset={result.asset} whatsappShareLink={result.whatsapp_share_link} />}
    </div>
  )
}

function SingleProductTab() {
  const { query, setQuery, results, loading } = useProductSearch()
  const [selected, setSelected] = useState<PickProduct | null>(null)
  const [platform, setPlatform] = useState('whatsapp')
  const [result, setResult] = useState<{ asset: MarketingAsset; whatsapp_share_link?: string; product?: GeneratedProduct } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { run: generate, pending } = useAsyncAction(async () => {
    if (!selected) return
    setError(null); setResult(null)
    const res = await apiFetch('/api/marketing/generate', {
      method: 'POST',
      body: JSON.stringify({ mode: 'single_product', platform, sku_id: selected.id }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Generation failed'); return }
    setResult(data)
  })

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <label className="text-sm font-medium mb-1 block">Product (current stock)</label>
        <p className="text-xs text-muted-foreground mb-1">WhatsApp works for any in-stock item. Instagram/Facebook/Google Business Profile need the item published on the website first (they include a product link).</p>
        <Input value={query} onChange={(e) => { setQuery(e.target.value); setSelected(null) }} placeholder="Search by brand, model, or SKU code..." />
        {loading && <p className="text-xs text-muted-foreground mt-1">Searching...</p>}
        {!selected && results.length > 0 && (
          <div className="border rounded-md mt-1 max-h-56 overflow-y-auto">
            {results.map((r) => (
              <button
                key={r.id} type="button" onClick={() => { setSelected(r); setQuery(r.display_title) }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
              >
                <ProductThumb path={r.primary_image_path} size={32} />
                <span className="min-w-0 truncate">{r.display_title}</span>
                <span className="text-muted-foreground ml-auto shrink-0">{r.full_sku_code}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        <label className="text-sm font-medium mb-1 block">Platform</label>
        <Select value={platform} onValueChange={setPlatform}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>{PLATFORMS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <Button onClick={() => generate()} disabled={!selected || pending} className="h-8">
        {pending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null} Generate
      </Button>
      {error && <ErrorBanner message={error} />}
      {result && <GeneratedResult asset={result.asset} whatsappShareLink={result.whatsapp_share_link} product={result.product} />}
    </div>
  )
}

function BlogTab() {
  const [topic, setTopic] = useState('')
  const [category, setCategory] = useState('LAP')
  const [result, setResult] = useState<{ asset: MarketingAsset } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle')

  const { run: generate, pending } = useAsyncAction(async () => {
    if (!topic.trim()) return
    setError(null); setResult(null)
    const res = await apiFetch('/api/marketing/generate', {
      method: 'POST',
      body: JSON.stringify({ mode: 'blog', topic, filter: { category, inStockOnly: true } }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Generation failed'); return }
    setResult(data)
    setBody(data.asset.body_text || '')
  })

  const { run: save, pending: saving } = useAsyncAction(async () => {
    if (!result) return
    const res = await apiFetch(`/api/marketing/assets/${result.asset.id}`, { method: 'PATCH', body: JSON.stringify({ body_text: body }) })
    if (res.ok) { setSaveState('saved'); setTimeout(() => setSaveState('idle'), 1500) }
  })

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <label className="text-sm font-medium mb-1 block">Topic</label>
        <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Best i5 laptops under ₹25,000" />
      </div>
      <div>
        <label className="text-sm font-medium mb-1 block">Ground in category (optional)</label>
        <Input value={category} onChange={(e) => setCategory(e.target.value.toUpperCase())} placeholder="LAP" />
      </div>
      <Button onClick={() => generate()} disabled={!topic.trim() || pending} className="h-8">
        {pending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null} Generate draft
      </Button>
      {error && <ErrorBanner message={error} />}
      {result && (
        <Card className="mt-4">
          <CardContent className="pt-6 space-y-3">
            <div className="font-semibold">{result.asset.title}</div>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={16} className="font-mono text-sm" />
            <Button type="button" size="sm" variant="outline" className="h-7" disabled={body === (result.asset.body_text || '') || saving} onClick={() => save()}>
              {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
              {saveState === 'saved' ? 'Saved' : 'Save edits'}
            </Button>
            <p className="text-xs text-muted-foreground">Saved as a draft. Publishing a blog post live is a Phase 2 feature -- not yet available from this screen.</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function DraftsTab() {
  const { canEditPage } = useRole()
  const [assets, setAssets] = useState<MarketingAsset[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const res = await apiFetch('/api/marketing/assets')
    if (res.ok) setAssets(await res.json())
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const setStatus = async (id: string, status: string) => {
    await apiFetch(`/api/marketing/assets/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
    load()
  }
  const remove = async (id: string) => {
    if (!confirm('Delete this draft?')) return
    await apiFetch(`/api/marketing/assets/${id}`, { method: 'DELETE' })
    load()
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>
  if (assets.length === 0) return <p className="text-sm text-muted-foreground">No content generated yet.</p>

  return (
    <div className="space-y-3">
      {assets.map((a) => (
        <Card key={a.id}>
          <CardContent className="pt-4 pb-4 flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{a.title || '(untitled)'}</span>
                <StatusBadge tone={toneFor(MARKETING_ASSET_STATUS_TONES, a.status)}>{a.status}</StatusBadge>
                <span className="text-xs text-muted-foreground">{a.platform} · {a.kind}</span>
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{a.body_text}</p>
            </div>
            {canEditPage('marketing') && (
              <div className="flex gap-2 shrink-0">
                {a.status === 'draft' && <Button size="sm" variant="outline" className="h-7" onClick={() => setStatus(a.id, 'approved')}>Approve</Button>}
                {a.status === 'approved' && <Button size="sm" variant="outline" className="h-7" onClick={() => setStatus(a.id, 'published')}>Mark published</Button>}
                <Button size="sm" variant="outline" className="h-7 text-destructive" onClick={() => remove(a.id)}>Delete</Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function MarketingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Marketing Content Studio</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generate WhatsApp content grounded in your real current stock -- Today's Picks covers everything Product List used to (filters, custom broadcast themes, bulk generation), plus browsing, multi-select, and a photo collage. Instagram/Facebook/blog content needs the item published on the website first, since those include a real product link -- specs and prices are always inserted from live data, never invented.
        </p>
      </div>
      <Tabs defaultValue="picks">
        <TabsList>
          <TabsTrigger value="picks">Today's Picks</TabsTrigger>
          <TabsTrigger value="single">Single Product</TabsTrigger>
          <TabsTrigger value="blog">Blog Draft</TabsTrigger>
          <TabsTrigger value="drafts">Drafts</TabsTrigger>
        </TabsList>
        <TabsContent value="picks"><TodaysPicksTab /></TabsContent>
        <TabsContent value="single"><SingleProductTab /></TabsContent>
        <TabsContent value="blog"><BlogTab /></TabsContent>
        <TabsContent value="drafts"><DraftsTab /></TabsContent>
      </Tabs>
    </div>
  )
}

export default function MarketingPageGuarded() {
  return (
    <RequirePageAccess pageKey="marketing">
      <MarketingPage />
    </RequirePageAccess>
  )
}

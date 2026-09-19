'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
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
import { Copy, Download, MessageCircle, Loader2, Sparkles, Share2, ImageOff, Save, Star, Calendar, Trash2, Plus } from 'lucide-react'

// A trimmed shape of lib/marketing/product-data.ts's MarketingProduct -- just what
// Today's Picks' browse grid and SKU search picker need to render.
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
interface FestivalEntry {
  id: string; name: string; festival_date: string; is_major: boolean
}

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

// Shows the generated card/collage PNG right in the ERP (not just a download link) so
// the photo and the WhatsApp text (already visible above, via Copy text) are both on
// screen together -- previously the only way to see the card at all was to blind-download
// it. /api/marketing/card and /api/marketing/collage are Bearer-authed routes, so a plain
// <img src> can't hit them directly; fetched as a blob via apiFetch (same as the download
// button always did) and shown from an object URL instead.
// `endpoint` is the full querystring-bearing path (sku_id=... for one item, sku_ids=...
// for a collage) minus the &format=, which this component appends itself per format
// selection -- callers don't need to know the two routes differ.
function CardPreview({ endpointBase, filenameBase, hasPhoto }: { endpointBase: string; filenameBase: string; hasPhoto: boolean }) {
  const [format, setFormat] = useState('wa_square')
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setLoading(true); setLoadError(null)
    apiFetch(`${endpointBase}&format=${format}`).then(async (res) => {
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        if (!cancelled) setLoadError(d.error || 'Card rendering failed')
        return
      }
      const blob = await res.blob()
      if (cancelled) return
      objectUrl = URL.createObjectURL(blob)
      setImgUrl(objectUrl)
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [endpointBase, format])

  const download = () => {
    if (!imgUrl) return
    const a = document.createElement('a')
    a.href = imgUrl; a.download = `${filenameBase.replace(/\s+/g, '-').toLowerCase()}-${format}.png`
    document.body.appendChild(a); a.click(); a.remove()
  }

  return (
    <div className="space-y-1.5">
      {!hasPhoto && <NoPhotoWarning />}
      <div className="flex items-center gap-2">
        <Select value={format} onValueChange={setFormat}>
          <SelectTrigger className="h-8 w-64"><SelectValue /></SelectTrigger>
          <SelectContent>{CARD_FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
        </Select>
        <Button type="button" variant="outline" className="h-8" onClick={download} disabled={!imgUrl}>
          <Download className="w-3.5 h-3.5 mr-1.5" /> Download
        </Button>
      </div>
      <div className="border rounded-md bg-muted/30 flex items-center justify-center overflow-hidden" style={{ maxWidth: 320, aspectRatio: '1 / 1' }}>
        {loading ? (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        ) : loadError ? (
          <p className="text-xs text-destructive p-3 text-center">{loadError}</p>
        ) : imgUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imgUrl} alt="Generated card preview" className="w-full h-full object-contain" />
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Long-press (mobile) or drag the image above into WhatsApp, then paste the copied text -- or use Share below on mobile to send both at once.
      </p>
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
        {/* Single item (single_product, or a product_list generated from exactly one
            ticked item in Today's Picks) -> its own photo+spec card. A product_list
            broadcast covering several SKUs -> a collage (one photo per item) instead,
            since there's no single "the" card to represent many different products. */}
        {asset.kind === 'single_product' && skuId && (
          <CardPreview endpointBase={`/api/marketing/card?sku_id=${skuId}`} filenameBase={asset.title || 'product'} hasPhoto={!!product?.primary_image_path} />
        )}
        {asset.kind === 'product_list' && asset.source_sku_ids?.length === 1 && (
          <CardPreview endpointBase={`/api/marketing/card?sku_id=${asset.source_sku_ids[0]}`} filenameBase={asset.title || 'product'} hasPhoto />
        )}
        {asset.kind === 'product_list' && asset.source_sku_ids?.length >= 2 && (
          <CardPreview endpointBase={`/api/marketing/collage?sku_ids=${asset.source_sku_ids.join(',')}`} filenameBase={asset.title || `${asset.source_sku_ids.length}-items`} hasPhoto />
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
// One selectable product row -- shared by the filtered browse grid, the free-text SKU
// search results, and the "Selected" summary strip below, so a picked item looks the
// same wherever it's shown.
function ProductRow({ product, isSelected, onToggle }: { product: PickProduct; isSelected: boolean; onToggle: () => void }) {
  return (
    <button
      type="button" onClick={onToggle}
      className={`text-left border rounded-md p-2 flex gap-2 items-center w-full ${isSelected ? 'border-primary ring-1 ring-primary bg-primary/5' : ''}`}
    >
      <Checkbox checked={isSelected} onCheckedChange={onToggle} />
      <ProductThumb path={product.primary_image_path} />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium truncate">{product.display_title}</div>
        <div className="text-[11px] text-muted-foreground truncate">{product.config_summary || product.config_diff || ' '}</div>
        {(product.available_count ?? 0) > 1 && <div className="text-[11px] text-muted-foreground">{product.available_count} in stock</div>}
        {(product.available_count ?? 0) === 0 && <div className="text-[11px] text-warning">Not in stock yet (on order)</div>}
      </div>
    </button>
  )
}

// A free-text search over the same underlying data as the browse grid (any active
// SKU, gated on inStockOnly the same way), so an item that doesn't happen to match the
// current category/brand/CPU filters -- or a specific model you already know the name
// of -- can still be found and ticked without changing the browse filters at all.
function SkuSearchPicker({ inStockOnly, selectedIds, onToggle }: { inStockOnly: boolean; selectedIds: Set<string>; onToggle: (p: PickProduct) => void }) {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<PickProduct[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (term.trim().length < 2) { setResults([]); return }
    setLoading(true)
    const t = setTimeout(async () => {
      const params = new URLSearchParams({ search: term.trim(), in_stock: String(inStockOnly), limit: '20' })
      const res = await apiFetch(`/api/marketing/products?${params}`)
      const data = await res.json().catch(() => ({}))
      setResults(res.ok ? (data.products || []) : [])
      setLoading(false)
    }, 300)
    return () => clearTimeout(t)
  }, [term, inStockOnly])

  return (
    <div className="max-w-md">
      <label className="text-sm font-medium mb-1 block">Search SKU by brand, model, or code</label>
      <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="e.g. Dell Latitude, i5, DBLAP..." />
      {loading && <p className="text-xs text-muted-foreground mt-1">Searching...</p>}
      {results.length > 0 && (
        <div className="border rounded-md mt-1 max-h-72 overflow-y-auto p-1 space-y-1">
          {results.map((p) => (
            <ProductRow key={p.id} product={p} isSelected={selectedIds.has(p.id)} onToggle={() => onToggle(p)} />
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-1">
        Ticking a result here adds it to your selection below -- it stays selected even after you search again or change the browse filters.
      </p>
    </div>
  )
}

function TodaysPicksTab() {
  const [category, setCategory] = useState('LAP')
  const [brand, setBrand] = useState('')
  const [cpu, setCpu] = useState('')
  const [theme, setTheme] = useState('')
  const [inStockOnly, setInStockOnly] = useState(true)
  const [products, setProducts] = useState<PickProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Keyed by id, not a bare Set<string> -- so an item picked via search (or a previous
  // filter view) can still be rendered in the "Selected" strip and fed to the card
  // preview/generate/collage actions after it has scrolled out of the current browse
  // grid or search results. Selection is deliberately never cleared by a filter or
  // search change (see below) -- only by unticking an item or generating.
  const [selectedMap, setSelectedMap] = useState<Map<string, PickProduct>>(new Map())
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
  useEffect(() => { load() }, [category, brand, cpu, inStockOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (product: PickProduct) => {
    setSelectedMap((prev) => {
      const next = new Map(prev)
      if (next.has(product.id)) next.delete(product.id)
      else next.set(product.id, product)
      return next
    })
  }
  const selectedIds = new Set(selectedMap.keys())

  const { run: generate, pending: generating } = useAsyncAction(async () => {
    setError(null); setResult(null)
    const ids = [...selectedMap.keys()]
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
    const ids = [...selectedMap.keys()]
    const res = await apiFetch(`/api/marketing/collage?sku_ids=${ids.join(',')}&format=wa_square`)
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Collage generation failed'); return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `collage-${ids.length}-items.png`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  })

  const selectedList = [...selectedMap.values()]
  const singleSelectedProduct = selectedList.length === 1 ? selectedList[0] : undefined

  // "Select all" acts on the currently filtered/loaded browse grid (respecting
  // category/brand/CPU/in-stock-only above), not the whole catalogue -- toggling a
  // filter after selecting all does not retroactively add/remove anything, same as
  // ticking items individually.
  const allFilteredSelected = products.length > 0 && products.every((p) => selectedIds.has(p.id))
  const toggleSelectAllFiltered = () => {
    setSelectedMap((prev) => {
      const next = new Map(prev)
      if (allFilteredSelected) {
        for (const p of products) next.delete(p.id)
      } else {
        for (const p of products) next.set(p.id, p)
      }
      return next
    })
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Browse what's actually in stock right now -- or untick "In stock only" below to also find items already on
        order (an active SKU with zero quantity, e.g. on a Purchase Order but not yet received) so you can promote
        them ahead of arrival. Tick items to hand-pick a broadcast -- leave nothing ticked to generate for everything
        matching the filters below. Tick 2 or more to also download a photo collage.
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
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={inStockOnly} onCheckedChange={(v) => setInStockOnly(v === true)} />
          In stock only
        </label>
        {products.length > 0 && (
          <Button type="button" variant="outline" size="sm" className="h-7" onClick={toggleSelectAllFiltered}>
            {allFilteredSelected ? 'Deselect all' : `Select all (${products.length})`}
          </Button>
        )}
      </div>

      <SkuSearchPicker inStockOnly={inStockOnly} selectedIds={selectedIds} onToggle={toggle} />

      {selectedMap.size > 0 && (
        <div className="border rounded-md p-2 bg-muted/20">
          <div className="text-xs font-medium text-muted-foreground mb-1.5">
            Selected ({selectedMap.size}) -- kept across searches and filter changes
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selectedList.map((p) => (
              <button
                key={p.id} type="button" onClick={() => toggle(p)}
                className="flex items-center gap-1.5 border rounded-full pl-1 pr-2 py-0.5 bg-background text-xs hover:bg-muted"
                title="Remove from selection"
              >
                <ProductThumb path={p.primary_image_path} size={20} />
                <span className="max-w-[160px] truncate">{p.display_title}</span>
                <span className="text-muted-foreground">&times;</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : loadError ? (
        <ErrorBanner message={loadError} />
      ) : products.length === 0 ? (
        <p className="text-sm text-muted-foreground">No {inStockOnly ? 'in-stock' : ''} items match these filters.</p>
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
                {items.map((p) => (
                  <ProductRow key={p.id} product={p} isSelected={selectedIds.has(p.id)} onToggle={() => toggle(p)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => generate()} disabled={generating || (products.length === 0 && selectedMap.size === 0)} className="h-8">
          {generating ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
          Generate WhatsApp {selectedMap.size > 0 ? `(${selectedMap.size} selected)` : '(all filtered)'}
        </Button>
        {selectedMap.size >= 2 && (
          <Button onClick={() => downloadCollage()} disabled={collaging} variant="outline" className="h-8">
            {collaging ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1.5" />} Download collage ({selectedMap.size} photos)
          </Button>
        )}
      </div>

      {singleSelectedProduct && (
        <CardPreview endpointBase={`/api/marketing/card?sku_id=${singleSelectedProduct.id}`} filenameBase={singleSelectedProduct.display_title} hasPhoto={!!singleSelectedProduct.primary_image_path} />
      )}

      {error && <ErrorBanner message={error} />}
      {result && <GeneratedResult asset={result.asset} whatsappShareLink={result.whatsapp_share_link} />}
    </div>
  )
}

function yearOf(dateStr: string): number {
  return Number(dateStr.slice(0, 4))
}

// Plain reference calendar of Indian festivals (major + minor) -- no post/card
// generation, that's what Today's Picks already covers for promoting actual stock.
// The year dropdown is computed live off today's date (currentYear-3 .. currentYear,
// plus whatever future years are seeded) so it "refreshes" every year on its own --
// nothing to run or update when a new year starts, it just shifts the window forward.
function FestivalCalendarTab() {
  const { canEditPage } = useRole()
  const [festivals, setFestivals] = useState<FestivalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [yearTouched, setYearTouched] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [isMajor, setIsMajor] = useState(true)

  const load = async () => {
    setLoading(true)
    const res = await apiFetch('/api/marketing/festivals')
    const data = await res.json().catch(() => [])
    setFestivals(Array.isArray(data) ? data : [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const years = Array.from(new Set([
    ...festivals.map((f) => yearOf(f.festival_date)),
    currentYear - 3, currentYear - 2, currentYear - 1, currentYear,
  ])).sort((a, b) => a - b)

  const yearFestivals = festivals.filter((f) => yearOf(f.festival_date) === year)

  // The single nearest festival from today onward, across all years -- not just the
  // selected year -- so switching years still shows which row it is when you land back
  // on the year it falls in. festivals is already date-ascending from the API.
  const todayStr = new Date().toISOString().slice(0, 10)
  const nextFestival = festivals.find((f) => f.festival_date >= todayStr)
  const nextFestivalId = nextFestival?.id

  // Jumps to the next festival's year once the calendar loads (e.g. late December ->
  // next festival is New Year's Day, in year+1) -- never overrides a year the user
  // already picked themselves.
  useEffect(() => {
    if (!yearTouched && nextFestival) setYear(yearOf(nextFestival.festival_date))
  }, [nextFestival, yearTouched])

  const monthName = (dateStr: string) => new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-IN', { month: 'long' })
  const formatDate = (dateStr: string) => new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

  const groupedByMonth: [string, FestivalEntry[]][] = (() => {
    const groups = new Map<string, FestivalEntry[]>()
    for (const f of yearFestivals) {
      const m = monthName(f.festival_date)
      const existing = groups.get(m)
      if (existing) existing.push(f)
      else groups.set(m, [f])
    }
    return Array.from(groups.entries())
  })()

  const { run: add, pending: adding } = useAsyncAction(async () => {
    if (!name.trim() || !date) { toast.error('Name and date are required'); return }
    const res = await apiFetch('/api/marketing/festivals', { method: 'POST', body: JSON.stringify({ name, festival_date: date, is_major: isMajor }) })
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error || 'Failed to add'); return }
    setName(''); setDate(''); setIsMajor(true)
    load()
  })

  const remove = async (id: string) => {
    if (!confirm('Remove this festival from the calendar?')) return
    await apiFetch(`/api/marketing/festivals/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-muted-foreground">
        Reference calendar of major and minor Indian festivals, so you know what's coming up without checking
        elsewhere. Pick a year below -- the last 3 years plus upcoming ones are always available.
      </p>

      <div className="flex items-center gap-2">
        <Calendar className="size-4 text-muted-foreground" />
        <label className="text-sm font-medium">Year</label>
        <Select value={String(year)} onValueChange={(v) => { setYear(Number(v)); setYearTouched(true) }}>
          <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            {years.map((y) => <SelectItem key={y} value={String(y)}>{y}{y === currentYear ? ' (current)' : ''}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : yearFestivals.length === 0 ? (
        <p className="text-sm text-muted-foreground">No festivals recorded for {year} yet.</p>
      ) : (
        <div className="space-y-4">
          {groupedByMonth.map(([month, items]) => (
            <div key={month}>
              <h4 className="text-sm font-semibold mb-1.5">{month}</h4>
              <div className="border rounded-md divide-y">
                {items.map((f) => {
                  const isNext = f.id === nextFestivalId
                  return (
                    <div key={f.id} className={`flex items-center justify-between px-3 py-2 text-sm ${isNext ? 'bg-primary/10 ring-1 ring-inset ring-primary/40' : ''}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-muted-foreground w-28 shrink-0">{formatDate(f.festival_date)}</span>
                        <span className={f.is_major ? 'font-medium truncate' : 'truncate'}>{f.name}</span>
                        {!f.is_major && <span className="text-[10px] text-muted-foreground border rounded-full px-1.5 py-0.5 shrink-0">minor</span>}
                        {isNext && <span className="text-[10px] font-medium text-primary border border-primary/40 rounded-full px-1.5 py-0.5 shrink-0">Next up</span>}
                      </div>
                      {canEditPage('marketing') && (
                        <button type="button" onClick={() => remove(f.id)} className="text-destructive shrink-0" title="Remove">
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {canEditPage('marketing') && (
        <div className="pt-2 border-t">
          <button type="button" onClick={() => setShowAdd((v) => !v)} className="text-xs text-primary underline flex items-center gap-1">
            <Plus className="size-3" /> {showAdd ? 'Hide' : 'Add a festival'}
          </button>
          {showAdd && (
            <div className="flex flex-wrap items-end gap-2 mt-2">
              <div className="w-48">
                <label className="block text-xs text-muted-foreground mb-1">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Baisakhi" />
              </div>
              <div className="w-40">
                <label className="block text-xs text-muted-foreground mb-1">Date</label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <label className="flex items-center gap-1.5 text-xs pb-2">
                <Checkbox checked={isMajor} onCheckedChange={(v) => setIsMajor(v === true)} /> Major
              </label>
              <Button type="button" className="h-8" disabled={adding} onClick={() => add()}>
                {adding ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null} Add
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MarketingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Marketing Content Studio</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generate WhatsApp content grounded in your real current stock -- Today's Picks covers browsing, filters, custom broadcast themes, bulk or hand-picked generation, and a photo collage.
        </p>
      </div>
      <Tabs defaultValue="picks">
        <TabsList>
          <TabsTrigger value="picks">Today's Picks</TabsTrigger>
          <TabsTrigger value="calendar">Festival Calendar</TabsTrigger>
        </TabsList>
        <TabsContent value="picks"><TodaysPicksTab /></TabsContent>
        <TabsContent value="calendar"><FestivalCalendarTab /></TabsContent>
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

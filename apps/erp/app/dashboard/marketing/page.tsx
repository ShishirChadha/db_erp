'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import RequirePageAccess from '@/components/RequirePageAccess'
import { useRole } from '@/lib/auth/useRole'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorBanner } from '@/components/ErrorBanner'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { MARKETING_ASSET_STATUS_TONES, toneFor } from '@db/shared'
import { Copy, Download, MessageCircle, Loader2, Sparkles, Share2, ImageOff, Save, Star } from 'lucide-react'

interface SkuOption { id: string; full_sku_code: string; web_title: string | null; brand: string | null; model_name: string | null; category: string; is_published: boolean }
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

function useProductSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SkuOption[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      setLoading(true)
      const res = await apiFetch(`/api/sku-master?search=${encodeURIComponent(query)}&is_published=true`)
      if (res.ok) setResults(await res.json())
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
        {skuId && <CardDownloadButton skuId={skuId} label={asset.title || 'product'} hasPhoto={!!product?.primary_image_path} />}
      </CardContent>
    </Card>
  )
}

interface SuggestionProduct { id: string; display_title: string; config_summary: string; web_price: number; category: string; primary_image_path: string | null; received_at?: string | null }
interface SuggestionBucket { priority: string; label: string; reason: string; products: SuggestionProduct[] }

function TodaysPicksTab() {
  const [buckets, setBuckets] = useState<SuggestionBucket[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ asset: MarketingAsset; whatsapp_share_link?: string; product?: GeneratedProduct } | null>(null)
  const [generatingId, setGeneratingId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const res = await apiFetch('/api/marketing/suggest')
    if (res.ok) setBuckets(await res.json())
    else setError('Failed to load suggestions')
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const generateFor = async (skuId: string) => {
    setGeneratingId(skuId); setError(null); setResult(null)
    const res = await apiFetch('/api/marketing/generate', {
      method: 'POST',
      body: JSON.stringify({ mode: 'single_product', platform: 'whatsapp', sku_id: skuId }),
    })
    const data = await res.json()
    setGeneratingId(null)
    if (!res.ok) { setError(data.error || 'Generation failed'); return }
    setResult(data)
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading today's picks...</p>
  if (!buckets) return <ErrorBanner message={error || 'Could not load suggestions'} />

  return (
    <div className="space-y-6 max-w-3xl">
      <p className="text-sm text-muted-foreground">
        Ranked by priority for today's WhatsApp send -- P1 new arrivals (by real stock-receipt date, not publish date), P2 high-end/MacBooks, P3 aging stock, P4 unique configurations.
      </p>
      {buckets.map((bucket, i) => (
        <div key={bucket.priority}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-muted">P{i + 1}</span>
            <h3 className="font-medium">{bucket.label}</h3>
            <span className="text-xs text-muted-foreground">{bucket.reason}</span>
          </div>
          {bucket.products.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-1 ml-1">Nothing in this bucket right now.</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {bucket.products.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate flex items-center gap-1.5">
                      {p.display_title}
                      {!p.primary_image_path && <ImageOff className="w-3.5 h-3.5 text-warning shrink-0" />}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{p.config_summary} · ₹{p.web_price.toLocaleString('en-IN')}</div>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 shrink-0" disabled={generatingId === p.id} onClick={() => generateFor(p.id)}>
                    {generatingId === p.id ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />} Generate WhatsApp
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {error && <ErrorBanner message={error} />}
      {result && <GeneratedResult asset={result.asset} whatsappShareLink={result.whatsapp_share_link} product={result.product} />}
    </div>
  )
}

function SingleProductTab() {
  const { query, setQuery, results, loading } = useProductSearch()
  const [selected, setSelected] = useState<SkuOption | null>(null)
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
        <label className="text-sm font-medium mb-1 block">Product (published SKUs only)</label>
        <Input value={query} onChange={(e) => { setQuery(e.target.value); setSelected(null) }} placeholder="Search by brand, model, or SKU code..." />
        {loading && <p className="text-xs text-muted-foreground mt-1">Searching...</p>}
        {!selected && results.length > 0 && (
          <div className="border rounded-md mt-1 max-h-56 overflow-y-auto">
            {results.map((r) => (
              <button
                key={r.id} type="button" onClick={() => { setSelected(r); setQuery(r.web_title || `${r.brand} ${r.model_name}`) }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
              >
                {r.web_title || `${r.brand || ''} ${r.model_name || ''}`.trim() || r.full_sku_code}
                <span className="text-muted-foreground ml-2">{r.full_sku_code}</span>
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

function ProductListTab() {
  const [category, setCategory] = useState('LAP')
  const [specField, setSpecField] = useState('')
  const [specValue, setSpecValue] = useState('')
  const [theme, setTheme] = useState('')
  const [inStockOnly, setInStockOnly] = useState(true)
  const [result, setResult] = useState<{ asset: MarketingAsset; whatsapp_share_link?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { run: generate, pending } = useAsyncAction(async () => {
    setError(null); setResult(null)
    const filter: Record<string, any> = { category, inStockOnly }
    if (specField.trim() && specValue.trim()) filter.spec = { [specField.trim()]: specValue.trim() }
    const res = await apiFetch('/api/marketing/generate', {
      method: 'POST',
      body: JSON.stringify({ mode: 'product_list', theme: theme || `${category} in stock`, filter }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Generation failed'); return }
    setResult(data)
  })

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-muted-foreground">e.g. "all i5 laptops in stock" -- category=Laptops, spec field=cpu, spec value=i5.</p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium mb-1 block">Category code</label>
          <Input value={category} onChange={(e) => setCategory(e.target.value.toUpperCase())} placeholder="LAP" />
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Broadcast theme (optional)</label>
          <Input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="All i5 laptops in stock" />
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Spec field (optional)</label>
          <Input value={specField} onChange={(e) => setSpecField(e.target.value)} placeholder="cpu" />
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Spec value</label>
          <Input value={specValue} onChange={(e) => setSpecValue(e.target.value)} placeholder="i5" />
        </div>
      </div>
      <Button onClick={() => generate()} disabled={pending} className="h-8">
        {pending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null} Generate
      </Button>
      {error && <ErrorBanner message={error} />}
      {result && <GeneratedResult asset={result.asset} whatsappShareLink={result.whatsapp_share_link} />}
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
          Generate WhatsApp, Instagram, Facebook and blog content grounded in your real published catalogue -- prices and specs are inserted from live data, never invented.
        </p>
      </div>
      <Tabs defaultValue="picks">
        <TabsList>
          <TabsTrigger value="picks">Today's Picks</TabsTrigger>
          <TabsTrigger value="single">Single Product</TabsTrigger>
          <TabsTrigger value="list">Product List</TabsTrigger>
          <TabsTrigger value="blog">Blog Draft</TabsTrigger>
          <TabsTrigger value="drafts">Drafts</TabsTrigger>
        </TabsList>
        <TabsContent value="picks"><TodaysPicksTab /></TabsContent>
        <TabsContent value="single"><SingleProductTab /></TabsContent>
        <TabsContent value="list"><ProductListTab /></TabsContent>
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

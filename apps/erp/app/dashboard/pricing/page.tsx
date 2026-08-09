'use client'

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'
import RequireOwner from '@/components/RequireOwner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SearchableSelect } from '@/components/SearchableSelect'
import { SearchableCustomerSelect } from '@/components/SearchableCustomerSelect'
import { useCustomOptions } from '@/lib/useCustomOptions'
import { priceFromMarkup, markupFromPrice, marginFromPrice, profit } from '@/lib/pricing'
import { buildConfigSummary, type ConfigSummaryTemplate } from '@/lib/sku-config-summary'

// ---------- Types ----------
interface SkuLite {
  id: string
  full_sku_code: string
  sku_description: string
  category: string
  specifications: any
  quantity_in_stock: number
}

interface VendorComparisonRow {
  vendor_name: string
  times_bought: number
  last_price: number
  last_date: string | null
  min_price: number
  avg_price: number
}

interface HistoryRow {
  date: string | null
  vendor_name: string | null
  price: number | null
  quantity: number
  source: string
  ref: string | null
}

interface Observation {
  id: string
  competitor: string
  price: number
  condition_grade: string | null
  source_url: string | null
  notes: string | null
  observed_at: string
}

interface PriceIntel {
  sku: {
    id: string
    full_sku_code: string
    sku_description: string
    category: string
    brand: string | null
    model_name: string | null
    specifications: any
    quantity_in_stock: number
    status: string
    base_cost: number | null
    selling_price_default: number | null
    web_price: number | null
    market_price: number | null
  }
  vendor_comparison: VendorComparisonRow[]
  history: HistoryRow[]
  observations: Observation[]
  market_benchmark: { min: number; median: number; count: number } | null
}

const SOURCE_LABELS: Record<string, string> = {
  purchase_order: 'PO',
  asset_ledger: 'Asset',
  asset_legacy: 'Asset (legacy)',
  legacy_purchase: 'Legacy',
}

function money(n: number | null | undefined) {
  return n != null ? `₹${n.toFixed(2)}` : '—'
}

// ---------- SKU search box ----------
function SkuSearch({ templates, onSelect }: { templates: ConfigSummaryTemplate[]; onSelect: (sku: SkuLite) => void }) {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<SkuLite[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!term.trim()) { setResults([]); return }
    setLoading(true)
    const timer = setTimeout(async () => {
      const res = await apiFetch(`/api/sku-master?search=${encodeURIComponent(term)}`)
      const data = await res.json().catch(() => [])
      setResults(Array.isArray(data) ? data.slice(0, 15) : [])
      setLoading(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [term])

  return (
    <div className="relative max-w-md">
      <Input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search item by SKU code or description..."
      />
      {loading && <Loader2 className="absolute right-2 top-2 size-4 animate-spin text-gray-400" />}
      {results.length > 0 && (
        <ul className="border rounded-md mt-1 max-h-72 overflow-y-auto absolute bg-background w-full z-10 shadow">
          {results.map((sku) => (
            <li
              key={sku.id}
              onClick={() => { onSelect(sku); setTerm(''); setResults([]) }}
              className="p-2 hover:bg-muted cursor-pointer border-b last:border-b-0 text-sm"
            >
              <div className="font-medium">{sku.full_sku_code}</div>
              <div className="text-xs text-gray-500">
                {buildConfigSummary(sku.category, sku.specifications, templates) || sku.sku_description} — {sku.quantity_in_stock ?? 0} in stock
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------- Buy-side panel ----------
function VendorComparisonPanel({ data }: { data: PriceIntel }) {
  const [showHistory, setShowHistory] = useState(false)

  return (
    <div className="border rounded-lg p-4">
      <h2 className="font-semibold mb-1">Vendor Comparison</h2>
      <p className="text-xs text-gray-500 mb-3">
        Who you've bought this from, and at what price — the "I bought this from ABC 3x, here's XYZ's price" view.
      </p>
      {data.vendor_comparison.length === 0 ? (
        <p className="text-sm text-gray-400">No purchase history found for this item yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="p-2">Last Bought</th>
                <th className="p-2">Vendor</th>
                <th className="p-2 text-right">Times Bought</th>
                <th className="p-2 text-right">Last Price</th>
                <th className="p-2 text-right">Min Price</th>
                <th className="p-2 text-right">Avg Price</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.vendor_comparison.map((v) => (
                <tr key={v.vendor_name}>
                  <td className="p-2">{v.last_date?.slice(0, 10) || '—'}</td>
                  <td className="p-2 font-medium">{v.vendor_name}</td>
                  <td className="p-2 text-right tabular-nums">{v.times_bought}</td>
                  <td className="p-2 text-right tabular-nums">{money(v.last_price)}</td>
                  <td className="p-2 text-right tabular-nums">{money(v.min_price)}</td>
                  <td className="p-2 text-right tabular-nums">{money(v.avg_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.history.length > 0 && (
        <div className="mt-3">
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="text-xs text-blue-600 underline">
            {showHistory ? 'Hide' : 'Show'} full purchase history ({data.history.length})
          </button>
          {showHistory && (
            <div className="overflow-x-auto rounded-md border mt-2">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="p-2">Date</th>
                    <th className="p-2">Vendor</th>
                    <th className="p-2 text-right">Price</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2">Source</th>
                    <th className="p-2">Ref</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.history.map((h, idx) => (
                    <tr key={idx}>
                      <td className="p-2">{h.date?.slice(0, 10) || '—'}</td>
                      <td className="p-2">{h.vendor_name || '—'}</td>
                      <td className="p-2 text-right tabular-nums">{money(h.price)}</td>
                      <td className="p-2 text-right tabular-nums">{h.quantity}</td>
                      <td className="p-2 text-xs text-gray-500">{SOURCE_LABELS[h.source] || h.source}</td>
                      <td className="p-2 text-xs text-gray-500">{h.ref || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- Sell-side margin calculator panel ----------
function MarginCalculatorPanel({ data, onSaved }: { data: PriceIntel; onSaved: () => void }) {
  const lastCost = data.vendor_comparison[0]?.last_price ?? data.sku.base_cost ?? 0
  const [cost, setCost] = useState(lastCost)
  const [markupPct, setMarkupPct] = useState(20)
  const [price, setPrice] = useState(() => priceFromMarkup(lastCost, 20))
  const [lastEdited, setLastEdited] = useState<'markup' | 'price'>('markup')

  useEffect(() => {
    setCost(lastCost)
    setPrice(priceFromMarkup(lastCost, markupPct))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.sku.id])

  const handleMarkupChange = (pct: number) => {
    setMarkupPct(pct)
    setPrice(priceFromMarkup(cost, pct))
    setLastEdited('markup')
  }
  const handlePriceChange = (p: number) => {
    setPrice(p)
    setMarkupPct(markupFromPrice(cost, p))
    setLastEdited('price')
  }
  const handleCostChange = (c: number) => {
    setCost(c)
    if (lastEdited === 'markup') setPrice(priceFromMarkup(c, markupPct))
    else setMarkupPct(markupFromPrice(c, price))
  }

  const marginPct = marginFromPrice(cost, price)
  const profitAmt = profit(cost, price)

  const [customerId, setCustomerId] = useState<string | null>(null)
  const [showQuoteForm, setShowQuoteForm] = useState(false)

  const { run: handleSaveDefault, pending: saving } = useAsyncAction(async () => {
    const res = await apiFetch(`/api/sku-master/${data.sku.id}`, {
      method: 'PUT',
      body: JSON.stringify({ selling_price_default: price }),
    })
    if (!res.ok) { toast.error('Failed to save price'); return }
    toast.success('Selling price updated')
    onSaved()
  })

  const { run: handleCreateQuote, pending: creatingQuote } = useAsyncAction(async () => {
    if (!customerId) { toast.error('Select a customer first'); return }
    const res = await apiFetch('/api/sales-documents', {
      method: 'POST',
      body: JSON.stringify({
        doc_type: 'quotation',
        entity_key: 'digitalbluez',
        customer_id: customerId,
        items: [{
          item_type: 'sku',
          sku_id: data.sku.id,
          description: data.sku.sku_description || data.sku.full_sku_code,
          quantity: 1,
          rate: price,
          gst_rate: 18,
        }],
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(json.error || 'Failed to create quotation'); return }
    toast.success(`Quotation ${json.document_number || ''} created`)
    setShowQuoteForm(false)
    setCustomerId(null)
  })

  return (
    <div className="border rounded-lg p-4">
      <h2 className="font-semibold mb-1">Margin Calculator</h2>
      <p className="text-xs text-gray-500 mb-3">
        Cost basis prefilled from the last vendor price — edit either markup% or price, the other updates.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Cost (₹)</label>
          <Input type="number" value={cost} onChange={(e) => handleCostChange(Number(e.target.value))} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Markup on cost (%)</label>
          <Input type="number" value={markupPct} onChange={(e) => handleMarkupChange(Number(e.target.value))} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Suggested Price (₹)</label>
          <Input type="number" value={price} onChange={(e) => handlePriceChange(Number(e.target.value))} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Margin on price</label>
          <div className="h-8 flex items-center text-sm tabular-nums">{marginPct.toFixed(1)}%</div>
        </div>
      </div>

      <p className="text-sm text-gray-600 mb-3">
        Profit per unit: <span className="font-medium tabular-nums">{money(profitAmt)}</span>
        {data.market_benchmark && (
          <>
            {' '}— {price <= data.market_benchmark.min
              ? <span className="text-emerald-600">₹{(data.market_benchmark.min - price).toFixed(2)} below cheapest competitor</span>
              : <span className="text-amber-600">₹{(price - data.market_benchmark.min).toFixed(2)} above cheapest competitor</span>}
          </>
        )}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => { navigator.clipboard?.writeText(price.toFixed(2)); toast.success('Price copied') }}
        >
          Copy Price
        </Button>
        <Button variant="outline" loading={saving} onClick={() => handleSaveDefault()}>
          Save as Default Selling Price
        </Button>
        <Button variant="outline" onClick={() => setShowQuoteForm((v) => !v)}>
          Create Quotation
        </Button>
      </div>

      {showQuoteForm && (
        <div className="mt-3 border-t pt-3 flex flex-wrap items-end gap-2">
          <div className="w-72">
            <label className="block text-xs text-gray-500 mb-1">Customer</label>
            <SearchableCustomerSelect value={customerId} onChange={setCustomerId} onCustomerData={() => {}} />
          </div>
          <Button loading={creatingQuote} onClick={() => handleCreateQuote()}>
            Create Quotation at {money(price)}
          </Button>
        </div>
      )}
    </div>
  )
}

// ---------- Competitor benchmark panel ----------
function CompetitorPanel({ skuId, observations, benchmark, onChanged }: {
  skuId: string
  observations: Observation[]
  benchmark: PriceIntel['market_benchmark']
  onChanged: () => void
}) {
  const { values: competitors } = useCustomOptions('competitors')
  const [competitor, setCompetitor] = useState('')
  const [price, setPrice] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')

  const { run: handleAdd, pending: adding } = useAsyncAction(async () => {
    if (!competitor.trim() || !price) { toast.error('Competitor and price are required'); return }
    const res = await apiFetch(`/api/sku-master/${skuId}/market-observations`, {
      method: 'POST',
      body: JSON.stringify({ competitor, price: Number(price), source_url: sourceUrl || undefined }),
    })
    if (!res.ok) { toast.error('Failed to save observation'); return }
    setCompetitor(''); setPrice(''); setSourceUrl('')
    onChanged()
  })

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const handleDelete = async (obsId: string) => {
    setDeletingId(obsId)
    try {
      await apiFetch(`/api/sku-master/${skuId}/market-observations/${obsId}`, { method: 'DELETE' })
      onChanged()
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="border rounded-lg p-4">
      <h2 className="font-semibold mb-1">Competitor Benchmark</h2>
      <p className="text-xs text-gray-500 mb-3">
        Log prices you look up (Cashify, New Jaisa, Sudewala…) so a benchmark builds up over time.
      </p>

      {benchmark && (
        <p className="text-sm mb-3">
          Cheapest: <span className="font-medium tabular-nums">{money(benchmark.min)}</span> · Median: <span className="font-medium tabular-nums">{money(benchmark.median)}</span> ({benchmark.count} observation{benchmark.count !== 1 ? 's' : ''})
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2 mb-3">
        <div className="w-44">
          <label className="block text-xs text-gray-500 mb-1">Competitor</label>
          <SearchableSelect options={competitors} value={competitor} onChange={setCompetitor} placeholder="Select..." />
        </div>
        <div className="w-32">
          <label className="block text-xs text-gray-500 mb-1">Price (₹)</label>
          <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="w-56">
          <label className="block text-xs text-gray-500 mb-1">Link (optional)</label>
          <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://..." />
        </div>
        <Button loading={adding} onClick={() => handleAdd()}>Add</Button>
      </div>

      {observations.length === 0 ? (
        <p className="text-sm text-gray-400">No competitor prices logged yet for this item.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="p-2">Date</th>
                <th className="p-2">Competitor</th>
                <th className="p-2 text-right">Price</th>
                <th className="p-2">Link</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {observations.map((o) => (
                <tr key={o.id}>
                  <td className="p-2">{o.observed_at?.slice(0, 10)}</td>
                  <td className="p-2">{o.competitor}</td>
                  <td className="p-2 text-right tabular-nums">{money(o.price)}</td>
                  <td className="p-2">
                    {o.source_url ? <a href={o.source_url} target="_blank" rel="noreferrer" className="text-blue-600 underline text-xs">view</a> : '—'}
                  </td>
                  <td className="p-2">
                    <button onClick={() => handleDelete(o.id)} disabled={deletingId === o.id} className="text-red-500 disabled:opacity-50">
                      {deletingId === o.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                    </button>
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

// ---------- Main page ----------
function PriceCockpitInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const initialSkuId = searchParams.get('sku_id')

  const [skuId, setSkuId] = useState<string | null>(initialSkuId)
  const [data, setData] = useState<PriceIntel | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ConfigSummaryTemplate[]>([])

  useEffect(() => {
    apiFetch('/api/sku-category-templates').then((res) => res.json()).then((d) => {
      setTemplates(Array.isArray(d) ? d : [])
    })
  }, [])

  const fetchIntel = useCallback(async () => {
    if (!skuId) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/sku-master/${skuId}/price-intel`)
      if (!res.ok) throw new Error('Failed to load price intel')
      setData(await res.json())
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [skuId])

  useEffect(() => { fetchIntel() }, [fetchIntel])

  const selectSku = (sku: SkuLite) => {
    setSkuId(sku.id)
    router.replace(`/dashboard/pricing?sku_id=${sku.id}`)
  }

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold mb-1">Price Cockpit</h1>
        <p className="text-sm text-gray-500 mb-3">
          Pick an item to see who you've bought it from, work out a sell price, and log competitor prices — all in one place.
        </p>
        <SkuSearch templates={templates} onSelect={selectSku} />
      </div>

      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {error && <div className="text-sm text-red-600">Error: {error}</div>}

      {data && !loading && (
        <>
          <div className="border rounded-lg p-4 bg-muted/30">
            <h2 className="text-lg font-semibold">
              {buildConfigSummary(data.sku.category, data.sku.specifications, templates) || data.sku.sku_description || data.sku.full_sku_code}
            </h2>
            {data.sku.sku_description && (
              <p className="text-sm text-gray-600">{data.sku.sku_description}</p>
            )}
            <p className="text-sm text-gray-600 mt-1">
              {data.sku.full_sku_code} — {data.sku.category} · {data.sku.quantity_in_stock ?? 0} in stock
            </p>
            <p className="text-sm text-gray-600 mt-1">
              Current default selling price: <span className="font-medium">{money(data.sku.selling_price_default)}</span>
            </p>
          </div>

          <VendorComparisonPanel data={data} />
          <MarginCalculatorPanel data={data} onSaved={fetchIntel} />
          <CompetitorPanel
            skuId={data.sku.id}
            observations={data.observations}
            benchmark={data.market_benchmark}
            onChanged={fetchIntel}
          />
        </>
      )}

      {!data && !loading && !error && (
        <p className="text-sm text-gray-400">Search for an item above to get started.</p>
      )}
    </div>
  )
}

export default function PriceCockpitPage() {
  return (
    <RequireOwner>
      <Suspense fallback={<div className="p-4 text-sm text-gray-500">Loading…</div>}>
        <PriceCockpitInner />
      </Suspense>
    </RequireOwner>
  )
}

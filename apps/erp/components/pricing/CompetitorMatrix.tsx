'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ExternalLink, EyeOff } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/MasterDetail'
import { inr, timeAgo, type MarketData, type ProductMatch } from './types'

// "Competition" section of the Price Board detail pane: every variant each competitor sells
// of the same model. Like-for-like (same RAM + SSD, warranty 6 m or more) rows come first.
export default function CompetitorMatrix({ skuId, refreshKey, onChanged }: { skuId: string; refreshKey: number; onChanged: () => void }) {
  const [data, setData] = useState<MarketData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/pricing/market?sku_id=${skuId}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not load competitor prices')
      setData(body); setError(null)
    } catch (e: any) { setError(e.message) }
  }, [skuId])
  useEffect(() => { setData(null); load() }, [load, refreshKey])

  const decide = async (p: ProductMatch, status: 'confirmed' | 'rejected' | 'clear') => {
    const res = await apiFetch('/api/pricing/links', { method: 'POST', body: JSON.stringify({ sku_id: skuId, competitor_id: p.competitor_id, product_key: p.product_key, status }) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error || 'Could not save'); return }
    await load()
    onChanged()
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!data) return <p className="text-sm text-muted-foreground">Loading competitor prices…</p>

  const price = data.price
  const visible = data.products.filter((p) => !p.hidden)
  const hidden = data.products.filter((p) => p.hidden)
  const byCompetitor = new Map<string, ProductMatch[]>()
  for (const p of visible) byCompetitor.set(p.competitor_id, [...(byCompetitor.get(p.competitor_id) || []), p])
  const diff = (n: number) => (price == null ? null : n - price)
  const wantRam = data.ours.ram_gb, wantSsd = data.ours.ssd_gb
  const noData = data.competitors.every((c) => c.listings === 0)

  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold">Competition</h3>
      {noData ? (
        <p className="text-sm text-muted-foreground">No competitor prices stored yet. Press “Check competitors” at the top of the board.</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No competitor sells this model right now (matched on brand, model number, CPU and generation).</p>
      ) : (
        <>
          <p className="mb-2 text-sm">
            Market for this model:{' '}
            <span className="font-medium tabular-nums">{data.range ? `${inr(data.range.min)} – ${inr(data.range.max)}` : 'all sold out'}</span>
            {' '}across {data.competitor_count} seller{data.competitor_count === 1 ? '' : 's'}, {data.variant_count} variant{data.variant_count === 1 ? '' : 's'}.
          </p>
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded border p-2 text-sm">
              <div className="text-xs text-muted-foreground">Like-for-like{wantRam && wantSsd ? ` (${wantRam} GB / ${wantSsd >= 1024 ? `${wantSsd / 1024} TB` : `${wantSsd} GB`})` : ''}</div>
              {data.exact_min ? (
                <div className="tabular-nums"><span className="font-semibold">{inr(data.exact_min.price)}</span> {data.exact_min.competitor}
                  {diff(data.exact_min.price) != null && <span className={diff(data.exact_min.price)! < 0 ? 'ml-1 text-red-600' : 'ml-1 text-green-700'}>({diff(data.exact_min.price)! < 0 ? '−' : '+'}{inr(Math.abs(diff(data.exact_min.price)!))})</span>}
                </div>
              ) : <div className="text-muted-foreground">None with the same RAM and SSD</div>}
            </div>
            <div className="rounded border p-2 text-sm">
              <div className="text-xs text-muted-foreground">Cheapest of the model (any config)</div>
              {data.model_low ? (
                <div className="tabular-nums"><span className="font-semibold">{inr(data.model_low.price)}</span> {data.model_low.competitor}
                  <div className="text-xs text-muted-foreground">{data.model_low.variant_label}</div>
                </div>
              ) : <div className="text-muted-foreground">—</div>}
            </div>
          </div>

          <div className="space-y-4">
            {[...byCompetitor.entries()].map(([cid, prods]) => (
              <div key={cid}>
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{prods[0].competitor}</span>
                  <span className="text-xs text-muted-foreground">checked {timeAgo(data.competitors.find((c) => c.id === cid)?.last_price_check_at ?? null)}</span>
                </div>
                <div className="space-y-2">
                  {prods.map((p) => (
                    <div key={p.product_key} className="rounded-lg border p-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <span className="min-w-0 break-words text-sm font-medium">{p.title}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          {p.forced && <Pill tone="green">This model</Pill>}
                          {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-xs text-primary underline">Open <ExternalLink className="size-3" /></a>}
                        </span>
                      </div>
                      <ul className="mt-2 space-y-1">
                        {p.variants.map((v) => {
                          const d = diff(v.price)
                          return (
                            <li key={v.listing_key} className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded px-2 py-1 text-sm ${v.exact ? 'bg-green-50 ring-1 ring-green-300' : 'bg-muted/40'} ${!v.in_stock ? 'opacity-60' : ''}`}>
                              <span className="min-w-0 break-words">
                                {v.variant_label}
                                {v.exact && <span className="ml-1"><Pill tone="green">Like-for-like</Pill></span>}
                                {!v.in_stock && <span className="ml-1"><Pill tone="red">Sold out</Pill></span>}
                              </span>
                              <span className="tabular-nums">
                                <span className="font-semibold">{inr(v.price)}</span>
                                {d != null && <span className={d < 0 ? 'ml-1 text-red-600' : 'ml-1 text-green-700'}>{d < 0 ? '−' : '+'}{inr(Math.abs(d))}</span>}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {p.forced
                          ? <Button size="xs" variant="outline" onClick={() => decide(p, 'clear')}>Forget “This model”</Button>
                          : <Button size="xs" variant="outline" onClick={() => decide(p, 'confirmed')}>This model</Button>}
                        <Button size="xs" variant="ghost" onClick={() => decide(p, 'rejected')}>Not this model</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {hidden.length > 0 && (
        <div className="mt-3">
          <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground underline" onClick={() => setShowHidden((v) => !v)}>
            <EyeOff className="size-3" /> {hidden.length} hidden as “Not this model”
          </button>
          {showHidden && (
            <ul className="mt-1 space-y-1">
              {hidden.map((p) => (
                <li key={p.product_key} className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs">
                  <span className="min-w-0 break-words">{p.competitor}: {p.title}</span>
                  <Button size="xs" variant="outline" onClick={() => decide(p, 'clear')}>Show again</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

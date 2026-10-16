'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, RefreshCw, Undo2, SlidersHorizontal } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { ListItem, Panes, Pill } from '@/components/MasterDetail'
import { buildConfigSummary, type ConfigSummaryTemplate } from '@/lib/sku-config-summary'
import { applyBulk, marginFromPrice, priceWarnings, validatePrice, type BulkOp } from '@/lib/pricing'
import { DetailPane, ReviewDialog, RulesDialog } from './PriceBoardParts'
import { inr, timeAgo, type BoardData, type BoardRow } from './types'

type Filter = 'all' | 'undercut' | 'aging' | 'low_margin' | 'unpublished' | 'differ' | 'no_stock'
type Sort = 'age' | 'margin' | 'gap' | 'price' | 'name'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'undercut', label: 'Undercut' },
  { key: 'aging', label: 'Aging stock' },
  { key: 'low_margin', label: 'Low margin' },
  { key: 'unpublished', label: 'Not published' },
  { key: 'differ', label: 'Prices differ' },
]

const BULK_OPS: { key: BulkOp['type']; label: string; unit: string; placeholder: string }[] = [
  { key: 'set', label: 'Set price to', unit: '₹', placeholder: '27999' },
  { key: 'add', label: 'Add / subtract', unit: '₹', placeholder: '-500' },
  { key: 'pct', label: 'Change by', unit: '%', placeholder: '-5' },
  { key: 'match_competitor', label: 'Beat cheapest competitor by', unit: '₹', placeholder: '500' },
  { key: 'margin', label: 'Cost + margin of', unit: '%', placeholder: '15' },
]

export default function PriceBoard() {
  const params = useSearchParams()
  const [data, setData] = useState<BoardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ConfigSummaryTemplate[]>([])
  const [draft, setDraft] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openId, setOpenId] = useState<string | null>(params.get('sku'))
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('age')
  const [search, setSearch] = useState('')
  const [brand, setBrand] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [opKey, setOpKey] = useState<BulkOp['type']>('match_competitor')
  const [opValue, setOpValue] = useState('500')
  const listRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/pricing/board')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not load the board')
      setData(body)
      setError(null)
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    apiFetch('/api/sku-category-templates').then((r) => r.json()).then((d) => setTemplates(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  const rules = data?.rules
  const title = useCallback(
    (r: BoardRow) => buildConfigSummary(r.category, r.specifications as any, templates) || [r.brand, r.model_name].filter(Boolean).join(' ') || r.full_sku_code,
    [templates],
  )

  const brands = useMemo(() => [...new Set((data?.rows || []).map((r) => r.brand).filter(Boolean) as string[])].sort(), [data])

  const visible = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    const rows = data.rows.filter((r) => {
      if (brand && r.brand !== brand) return false
      if (q && !`${title(r)} ${r.full_sku_code}`.toLowerCase().includes(q)) return false
      switch (filter) {
        case 'undercut': return r.undercut
        case 'aging': return r.oldest_age_days != null && r.oldest_age_days >= data.rules.aging_days
        case 'low_margin': return r.cost != null && r.price != null && marginFromPrice(r.cost, r.price) < data.rules.min_margin_pct
        case 'unpublished': return !r.is_published
        case 'differ': return r.prices_differ
        default: return true
      }
    })
    const gap = (r: BoardRow) => (r.comparable_min && r.price != null ? r.price - r.comparable_min.price : -Infinity)
    const margin = (r: BoardRow) => (r.cost != null && r.price != null ? marginFromPrice(r.cost, r.price) : Infinity)
    return rows.sort((a, b) => {
      switch (sort) {
        case 'margin': return margin(a) - margin(b)
        case 'gap': return gap(b) - gap(a)
        case 'price': return (b.price ?? 0) - (a.price ?? 0)
        case 'name': return title(a).localeCompare(title(b))
        default: return (b.oldest_age_days ?? -1) - (a.oldest_age_days ?? -1)
      }
    })
  }, [data, filter, sort, search, brand, title])

  const counts = useMemo(() => {
    const rows = data?.rows || []
    const r = data?.rules
    return {
      undercut: rows.filter((x) => x.undercut).length,
      aging: r ? rows.filter((x) => x.oldest_age_days != null && x.oldest_age_days >= r.aging_days).length : 0,
      low_margin: r ? rows.filter((x) => x.cost != null && x.price != null && marginFromPrice(x.cost, x.price) < r.min_margin_pct).length : 0,
      unpublished: rows.filter((x) => !x.is_published).length,
      differ: rows.filter((x) => x.prices_differ).length,
    } as Record<string, number>
  }, [data])

  const draftCount = Object.keys(draft).length

  // ---- staging helpers -------------------------------------------------------
  const stage = (id: string, price: number | null) => {
    setDraft((d) => {
      const next = { ...d }
      const row = data?.rows.find((r) => r.id === id)
      if (price == null || (row && row.price === price)) delete next[id]
      else next[id] = price
      return next
    })
  }

  const commitInline = (row: BoardRow, text: string) => {
    const trimmed = text.replace(/[₹,\s]/g, '')
    if (trimmed === '') { stage(row.id, null); return }
    const v = validatePrice(trimmed)
    if (!v.ok) { toast.error(`${row.full_sku_code}: ${v.error}`); return }
    stage(row.id, v.price)
  }

  const focusNext = (from: HTMLInputElement) => {
    const inputs = Array.from(listRef.current?.querySelectorAll<HTMLInputElement>('input[data-price-input]') || [])
    const i = inputs.indexOf(from)
    const next = inputs[i + 1]
    if (next) { next.focus(); next.select() }
  }

  const targets = (): BoardRow[] => {
    const ids = selected.size ? selected : null
    return visible.filter((r) => (ids ? ids.has(r.id) : false))
  }

  const stageBulk = () => {
    if (!rules) return
    const rowsToChange = targets()
    if (!rowsToChange.length) { toast.error('Tick the laptops you want to change first.'); return }
    const value = Number(opValue)
    if (!Number.isFinite(value)) { toast.error('Enter a number for the change.'); return }
    const op = { type: opKey, value } as BulkOp
    let applied = 0, skipped = 0
    const next = { ...draft }
    for (const r of rowsToChange) {
      const price = applyBulk(op, { current: r.price, cost: r.cost, competitorMin: r.comparable_min?.price ?? null }, rules.rounding)
      if (price == null) { skipped++; continue }
      if (price === r.price) { delete next[r.id]; continue }
      next[r.id] = price
      applied++
    }
    setDraft(next)
    toast.success(`Staged ${applied} price${applied === 1 ? '' : 's'}${skipped ? `; ${skipped} skipped (no competitor price, cost or current price)` : ''}. Review, then publish.`)
  }

  const stageSuggestions = () => {
    const pool = selected.size ? visible.filter((r) => selected.has(r.id)) : visible
    const withS = pool.filter((r) => r.suggestion)
    if (!withS.length) { toast.message('No suggestions for these laptops.'); return }
    setDraft((d) => { const n = { ...d }; for (const r of withS) n[r.id] = r.suggestion!.price; return n })
    toast.success(`Staged ${withS.length} suggested price${withS.length === 1 ? '' : 's'}. Review, then publish.`)
  }

  const toggle = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })
  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.id))

  // ---- actions ---------------------------------------------------------------
  const { run: checkNow, pending: checking } = useAsyncAction(async () => {
    const res = await apiFetch('/api/pricing/check', { method: 'POST', body: JSON.stringify({}) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error || 'Check failed'); return }
    for (const r of body.results || []) {
      if (r.status === 'error') toast.error(`${r.competitor}: ${r.message}`)
      else toast.success(`${r.competitor}: ${r.message}`)
    }
    await load()
  })

  const { run: undoLast, pending: undoing } = useAsyncAction(async () => {
    if (!window.confirm('Undo the last published batch of prices? Any laptop whose price changed again since is left alone.')) return
    const res = await apiFetch('/api/pricing/undo', { method: 'POST', body: JSON.stringify({}) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error || 'Could not undo'); return }
    toast.success(`Restored ${body.restored} price${body.restored === 1 ? '' : 's'}${body.skipped?.length ? `; ${body.skipped.length} left alone` : ''}`)
    await load()
  })

  const openRow = data?.rows.find((r) => r.id === openId) || null

  if (error) return <p className="text-sm text-destructive">Error: {error}</p>
  if (!data || !rules) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading prices…</div>

  const list = (
    <div ref={listRef}>
      <div className="space-y-2 pb-2">
        <Input placeholder="Search model, CPU, SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex gap-2">
          <select className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm" value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">All brands</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="age">Oldest stock first</option>
            <option value="gap">Most undercut first</option>
            <option value="margin">Lowest margin first</option>
            <option value="price">Highest price first</option>
            <option value="name">Name</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)}
              className={`rounded-full border px-2.5 py-1 text-xs ${filter === f.key ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
              {f.label}{f.key !== 'all' && counts[f.key] ? ` (${counts[f.key]})` : ''}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={allVisibleSelected} onCheckedChange={(v) => setSelected(v === true ? new Set(visible.map((r) => r.id)) : new Set())} />
          Select all {visible.length} shown
        </label>
      </div>

      <div className="space-y-1">
        {visible.map((r) => {
          const staged = draft[r.id]
          const shown = staged ?? r.price
          const margin = r.cost != null && shown != null ? marginFromPrice(r.cost, shown) : null
          const aging = r.oldest_age_days != null && r.oldest_age_days >= rules.aging_days
          const warn = staged != null ? priceWarnings(r.price, staged, r.cost, rules.min_margin_pct) : []
          const comp = r.comparable_min
          return (
            <div key={r.id} className={`rounded-lg border p-2 ${openId === r.id ? 'border-primary bg-primary/5' : ''} ${staged != null ? 'ring-1 ring-amber-400' : ''}`}>
              <div className="flex items-start gap-2">
                <Checkbox className="mt-1" checked={selected.has(r.id)} onCheckedChange={(v) => toggle(r.id, v === true)} />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenId(r.id)}>
                  <span className="block break-words text-sm font-medium">{title(r)}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    <span>{r.available} in stock</span>
                    {r.oldest_age_days != null && <span>· oldest {r.oldest_age_days}d</span>}
                    {margin != null && <span className={margin < rules.min_margin_pct ? 'font-medium text-red-600' : ''}>· margin {margin.toFixed(0)}%</span>}
                    {!r.is_published && <Pill>Not published</Pill>}
                    {aging && <Pill tone="amber">Aging</Pill>}
                    {r.undercut && <Pill tone="red">Undercut</Pill>}
                    {r.prices_differ && <Pill tone="amber">Prices differ</Pill>}
                    {warn.includes('below_cost') && <Pill tone="red">Below cost</Pill>}
                    {warn.includes('below_margin') && <Pill tone="amber">Low margin</Pill>}
                  </span>
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
                <div className="flex items-center">
                  <span className="mr-1 text-sm text-muted-foreground">₹</span>
                  <Input
                    key={`${r.id}-${r.price}-${staged ?? ''}`}
                    data-price-input
                    inputMode="numeric"
                    defaultValue={shown ?? ''}
                    placeholder="price"
                    className={`h-8 w-28 tabular-nums ${staged != null ? 'border-amber-400 bg-amber-50' : ''}`}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={(e) => commitInline(r, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitInline(r, e.currentTarget.value); focusNext(e.currentTarget) }
                      if (e.key === 'Escape') { e.currentTarget.value = String(r.price ?? ''); stage(r.id, null); e.currentTarget.blur() }
                    }}
                  />
                </div>
                {staged != null && r.price != null && <span className="text-xs tabular-nums text-amber-700">was {inr(r.price)}</span>}
                {comp && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {comp.competitor} {inr(comp.price)}
                    {r.price != null && <span className={comp.price < (shown ?? 0) ? 'ml-1 text-red-600' : 'ml-1 text-green-700'}>({comp.price < (shown ?? 0) ? '−' : '+'}{inr(Math.abs(comp.price - (shown ?? 0)))})</span>}
                  </span>
                )}
                {r.suggestion && staged !== r.suggestion.price && (
                  <button type="button" onClick={() => stage(r.id, r.suggestion!.price)} className="rounded border border-primary/40 bg-primary/5 px-2 py-0.5 text-xs text-primary hover:bg-primary/10" title={r.suggestion.reason}>
                    Suggest {inr(r.suggestion.price)}
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {visible.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No laptops match these filters.</p>}
      </div>
    </div>
  )

  return (
    <div className="space-y-3 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Price Board</h1>
          <p className="text-sm text-muted-foreground">Type a new price, or tick several laptops and change them together. Nothing goes live until you review and publish.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setRulesOpen(true)}><SlidersHorizontal className="size-3.5" /> Rules</Button>
          {data.last_batch && (
            <Button variant="outline" size="sm" onClick={undoLast} disabled={undoing} title={`${data.last_batch.count} price(s), ${timeAgo(data.last_batch.changed_at)}`}>
              <Undo2 className="size-3.5" /> Undo last publish
            </Button>
          )}
          <Button size="sm" onClick={checkNow} disabled={checking}>
            {checking ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Check competitors
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Competitor prices:{' '}
        {data.competitors.length === 0 ? 'none added (Website SEO → Competitor websites).' : data.competitors.map((c) => `${c.label} ${c.listings ? `${c.listings} listings, ${timeAgo(c.last_checked)}` : 'not checked yet'}`).join(' · ')}
      </p>

      {selected.size > 0 && (
        <div className="rounded-lg border bg-muted/40 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium">{selected.size} selected</span>
            <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setSelected(new Set())}>Clear selection</button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Change</label>
              <select className="h-8 rounded-md border bg-background px-2 text-sm" value={opKey} onChange={(e) => { const k = e.target.value as BulkOp['type']; setOpKey(k); setOpValue(BULK_OPS.find((o) => o.key === k)!.placeholder.replace('-', '')) }}>
                {BULK_OPS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{BULK_OPS.find((o) => o.key === opKey)!.unit}</label>
              <Input className="w-24" inputMode="decimal" value={opValue} onChange={(e) => setOpValue(e.target.value)} />
            </div>
            <Button size="sm" onClick={stageBulk}>Stage changes</Button>
            <Button size="sm" variant="outline" onClick={stageSuggestions}>Use suggestions</Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Results are rounded ({rules.rounding === 'none' ? 'exact rupee' : rules.rounding === 'hundred' ? 'to ₹100' : rules.rounding === 'ten' ? 'to ₹10' : `ending ${rules.rounding}`}) and never below your minimum margin without a warning.</p>
        </div>
      )}

      <Panes
        bp="xl"
        open={openRow != null}
        onBack={() => setOpenId(null)}
        backLabel="Back to laptops"
        listClassName="xl:w-[34rem]"
        list={list}
      >
        {openRow ? (
          <DetailPane
            row={openRow}
            title={title(openRow)}
            rules={rules}
            staged={draft[openRow.id]}
            onStage={(p) => stage(openRow.id, p)}
            onDecision={load}
          />
        ) : (
          <p className="hidden text-sm text-muted-foreground xl:block">Pick a laptop to see its cost, competitor prices and price history.</p>
        )}
      </Panes>

      {draftCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 py-3 shadow-lg backdrop-blur md:left-64">
          <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-2">
            <span className="text-sm"><span className="font-semibold">{draftCount}</span> price change{draftCount === 1 ? '' : 's'} staged, not live yet</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setDraft({})}>Discard</Button>
              <Button size="sm" onClick={() => setReviewing(true)}>Review &amp; publish</Button>
            </div>
          </div>
        </div>
      )}

      <ReviewDialog
        open={reviewing}
        onClose={() => setReviewing(false)}
        rows={data.rows}
        draft={draft}
        rules={rules}
        onPublished={(batchId, applied) => {
          setReviewing(false)
          setDraft({})
          setSelected(new Set())
          toast.success(`${applied} price${applied === 1 ? '' : 's'} updated. Live on the website within about a minute.`)
          load()
        }}
      />
      <RulesDialog open={rulesOpen} onClose={() => setRulesOpen(false)} rules={rules} onSaved={load} />
    </div>
  )
}

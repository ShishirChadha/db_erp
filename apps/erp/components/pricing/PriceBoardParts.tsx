'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { SimpleModal } from '@/components/SimpleModal'
import { Pill } from '@/components/MasterDetail'
import { marginFromPrice, priceWarnings, type RoundingStyle } from '@/lib/pricing'
import CompetitorMatrix from './CompetitorMatrix'
import { inr, timeAgo, type BoardRow, type PricingRules } from './types'

// ---------------------------------------------------------------------------
// Review & publish
// ---------------------------------------------------------------------------
export function ReviewDialog({ open, onClose, rows, draft, rules, onPublished }: {
  open: boolean
  onClose: () => void
  rows: BoardRow[]
  draft: Record<string, number>
  rules: PricingRules
  onPublished: (batchId: string | null, applied: number) => void
}) {
  const [confirm, setConfirm] = useState(false)
  useEffect(() => { if (open) setConfirm(false) }, [open])

  const items = rows.filter((r) => draft[r.id] != null && draft[r.id] !== r.price)
  const withWarn = items.map((r) => ({ r, next: draft[r.id], warnings: priceWarnings(r.price, draft[r.id], r.cost, rules.min_margin_pct) }))
  const blocking = withWarn.filter((x) => x.warnings.includes('below_cost') || x.warnings.includes('below_margin'))

  const { run: publish, pending } = useAsyncAction(async () => {
    const res = await apiFetch('/api/pricing/publish', {
      method: 'POST',
      body: JSON.stringify({
        changes: items.map((r) => ({ sku_id: r.id, price: draft[r.id] })),
        reason: items.length > 1 ? 'bulk' : 'manual',
        confirm_warnings: confirm,
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error || 'Could not publish prices'); return }
    if (body.failed?.length) toast.error(`${body.failed.length} price(s) failed: ${body.failed[0].error}`)
    onPublished(body.batch_id, body.applied)
  })

  return (
    <SimpleModal isOpen={open} onClose={onClose} title={`Review ${items.length} price change${items.length === 1 ? '' : 's'}`} wide closeOnBackdropClick={false}>
      <div className="space-y-2 text-sm">
        {withWarn.map(({ r, next, warnings }) => {
          const delta = r.price ? ((next - r.price) / r.price) * 100 : null
          return (
            <div key={r.id} className="rounded border p-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="min-w-0 break-words font-medium">{r.brand} {r.model_name}</span>
                <span className="tabular-nums">
                  <span className="text-muted-foreground line-through">{inr(r.price)}</span> → <span className="font-semibold">{inr(next)}</span>
                  {delta != null && <span className={delta < 0 ? 'ml-1 text-red-600' : 'ml-1 text-green-700'}>{delta > 0 ? '+' : ''}{delta.toFixed(1)}%</span>}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                <span>{r.full_sku_code}</span>
                {r.cost != null && <span>· margin after {marginFromPrice(r.cost, next).toFixed(1)}%</span>}
                {warnings.includes('below_cost') && <Pill tone="red">Below cost</Pill>}
                {warnings.includes('below_margin') && <Pill tone="amber">Under {rules.min_margin_pct}% margin</Pill>}
                {warnings.includes('big_drop') && <Pill tone="amber">Drop over 15%</Pill>}
                {warnings.includes('big_rise') && <Pill tone="amber">Rise over 25%</Pill>}
              </div>
            </div>
          )
        })}
        {items.length === 0 && <p className="text-muted-foreground">Nothing to publish.</p>}
      </div>

      {blocking.length > 0 && (
        <label className="mt-4 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <Checkbox checked={confirm} onCheckedChange={(v) => setConfirm(v === true)} className="mt-0.5" />
          <span>{blocking.length} price{blocking.length === 1 ? ' is' : 's are'} below your {rules.min_margin_pct}% minimum margin (or below cost). I have checked and want to publish anyway.</span>
        </label>
      )}

      <p className="mt-3 text-xs text-muted-foreground">Website price and selling price change together. The storefront shows new prices within about a minute. You can undo this batch afterwards.</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={publish} disabled={pending || items.length === 0 || (blocking.length > 0 && !confirm)}>
          {pending ? 'Publishing…' : `Publish ${items.length} price${items.length === 1 ? '' : 's'}`}
        </Button>
      </div>
    </SimpleModal>
  )
}

// ---------------------------------------------------------------------------
// Pricing rules
// ---------------------------------------------------------------------------
export function RulesDialog({ open, onClose, rules, onSaved }: { open: boolean; onClose: () => void; rules: PricingRules; onSaved: () => void }) {
  const [f, setF] = useState({ ...rules })
  useEffect(() => { if (open) setF({ ...rules }) }, [open, rules])

  const { run: save, pending } = useAsyncAction(async () => {
    const res = await apiFetch('/api/pricing/settings', { method: 'PUT', body: JSON.stringify(f) })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error || 'Could not save'); return }
    toast.success('Pricing rules saved')
    onSaved()
    onClose()
  })

  const num = (k: keyof PricingRules, label: string, hint: string) => (
    <div>
      <label className="mb-1 block text-xs font-medium">{label}</label>
      <Input type="number" inputMode="decimal" value={String(f[k])} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} />
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  )

  return (
    <SimpleModal isOpen={open} onClose={onClose} title="Pricing rules" closeOnBackdropClick={false}>
      <div className="grid gap-3 sm:grid-cols-2">
        {num('min_margin_pct', 'Minimum margin (%)', 'Warn below this margin on price. Suggestions never go under it.')}
        {num('beat_by', 'Beat competitor by (₹)', 'Suggested price = competitor price minus this.')}
        {num('undercut_tolerance', 'Undercut tolerance (₹)', 'Competitor must be cheaper than you by more than this to count as undercutting.')}
        {num('aging_days', 'Old stock after (days)', 'Oldest unit of a model older than this is “aging”.')}
        {num('aging_drop_pct', 'Aging drop (%)', 'Size of the price drop suggested for aging stock.')}
        <div>
          <label className="mb-1 block text-xs font-medium">Rounding</label>
          <select className="h-8 w-full rounded-md border bg-background px-2 text-sm" value={f.rounding} onChange={(e) => setF({ ...f, rounding: e.target.value as RoundingStyle })}>
            <option value="none">None (exact rupee)</option>
            <option value="ten">Nearest ₹10</option>
            <option value="hundred">Nearest ₹100</option>
            <option value="99">Ends in 99 (₹28,499)</option>
            <option value="999">Ends in 999 (₹27,999)</option>
          </select>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Applied to bulk changes and suggestions, never to a price you type.</p>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Save rules'}</Button>
      </div>
    </SimpleModal>
  )
}

// ---------------------------------------------------------------------------
// Detail pane for one laptop
// ---------------------------------------------------------------------------
interface HistoryRow { id: string; old_price: number | null; new_price: number; reason: string; changed_at: string; undone_at: string | null }

export function DetailPane({ row, title, rules, staged, onStage, onDecision, refreshKey }: {
  row: BoardRow
  title: string
  rules: PricingRules
  staged: number | undefined
  onStage: (price: number) => void
  onDecision: () => void
  refreshKey: number
}) {
  const [history, setHistory] = useState<HistoryRow[] | null>(null)
  useEffect(() => {
    let live = true
    setHistory(null)
    apiFetch(`/api/pricing/history?sku_id=${row.id}`).then((r) => r.json()).then((d) => { if (live) setHistory(Array.isArray(d) ? d : []) }).catch(() => { if (live) setHistory([]) })
    return () => { live = false }
  }, [row.id, row.price])

  const cur = staged ?? row.price
  const margin = row.cost != null && cur != null ? marginFromPrice(row.cost, cur) : null

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold break-words">{title}</h2>
        <p className="text-sm text-muted-foreground">{row.full_sku_code} · {row.is_published ? 'Published on website' : 'Not published'}</p>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          <Link href={`/dashboard/pricing/cockpit?sku_id=${row.id}`} className="text-primary underline">Open full Price Cockpit</Link>
          <Link href="/dashboard/sku-master" className="text-primary underline">SKU Master</Link>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border p-3 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-muted-foreground">Price (website & store)</dt><dd className="font-semibold tabular-nums">{inr(row.price)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Average unit cost</dt><dd className="tabular-nums">{inr(row.cost)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Margin{staged != null ? ' (staged)' : ''}</dt><dd className={`tabular-nums ${margin != null && margin < rules.min_margin_pct ? 'text-red-600 font-medium' : ''}`}>{margin != null ? `${margin.toFixed(1)}%` : '—'}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Units available</dt><dd className="tabular-nums">{row.available}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Oldest unit</dt><dd className="tabular-nums">{row.oldest_age_days != null ? `${row.oldest_age_days} days` : '—'}</dd></div>
        <div><dt className="text-xs text-muted-foreground">MRP shown</dt><dd className="tabular-nums">{inr(row.market_price)}</dd></div>
      </dl>
      {row.prices_differ && <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs">Website price and selling price differ on this SKU. Publishing any price here makes them the same.</p>}

      {row.suggestion && (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
          <div className="font-medium">Suggested price {inr(row.suggestion.price)}</div>
          <p className="text-xs text-muted-foreground">{row.suggestion.reason}</p>
          <Button size="sm" className="mt-2" onClick={() => onStage(row.suggestion!.price)}>Stage {inr(row.suggestion.price)}</Button>
        </div>
      )}

      <CompetitorMatrix skuId={row.id} refreshKey={refreshKey} onChanged={onDecision} />

      <section>
        <h3 className="mb-2 text-sm font-semibold">Price history</h3>
        {history == null ? <p className="text-sm text-muted-foreground">Loading…</p> : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes made from the Price Board yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1">
                <span className="tabular-nums">{inr(h.old_price)} → <span className="font-medium">{inr(h.new_price)}</span></span>
                <span className="text-xs text-muted-foreground">{h.reason}{h.undone_at ? ' · undone' : ''} · {timeAgo(h.changed_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

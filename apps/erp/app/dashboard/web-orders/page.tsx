'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import RequireOwner from '@/components/RequireOwner'
import { apiFetch } from '@/lib/api-client'
import { ErrorBanner } from '@/components/ErrorBanner'
import { StatCardsRow } from '@/components/StatCardsRow'
import { Pagination } from '@/components/Pagination'
import { EmptyTableRow } from '@/components/EmptyTableRow'
import { StatusBadge } from '@/components/StatusBadge'
import { ORDER_STATUS_TONES, toneFor } from '@/lib/status-styles'
import { useListPageSize } from '@/lib/useListPageSize'
import { useIsDesktopViewport } from '@/lib/useIsDesktopViewport'
import { useResizablePaneWidth } from '@/lib/useResizablePaneWidth'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AlertTriangle, Loader2, ExternalLink } from 'lucide-react'
import Link from 'next/link'

interface Reservation {
  id: string
  asset_id: string | null
  quantity: number
  expires_at: string
  released_at: string | null
  release_reason: string | null
}
interface OrderItem {
  id: string
  sku_id: string
  quantity: number
  unit_price: number
  title_snapshot: string | null
  erp_sale_id: string | null
  is_promotional_gift: boolean
  selected_upgrades: any
  web_reservations?: Reservation[]
}
interface WebOrder {
  id: string
  status: string
  total_amount: number
  discount_amount: number | null
  shipping_address: any
  razorpay_order_id: string | null
  razorpay_payment_id: string | null
  created_at: string
  paid_at: string | null
  cancel_reason: string | null
  conversion_error: string | null
  conversion_failed_at: string | null
  order_items: OrderItem[]
  customer_name: string | null
  customer_phone: string | null
  needs_reconciliation: boolean
}

const RESERVATION_TTL_MIN = 15

function money(n: number | null | undefined) {
  if (n === null || n === undefined) return '—'
  return `₹${Math.round(Number(n)).toLocaleString('en-IN')}`
}
function dt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
}

const CANCEL_REASONS: Record<string, string> = {
  sold_out: 'An item sold out while they were paying',
  payment_init_failed: 'Payment could not be started',
  reserve_error: 'Stock could not be reserved (system error)',
  customer_abandoned: 'Customer abandoned it',
}
const RELEASE_REASONS: Record<string, string> = {
  converted: 'became a sale',
  expired: 'hold lapsed (not paid in time)',
  aborted_sold_out: 'released — item sold out',
  aborted_payment_init: 'released — payment could not start',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}

function WebOrdersPage() {
  const [rows, setRows] = useState<WebOrder[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [flag, setFlag] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const PAGE_SIZE = useListPageSize()
  const isDesktop = useIsDesktopViewport()
  const { width: paneWidth } = useResizablePaneWidth('web-orders-list-pane-width')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    if (statusFilter) params.set('status', statusFilter)
    if (flag) params.set('flag', flag)
    if (from) params.set('from', from)
    if (to) params.set('to', to)

    const [listRes, countRes] = await Promise.all([
      apiFetch(`/api/web-orders?${params.toString()}`),
      apiFetch('/api/web-orders?counts=true'),
    ])
    if (!listRes.ok) {
      setError('Could not load website orders.')
      setRows([])
      setTotal(0)
    } else {
      const json = await listRes.json()
      const data: WebOrder[] = json.data || []
      setRows(data)
      setTotal(json.total || 0)
      if (json.queryErrors?.length) setError(json.queryErrors.join('; '))
      setActiveId((prev) => (prev && data.some((o) => o.id === prev) ? prev : isDesktop ? data[0]?.id ?? null : null))
    }
    if (countRes.ok) setCounts(await countRes.json())
    setLoading(false)
  }, [page, PAGE_SIZE, statusFilter, flag, from, to, isDesktop])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [statusFilter, flag, from, to])

  const active = useMemo(() => rows.find((o) => o.id === activeId) ?? null, [rows, activeId])

  const cards = useMemo(() => {
    const spec = [
      { key: 'needs_reconciliation', label: 'Needs attention', isFlag: true },
      { key: 'paid', label: 'Paid' },
      { key: 'pending_payment', label: 'Awaiting payment' },
      { key: 'expired', label: 'Expired' },
      { key: 'cancelled', label: 'Cancelled' },
      { key: 'total', label: 'All', isAll: true },
    ]
    return spec.map((sp) => ({
      label: sp.label,
      value: counts[sp.key] ?? 0,
      active: sp.isAll ? !statusFilter && !flag : sp.isFlag ? flag === sp.key : statusFilter === sp.key,
      onClick: () => {
        if (sp.isAll) { setStatusFilter(''); setFlag('') }
        else if (sp.isFlag) { setFlag(flag === sp.key ? '' : sp.key); setStatusFilter('') }
        else { setStatusFilter(statusFilter === sp.key ? '' : sp.key); setFlag('') }
      },
    }))
  }, [counts, statusFilter, flag])

  // A pending order older than the reservation TTL means the sweep cron has not
  // run when it should have -- itself worth seeing, not just a stale row.
  const stalePending = (o: WebOrder) =>
    o.status === 'pending_payment' &&
    Date.now() - new Date(o.created_at).getTime() > RESERVATION_TTL_MIN * 60_000

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Website Orders</h1>
        <p className="text-sm text-muted-foreground">
          Orders placed on digitalbluez.com. A paid order also appears in the Sales Ledger as a
          sale with &ldquo;Website&rdquo; as the salesperson.
        </p>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {(counts.needs_reconciliation ?? 0) > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            <strong>{counts.needs_reconciliation} order(s) need your attention.</strong> The customer
            paid, but the sale was never recorded in the ERP — usually because the stock hold lapsed
            just before the payment arrived, so the item may already be gone. Stock and accounts are
            out of step until each one is sorted out by hand.
          </span>
        </div>
      )}

      <StatCardsRow cards={cards} />

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">From</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-auto" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">To</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-auto" />
        </div>
        {(from || to || statusFilter || flag) && (
          <Button variant="outline" size="sm" className="h-8"
            onClick={() => { setFrom(''); setTo(''); setStatusFilter(''); setFlag('') }}>
            Clear
          </Button>
        )}
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
          No website orders yet. They will appear here the moment someone checks out.
        </div>
      ) : (
        <div className="flex gap-4">
          {/* List pane */}
          <div
            className={cn('w-full md:flex-shrink-0 flex flex-col', active && 'hidden md:flex')}
            style={isDesktop ? { width: paneWidth } : undefined}
          >
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="p-2 font-medium">Date</th>
                    <th className="p-2 font-medium">Customer</th>
                    <th className="p-2 font-medium">Status</th>
                    <th className="p-2 font-medium text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <EmptyTableRow colSpan={4} message="No orders match these filters." />}
                  {rows.map((o) => (
                    <tr
                      key={o.id}
                      onClick={() => setActiveId(o.id)}
                      className={cn('border-t border-border cursor-pointer hover:bg-muted/50',
                        activeId === o.id && 'bg-primary/5')}
                    >
                      <td className="p-2 whitespace-nowrap">{dt(o.created_at)}</td>
                      <td className="p-2">
                        <div className="truncate max-w-[12rem]">{o.customer_name || '—'}</div>
                        {o.customer_phone && <div className="text-xs text-muted-foreground">{o.customer_phone}</div>}
                      </td>
                      <td className="p-2">
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge tone={toneFor(ORDER_STATUS_TONES, o.status)}>
                            {o.status.replace(/_/g, ' ')}
                          </StatusBadge>
                          {o.needs_reconciliation && (
                            <span className="text-[10px] uppercase tracking-wide text-destructive">needs attention</span>
                          )}
                        </div>
                      </td>
                      <td className="p-2 text-right tabular-nums">{money(o.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </div>

          {/* Detail pane */}
          {active && (
            <div className="w-full md:flex-1 rounded-md border border-border p-4 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">Order {active.id.slice(0, 8)}</div>
                  <div className="text-xs text-muted-foreground">{dt(active.created_at)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={toneFor(ORDER_STATUS_TONES, active.status)}>
                    {active.status.replace(/_/g, ' ')}
                  </StatusBadge>
                  <Button variant="ghost" size="sm" className="h-8 md:hidden" onClick={() => setActiveId(null)}>
                    Back
                  </Button>
                </div>
              </div>

              {active.needs_reconciliation && (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive space-y-1">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                      <strong>Paid, but not recorded as a sale.</strong> One or more items on this order
                      never became a sale in the ERP, so stock and accounts disagree. Check whether the
                      unit is still available and record the sale by hand.
                    </span>
                  </div>
                  {active.conversion_error && (
                    <p className="pl-6 font-mono text-xs">{active.conversion_error}</p>
                  )}
                  {active.conversion_failed_at && (
                    <p className="pl-6 text-xs">Failed at {dt(active.conversion_failed_at)}</p>
                  )}
                </div>
              )}

              {stalePending(active) && (
                <div className="rounded-md border border-warning/20 bg-warning/10 p-3 text-sm text-warning">
                  Still awaiting payment after more than {RESERVATION_TTL_MIN} minutes. The stock hold
                  should have been released by now — if this persists, the clean-up job may not be running.
                </div>
              )}

              {active.status === 'cancelled' && active.cancel_reason && (
                <div className="rounded-md border border-border p-3 text-sm">
                  <span className="text-muted-foreground">Cancelled because: </span>
                  {CANCEL_REASONS[active.cancel_reason] ?? active.cancel_reason}
                </div>
              )}

              <div className="rounded-md border border-border p-3">
                <Field label="Customer">{active.customer_name || '—'}</Field>
                <Field label="Phone">{active.customer_phone || '—'}</Field>
                <Field label="Total">{money(active.total_amount)}</Field>
                {Number(active.discount_amount) > 0 && (
                  <Field label="Discount">{money(active.discount_amount)}</Field>
                )}
                <Field label="Paid at">{dt(active.paid_at)}</Field>
                {active.razorpay_payment_id && (
                  <Field label="Razorpay payment"><span className="font-mono text-xs">{active.razorpay_payment_id}</span></Field>
                )}
              </div>

              {active.shipping_address && (
                <div className="rounded-md border border-border p-3 text-sm">
                  <div className="text-muted-foreground mb-1">Shipping to</div>
                  <div>{active.shipping_address.name}</div>
                  <div className="text-muted-foreground">
                    {[active.shipping_address.line1, active.shipping_address.city,
                      active.shipping_address.state, active.shipping_address.pincode]
                      .filter(Boolean).join(', ')}
                  </div>
                  {active.shipping_address.phone && (
                    <div className="text-muted-foreground">{active.shipping_address.phone}</div>
                  )}
                </div>
              )}

              <div>
                <div className="text-sm font-medium mb-1.5">Items</div>
                <div className="rounded-md border border-border divide-y divide-border">
                  {(active.order_items || []).map((it) => (
                    <div key={it.id} className="p-2.5 space-y-1.5 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate">
                            {it.title_snapshot || it.sku_id.slice(0, 8)}
                            {it.is_promotional_gift && (
                              <span className="ml-1.5 text-xs text-purple">free gift</span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground tabular-nums">
                            {it.quantity} × {money(it.unit_price)}
                          </div>
                        </div>
                        {it.erp_sale_id ? (
                          <Link href="/dashboard/sales" className="text-xs text-info inline-flex items-center gap-1 shrink-0">
                            recorded <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : active.status === 'paid' ? (
                          <span className="text-xs text-destructive shrink-0">not recorded</span>
                        ) : null}
                      </div>

                      {/* Which physical unit was held, and what became of the
                          hold. Nothing surfaced this before. */}
                      {(it.web_reservations || []).map((r) => (
                        <div key={r.id} className="text-xs text-muted-foreground pl-1">
                          {r.asset_id ? `Unit ${r.asset_id.slice(0, 8)}` : `${r.quantity} from stock`}
                          {' · '}
                          {r.released_at
                            ? (RELEASE_REASONS[r.release_reason ?? ''] ?? `released ${dt(r.released_at)}`)
                            : `held until ${dt(r.expires_at)}`}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              {/* Deliberately read-only. Every write here would touch real money
                  or real stock, and the only code that knows how to do that
                  correctly is the storefront's own conversion path -- importing
                  it would duplicate the GST and stock logic. A retry action
                  belongs here once a real order has actually failed. */}
              <p className="text-xs text-muted-foreground">
                This page is read-only. Recording a missed sale, refunding or cancelling is still done
                by hand, so that money and stock only ever move through the paths that already know how.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function WebOrdersPageGuarded() {
  return (
    <RequireOwner>
      <WebOrdersPage />
    </RequireOwner>
  )
}

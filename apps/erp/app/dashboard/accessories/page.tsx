'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useIsDesktopViewport } from '@/lib/useIsDesktopViewport'
import { useRole } from '@/lib/auth/useRole'
import RequirePageAccess from '@/components/RequirePageAccess'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { Pagination } from '@/components/Pagination'
import type { Vendor } from '@/components/AddVendorDialog'
import { cn } from '@/lib/utils'
import { AccessoryDetailPage } from './[id]/page'

// Modal dialogs only render behind a click (gated by a state flag) -- code-split
// out of the initial bundle rather than shipped unconditionally.
const SkuFormModal = dynamic(() => import('@/components/SkuFormModal').then(m => m.SkuFormModal), { ssr: false })
const AddVendorDialog = dynamic(() => import('@/components/AddVendorDialog').then(m => m.AddVendorDialog), { ssr: false })

const PAGE_SIZE = 25
const PAYMENT_ACCOUNTS = ['Digitalbluez', 'Techtenth', 'Cash']

// Accessories are sku_master rows like everything else (see docs/decisions.md,
// 2026-07-23) -- this page is just SKU Master filtered to the non-serialized
// categories (no per-unit asset_ledger row; tracked by quantity alone).
const ACCESSORY_CATEGORIES = ['RAM', 'SSD', 'CPU', 'GPU', 'KBD', 'MOUSE', 'ACC', 'ADP']

interface AccessorySku {
  id: string
  full_sku_code: string
  category: string
  brand: string
  model_name: string
  sku_description: string
  base_cost: number | null
  selling_price_default: number | null
  quantity_in_stock: number
  status: string
}

interface CategoryTemplate {
  category: string
  display_name: string
  field_schema: any
  sku_code_format?: string
}

interface PoBacklog {
  sku_id: string
  quantity: number
}


// Records stock received (batteries, RAM, SSD, mice, bags, etc.) via the shared
// quantity-only movement endpoint -- quantity_in_stock is trigger-maintained off
// stock_movements the same way every other sku_master category already works, so
// this never writes the quantity column directly. Vendor + unit price are optional --
// captured here so there's a record of "who was this bought from, at what price" even
// before the owner's separate, formal Attach-PO step (see docs/decisions.md). Unlike
// laptop/PO vendor+cost, this is visible to every role by design.
function ReceiveStockControl({ skuId, onDone }: { skuId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [qty, setQty] = useState<number | ''>('')
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [vendorId, setVendorId] = useState('')
  // People naturally have the invoice's total in hand (e.g. "10 sticks for ₹5000"),
  // not a pre-divided per-unit figure -- ask for the total and derive unit_price
  // ourselves so the stored/displayed per-unit price is always correct.
  const [totalPrice, setTotalPrice] = useState<number | ''>('')
  const [gstPercentage, setGstPercentage] = useState<number | ''>('')
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10))
  const [paymentAccount, setPaymentAccount] = useState(PAYMENT_ACCOUNTS[0])
  const [remarks, setRemarks] = useState('')
  const [err, setErr] = useState('')
  const [addVendorOpen, setAddVendorOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    apiFetch('/api/vendors').then(res => res.json()).then((data) => setVendors(Array.isArray(data) ? data : []))
  }, [open])

  const { run: receive, pending: busy } = useAsyncAction(async () => {
    setErr('')
    if (!qty || qty <= 0) { setErr('Enter a quantity > 0.'); return }
    const res = await apiFetch(`/api/sku-master/${skuId}/stock-movement`, {
      method: 'POST',
      body: JSON.stringify({
        movement_type: 'receipt',
        quantity_change: qty,
        notes: remarks || 'Stock received',
        vendor_id: vendorId || undefined,
        unit_price: totalPrice === '' ? undefined : totalPrice / qty,
        gst_percentage: gstPercentage === '' ? undefined : gstPercentage,
        purchase_date: purchaseDate || undefined,
        payment_account: paymentAccount,
      }),
    })
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error || 'Failed to record stock.'); return }
    setOpen(false); setQty(''); setVendorId(''); setTotalPrice(''); setGstPercentage(''); setPurchaseDate(new Date().toISOString().slice(0, 10))
    setPaymentAccount(PAYMENT_ACCOUNTS[0]); setRemarks('')
    onDone()
  })

  if (!open) {
    return (
      <Button variant="link" size="sm" onClick={() => setOpen(true)} className="text-primary text-xs whitespace-nowrap">
        Receive Stock
      </Button>
    )
  }

  return (
    <div className="border rounded p-2 bg-muted space-y-1 w-56">
      {err && <div className="text-destructive text-xs">{err}</div>}
      <input
        type="number"
        min={1}
        value={qty}
        onChange={(e) => setQty(e.target.value === '' ? '' : Number(e.target.value))}
        placeholder="Qty"
        className="border p-1 w-full rounded text-xs"
      />
      <label className="block text-[10px] text-muted-foreground">
        Purchase date
        <input
          type="date"
          value={purchaseDate}
          onChange={(e) => setPurchaseDate(e.target.value)}
          className="border p-1 w-full rounded text-xs mt-0.5"
        />
      </label>
      <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="border p-1 w-full rounded text-xs">
        <option value="">Vendor (optional)...</option>
        {vendors.map(v => <option key={v.id} value={v.id}>{v.company_name}</option>)}
      </select>
      <Button variant="link" size="sm" onClick={() => setAddVendorOpen(true)} className="text-primary text-xs">
        + Add new vendor
      </Button>
      <input
        type="number"
        min={0}
        value={totalPrice}
        onChange={(e) => setTotalPrice(e.target.value === '' ? '' : Number(e.target.value))}
        placeholder="Total price paid (optional)"
        className="border p-1 w-full rounded text-xs"
      />
      <input
        type="number"
        min={0}
        max={100}
        value={gstPercentage}
        onChange={(e) => setGstPercentage(e.target.value === '' ? '' : Number(e.target.value))}
        placeholder="GST % (optional)"
        className="border p-1 w-full rounded text-xs"
      />
      <select value={paymentAccount} onChange={(e) => setPaymentAccount(e.target.value)} className="border p-1 w-full rounded text-xs">
        {PAYMENT_ACCOUNTS.map(a => <option key={a} value={a}>{a}</option>)}
      </select>
      <input
        type="text"
        value={remarks}
        onChange={(e) => setRemarks(e.target.value)}
        placeholder="Remarks (optional, editable later)"
        className="border p-1 w-full rounded text-xs"
      />
      <div className="flex gap-1">
        <button onClick={() => setOpen(false)} disabled={busy} className="text-xs px-2 py-1 rounded bg-muted flex-1">Cancel</button>
        <button onClick={() => receive()} disabled={busy} className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground flex-1 inline-flex items-center justify-center gap-1">
          {busy && <Loader2 className="size-3 animate-spin" />}
          Receive
        </button>
      </div>
      {addVendorOpen && (
        <AddVendorDialog
          onClose={() => setAddVendorOpen(false)}
          onAdded={(vendor) => {
            setVendors((prev) => (prev.some((v) => v.id === vendor.id) ? prev : [...prev, vendor]))
            setVendorId(vendor.id)
            setAddVendorOpen(false)
          }}
        />
      )}
    </div>
  )
}

// Owner-only: corrects a miscounted quantity via the same shared movement endpoint
// as Receive Stock, just movement_type 'adjustment' -- can go either direction
// (positive to add, negative to remove), unlike Receive Stock which is receipt-only.
function AdjustQuantityControl({ skuId, onDone }: { skuId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [delta, setDelta] = useState<number | ''>('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')

  const { run: adjust, pending: busy } = useAsyncAction(async () => {
    setErr('')
    if (delta === '' || delta === 0) { setErr('Enter a non-zero adjustment.'); return }
    const res = await apiFetch(`/api/sku-master/${skuId}/stock-movement`, {
      method: 'POST',
      body: JSON.stringify({ movement_type: 'adjustment', quantity_change: delta, notes: reason || 'Quantity correction' }),
    })
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error || 'Failed to adjust stock.'); return }
    setOpen(false); setDelta(''); setReason('')
    onDone()
  })

  if (!open) {
    return (
      <Button variant="link" size="sm" onClick={() => setOpen(true)} className="text-muted-foreground text-xs whitespace-nowrap">
        Correct Quantity
      </Button>
    )
  }

  return (
    <div className="border rounded p-2 bg-muted space-y-1 w-56">
      {err && <div className="text-destructive text-xs">{err}</div>}
      <input
        type="number"
        value={delta}
        onChange={(e) => setDelta(e.target.value === '' ? '' : Number(e.target.value))}
        placeholder="e.g. -2 or 5"
        className="border p-1 w-full rounded text-xs"
      />
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (e.g. recount)"
        className="border p-1 w-full rounded text-xs"
      />
      <div className="flex gap-1">
        <button onClick={() => setOpen(false)} disabled={busy} className="text-xs px-2 py-1 rounded bg-muted flex-1">Cancel</button>
        <button onClick={() => adjust()} disabled={busy} className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground flex-1 inline-flex items-center justify-center gap-1">
          {busy && <Loader2 className="size-3 animate-spin" />}
          Apply
        </button>
      </div>
    </div>
  )
}

// Owner-only: archive/reactivate. sku_master.status already had this concept in
// the schema, just never surfaced -- the only removal path was a hard DELETE,
// which fails once the SKU has any real purchase/sale history (exactly when
// archiving is what's actually wanted).
function ArchiveControl({ sku, onDone }: { sku: AccessorySku; onDone: () => void }) {
  const { run: toggle, pending: busy } = useAsyncAction(async () => {
    const nextStatus = sku.status === 'active' ? 'archived' : 'active'
    const res = await apiFetch(`/api/sku-master/${sku.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: nextStatus }),
    })
    if (res.ok) onDone()
  })

  return (
    <Button variant="link" size="sm" onClick={() => toggle()} disabled={busy} className="text-muted-foreground text-xs whitespace-nowrap inline-flex items-center gap-1">
      {busy && <Loader2 className="size-3 animate-spin" />}
      {sku.status === 'active' ? 'Archive' : 'Reactivate'}
    </Button>
  )
}

// Owner-only: attaches a real vendor/PO/cost to this SKU's still-unattached stock-in
// movements (mirrors the laptop "attach to PO" flow, but quantity-based -- no asset
// numbers to mint). Only shown when there's an actual backlog for this SKU. Two modes:
// mint a brand-new PO (original behaviour), or fold this backlog into an existing PO
// (e.g. the laptop(s) on the same vendor invoice already got their own PO -- this
// puts the RAM/accessory line on that same PO instead of a second one).
function AttachPoControl({ skuId, backlogQty, defaultVendorId, onDone }: { skuId: string; backlogQty: number; defaultVendorId?: string; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [vendorId, setVendorId] = useState('')
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10))
  const [quantity, setQuantity] = useState<number | ''>(backlogQty)
  const [costPrice, setCostPrice] = useState<number | ''>('')
  const [gstPercentage, setGstPercentage] = useState<number>(18)
  const [poSearch, setPoSearch] = useState('')
  const [poResults, setPoResults] = useState<{ id: string; po_number: string; vendor_name: string; po_status: string }[]>([])
  const [selectedPo, setSelectedPo] = useState<{ id: string; po_number: string } | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open) return
    apiFetch('/api/vendors').then(res => res.json()).then((data) => setVendors(Array.isArray(data) ? data : []))
    // Pre-fill from whatever vendor the employee last logged at receipt time -- just a
    // convenience since both flows now reference the same vendors table; still editable.
    if (defaultVendorId) setVendorId((current) => current || defaultVendorId)
  }, [open, defaultVendorId])

  useEffect(() => {
    if (!open || mode !== 'existing' || !poSearch) { setPoResults([]); return }
    let cancelled = false
    const params = new URLSearchParams({ search: poSearch, status: 'draft,submitted,partially_received,received,invoiced' })
    apiFetch(`/api/purchase-orders?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => !cancelled && setPoResults((Array.isArray(data) ? data : []).slice(0, 15)))
    return () => { cancelled = true }
  }, [open, mode, poSearch])

  const { run: attach, pending: busy } = useAsyncAction(async () => {
    setErr('')
    if (costPrice === '' || costPrice < 0) { setErr('Enter a valid cost.'); return }
    if (quantity === '' || quantity <= 0 || quantity > backlogQty) { setErr(`Enter a quantity between 1 and ${backlogQty}.`); return }

    if (mode === 'new') {
      if (!vendorId) { setErr('Select a vendor.'); return }
      const res = await apiFetch('/api/purchase-orders/from-accessory-stock', {
        method: 'POST',
        body: JSON.stringify({
          sku_id: skuId, vendor_id: vendorId, po_date: poDate,
          cost_price: costPrice, gst_percentage: gstPercentage, quantity,
        }),
      })
      if (!res.ok) { setErr((await res.json().catch(() => ({}))).error || 'Failed to attach PO.'); return }
      setOpen(false)
      onDone()
      return
    }

    if (!selectedPo) { setErr('Select a PO to attach to.'); return }
    const attachBody = { sku_id: skuId, cost_price: costPrice, gst_percentage: gstPercentage, quantity }
    let res = await apiFetch(`/api/purchase-orders/${selectedPo.id}/attach-accessory-stock`, {
      method: 'POST',
      body: JSON.stringify(attachBody),
    })
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      if (e.error_code === 'already_invoiced') {
        if (!confirm(`${e.error}\n\nProceed anyway?`)) return
        res = await apiFetch(`/api/purchase-orders/${selectedPo.id}/attach-accessory-stock`, {
          method: 'POST',
          body: JSON.stringify({ ...attachBody, confirm_despite_invoice: true }),
        })
      }
      if (!res.ok) {
        setErr((await res.json().catch(() => ({}))).error || 'Failed to attach to PO.')
        return
      }
    }
    setOpen(false)
    onDone()
  })

  if (!open) {
    return (
      <Button
        variant="link"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-warning text-xs whitespace-nowrap"
        title="Units received but not yet on a purchase order -- independent of how many have since sold. This count only ever grows when stock is received, never shrinks when stock sells."
      >
        {backlogQty} received, awaiting PO -- Attach
      </Button>
    )
  }

  return (
    <div className="border rounded p-2 bg-muted space-y-1 w-64">
      {err && <div className="text-destructive text-xs">{err}</div>}
      <div className="flex gap-1 text-xs">
        <button onClick={() => setMode('new')} className={`flex-1 px-2 py-1 rounded ${mode === 'new' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>New PO</button>
        <button onClick={() => setMode('existing')} className={`flex-1 px-2 py-1 rounded ${mode === 'existing' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>Existing PO</button>
      </div>

      {mode === 'new' ? (
        <>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="border p-1 w-full rounded text-xs">
            <option value="">Select vendor...</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.company_name}</option>)}
          </select>
          <input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} className="border p-1 w-full rounded text-xs" />
        </>
      ) : (
        <>
          {selectedPo ? (
            <div className="flex items-center justify-between border rounded p-1 text-xs bg-card">
              <span>{selectedPo.po_number}</span>
              <button onClick={() => setSelectedPo(null)} className="text-muted-foreground underline">Change</button>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={poSearch}
                onChange={(e) => setPoSearch(e.target.value)}
                placeholder="Search PO number..."
                className="border p-1 w-full rounded text-xs"
              />
              {poResults.length > 0 && (
                <div className="border rounded max-h-28 overflow-y-auto bg-card">
                  {poResults.map((po) => (
                    <button
                      key={po.id}
                      onClick={() => { setSelectedPo({ id: po.id, po_number: po.po_number }); setPoResults([]) }}
                      className="block w-full text-left px-2 py-1 text-xs hover:bg-muted border-b last:border-b-0"
                    >
                      {po.po_number} — {po.vendor_name} ({po.po_status.replace(/_/g, ' ')})
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      <div>
        <label className="text-xs text-muted-foreground">Quantity to attach (of {backlogQty} available)</label>
        <input
          type="number"
          min={1}
          max={backlogQty}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}
          className="border p-1 w-full rounded text-xs"
        />
      </div>
      <div className="flex gap-1">
        <input type="number" value={costPrice} onChange={(e) => setCostPrice(e.target.value === '' ? '' : Number(e.target.value))} placeholder="Unit cost" className="border p-1 w-full rounded text-xs" />
        <input type="number" value={gstPercentage} onChange={(e) => setGstPercentage(Number(e.target.value))} placeholder="GST%" className="border p-1 w-16 rounded text-xs" />
      </div>
      <div className="flex gap-1">
        <button onClick={() => setOpen(false)} disabled={busy} className="text-xs px-2 py-1 rounded bg-muted flex-1">Cancel</button>
        <button onClick={() => attach()} disabled={busy} className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground flex-1 inline-flex items-center justify-center gap-1">
          {busy && <Loader2 className="size-3 animate-spin" />}
          Attach {quantity || ''}
        </button>
      </div>
    </div>
  )
}

// Left-pane list row -- name, category/brand, in-stock qty and selling price are
// the most-scannable columns from the old wide table; cost/last-vendor (owner-only)
// and the action controls (Receive/Sell/Adjust/Attach PO/Archive) live in the detail
// pane's toolbar instead, matching how PurchaseOrderListItem/CustomerListItem keep
// the compact row minimal and put everything actionable in the detail pane.
function AccessoryListItem({ sku, active, onOpen }: {
  sku: AccessorySku
  active: boolean
  onOpen: () => void
}) {
  const displayName = sku.sku_description || sku.model_name || sku.full_sku_code
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'w-full text-left px-3 py-2.5 border-b border-border flex items-start gap-2.5 transition-colors',
        active ? 'bg-primary/10' : 'hover:bg-muted',
        sku.status !== 'active' && 'opacity-50'
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-sm text-foreground truncate">{displayName}</span>
          <span className="text-sm font-medium tabular-nums whitespace-nowrap text-foreground">
            {sku.selling_price_default ? `₹${sku.selling_price_default.toFixed(2)}` : '—'}
          </span>
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {sku.full_sku_code} — {sku.category}{sku.brand ? ` · ${sku.brand}` : ''}
        </p>
        <div className="flex items-center justify-between gap-2 mt-1.5">
          <span className="text-xs text-muted-foreground whitespace-nowrap">In stock: {sku.quantity_in_stock}</span>
          {sku.status !== 'active' && <span className="text-xs text-muted-foreground capitalize">({sku.status})</span>}
        </div>
      </div>
    </button>
  )
}

// Right-pane detail view -- embeds the existing per-SKU history page (reconciliation
// summary, purchase history, movement ledger, edit-receipt) and adds a toolbar above
// it for every action the old table row exposed that isn't part of that page itself:
// Receive Stock, Sell, Correct Quantity, Attach PO, Archive/Reactivate -- calling the
// exact same handlers already defined in AccessoriesPage, just from here instead of a
// table row (same placement pattern as PurchaseOrderDetailPane/InvoiceDetailPane).
function AccessoryDetailPane({
  sku, isOwner, backlogQty, defaultVendorId, onBack, onDone, onSell,
}: {
  sku: AccessorySku
  isOwner: boolean
  backlogQty: number | undefined
  defaultVendorId: string | undefined
  onBack: () => void
  onDone: () => void
  onSell: () => void
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 pb-0">
        <button type="button" onClick={onBack} className="md:hidden mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="size-4" /> Back to list
        </button>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pb-3 border-b border-border">
          {sku.status === 'active' && <ReceiveStockControl skuId={sku.id} onDone={onDone} />}
          {sku.status === 'active' && sku.quantity_in_stock > 0 && (
            <Button variant="link" size="sm" onClick={onSell} className="text-success text-xs whitespace-nowrap">
              Sell
            </Button>
          )}
          {isOwner && sku.status === 'active' && <AdjustQuantityControl skuId={sku.id} onDone={onDone} />}
          {isOwner && backlogQty != null && backlogQty > 0 && (
            <AttachPoControl skuId={sku.id} backlogQty={backlogQty} defaultVendorId={defaultVendorId} onDone={onDone} />
          )}
          {isOwner && <ArchiveControl sku={sku} onDone={onDone} />}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 pt-2">
        <AccessoryDetailPage key={sku.id} skuId={sku.id} embedded />
      </div>
    </div>
  )
}

function AccessoriesPage() {
  const router = useRouter()
  const { isOwner } = useRole()
  const [skus, setSkus] = useState<AccessorySku[]>([])
  const [templates, setTemplates] = useState<CategoryTemplate[]>([])
  // searchInput updates on every keystroke; search catches up 300ms after typing
  // stops and is what actually drives fetchAll -- same debounce pattern as
  // StockView/Sales Ledger/Repair Jobs.
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(timer)
  }, [searchInput])
  const [purchasedFrom, setPurchasedFrom] = useState('')
  const [purchasedTo, setPurchasedTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [poBacklog, setPoBacklog] = useState<Map<string, number>>(new Map())
  // Only used to prefill AttachPoControl's default vendor -- the per-SKU "last
  // vendor (PO)" display itself now lives in the embedded detail page's own
  // "Cost & Last Vendor" section (fetched fresh per SKU), so the old bulk
  // last-vendors fetch that fed the removed table column is no longer needed.
  const [lastEntries, setLastEntries] = useState<Map<string, { vendor_id: string; vendor_name: string; unit_price: number | null; gst_percentage: number | null; purchase_date: string | null }>>(new Map())
  const [showArchived, setShowArchived] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ category: ACCESSORY_CATEGORIES.join(',') })
    if (search) params.set('search', search)
    if (purchasedFrom) params.set('purchased_from', purchasedFrom)
    if (purchasedTo) params.set('purchased_to', purchasedTo)
    if (showArchived) params.set('status', 'all')
    params.set('page', String(page))
    params.set('limit', String(PAGE_SIZE))
    const [skuRes, backlogRes] = await Promise.all([
      apiFetch(`/api/sku-master?${params.toString()}`),
      isOwner ? apiFetch('/api/purchase-orders/from-accessory-stock') : Promise.resolve(null),
    ])
    let loadedSkus: AccessorySku[] = []
    if (skuRes.ok) {
      const json = await skuRes.json()
      loadedSkus = json.data || []
      setSkus(loadedSkus)
      setTotal(json.total || 0)
    } else {
      setSkus([])
    }
    if (backlogRes?.ok) {
      const backlog: PoBacklog[] = await backlogRes.json()
      setPoBacklog(new Map(backlog.map((b) => [b.sku_id, b.quantity])))
    }
    if (loadedSkus.length > 0) {
      const entryRes = await apiFetch(`/api/sku-master/last-entry-vendors?ids=${loadedSkus.map((s) => s.id).join(',')}`)
      if (entryRes.ok) setLastEntries(new Map(Object.entries(await entryRes.json())))
    } else {
      setLastEntries(new Map())
    }
    setLoading(false)
  }, [search, purchasedFrom, purchasedTo, isOwner, showArchived, page])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Any filter change invalidates the current page's meaning -- reset to page 1.
  useEffect(() => { setPage(1) }, [search, purchasedFrom, purchasedTo, showArchived])

  useEffect(() => {
    apiFetch('/api/sku-category-templates').then(res => res.json()).then((all) => {
      setTemplates(Array.isArray(all) ? all.filter((t: CategoryTemplate) => ACCESSORY_CATEGORIES.includes(t.category)) : [])
    })
  }, [])

  // Which accessory SKU is open in the right-hand detail pane.
  const [activeSkuId, setActiveSkuId] = useState<string | null>(null)
  const isDesktop = useIsDesktopViewport()

  useEffect(() => {
    // Auto-open the first row on load/refetch -- but only when nothing is selected
    // yet, or the previously active SKU fell off this page/filter, so re-fetching
    // after an action doesn't yank focus away from what the user is looking at
    // (matches Customers/Purchase Orders).
    setActiveSkuId((prev) => (prev && skus.some((s) => s.id === prev)) ? prev : (isDesktop ? (skus[0]?.id ?? null) : null))
  }, [skus])

  const activeSku = useMemo(() => skus.find((s) => s.id === activeSkuId) ?? null, [skus, activeSkuId])

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Accessories</h1>
        <button onClick={() => setModalOpen(true)} className="bg-primary text-primary-foreground px-4 py-2 rounded text-sm">
          + New Accessory Type
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-4">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search accessories..."
          className="border p-2 rounded"
        />
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Purchased from
          <input
            type="date"
            value={purchasedFrom}
            onChange={(e) => setPurchasedFrom(e.target.value)}
            className="border p-1.5 rounded"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          to
          <input
            type="date"
            value={purchasedTo}
            onChange={(e) => setPurchasedTo(e.target.value)}
            className="border p-1.5 rounded"
          />
        </label>
        {isOwner && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked={showArchived} onCheckedChange={(v) => setShowArchived(!!v)} />
            Show archived
          </label>
        )}
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : (
        <div className="flex-1 min-h-0 border rounded overflow-hidden flex">
          {/* List pane -- hidden on mobile once a SKU is open, matching an email
              client's drill-in navigation; always visible at md+. */}
          <div className={cn('w-full md:w-[300px] lg:w-[360px] md:flex-shrink-0 border-r border-border flex flex-col', activeSku && 'hidden md:flex')}>
            <div className="flex-1 overflow-y-auto">
              {skus.map((s) => (
                <AccessoryListItem
                  key={s.id}
                  sku={s}
                  active={s.id === activeSkuId}
                  onOpen={() => setActiveSkuId(s.id)}
                />
              ))}
              {skus.length === 0 && (
                <p className="p-4 text-center text-sm text-muted-foreground">No accessories found.</p>
              )}
            </div>
            <div className="border-t border-border p-2">
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
            </div>
          </div>

          {/* Detail pane -- full width on mobile (replaces the list), flex-1 at md+. */}
          <div className={cn('flex-1 min-w-0', !activeSku && 'hidden md:flex md:items-center md:justify-center')}>
            {activeSku ? (
              <AccessoryDetailPane
                sku={activeSku}
                isOwner={isOwner}
                backlogQty={poBacklog.get(activeSku.id)}
                defaultVendorId={lastEntries.get(activeSku.id)?.vendor_id}
                onBack={() => setActiveSkuId(null)}
                onDone={fetchAll}
                onSell={() => router.push(`/dashboard/entry/sell?accessory_id=${activeSku.id}&return_to=%2Fdashboard%2Faccessories`)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Select an accessory to view details.</p>
            )}
          </div>
        </div>
      )}

      {modalOpen && (
        <SkuFormModal
          templates={templates}
          existingSku={null}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); fetchAll() }}
        />
      )}
    </div>
  )
}

export default function AccessoriesPageGuarded() {
  return (
    <RequirePageAccess pageKey="accessories">
      <AccessoriesPage />
    </RequirePageAccess>
  )
}

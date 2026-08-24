'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useRole } from '@/lib/auth/useRole'
import RequirePageAccess from '@/components/RequirePageAccess'
import { Checkbox } from '@/components/ui/checkbox'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { SkuFormModal } from '@/components/SkuFormModal'
import { Pagination } from '@/components/Pagination'
import { AddVendorDialog, type Vendor } from '@/components/AddVendorDialog'

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
  const [unitPrice, setUnitPrice] = useState<number | ''>('')
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
        unit_price: unitPrice === '' ? undefined : unitPrice,
        purchase_date: purchaseDate || undefined,
        payment_account: paymentAccount,
      }),
    })
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error || 'Failed to record stock.'); return }
    setOpen(false); setQty(''); setVendorId(''); setUnitPrice(''); setPurchaseDate(new Date().toISOString().slice(0, 10))
    setPaymentAccount(PAYMENT_ACCOUNTS[0]); setRemarks('')
    onDone()
  })

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-blue-600 underline text-xs whitespace-nowrap">
        Receive Stock
      </button>
    )
  }

  return (
    <div className="border rounded p-2 bg-gray-50 space-y-1 w-56">
      {err && <div className="text-red-600 text-xs">{err}</div>}
      <input
        type="number"
        min={1}
        value={qty}
        onChange={(e) => setQty(e.target.value === '' ? '' : Number(e.target.value))}
        placeholder="Qty"
        className="border p-1 w-full rounded text-xs"
      />
      <label className="block text-[10px] text-gray-500">
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
      <button onClick={() => setAddVendorOpen(true)} className="text-blue-600 underline text-xs">
        + Add new vendor
      </button>
      <input
        type="number"
        min={0}
        value={unitPrice}
        onChange={(e) => setUnitPrice(e.target.value === '' ? '' : Number(e.target.value))}
        placeholder="Unit price (optional)"
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
        <button onClick={() => setOpen(false)} disabled={busy} className="text-xs px-2 py-1 rounded bg-gray-100 flex-1">Cancel</button>
        <button onClick={() => receive()} disabled={busy} className="text-xs px-2 py-1 rounded bg-blue-600 text-white flex-1 inline-flex items-center justify-center gap-1">
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
      <button onClick={() => setOpen(true)} className="text-gray-600 underline text-xs whitespace-nowrap">
        Correct Quantity
      </button>
    )
  }

  return (
    <div className="border rounded p-2 bg-gray-50 space-y-1 w-56">
      {err && <div className="text-red-600 text-xs">{err}</div>}
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
        <button onClick={() => setOpen(false)} disabled={busy} className="text-xs px-2 py-1 rounded bg-gray-100 flex-1">Cancel</button>
        <button onClick={() => adjust()} disabled={busy} className="text-xs px-2 py-1 rounded bg-blue-600 text-white flex-1 inline-flex items-center justify-center gap-1">
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
    <button onClick={() => toggle()} disabled={busy} className="text-gray-600 underline text-xs whitespace-nowrap inline-flex items-center gap-1">
      {busy && <Loader2 className="size-3 animate-spin" />}
      {sku.status === 'active' ? 'Archive' : 'Reactivate'}
    </button>
  )
}

// Owner-only: attaches a real vendor/PO/cost to this SKU's still-unattached stock-in
// movements (mirrors the laptop "attach to PO" flow, but quantity-based -- no asset
// numbers to mint). Only shown when there's an actual backlog for this SKU.
function AttachPoControl({ skuId, backlogQty, defaultVendorId, onDone }: { skuId: string; backlogQty: number; defaultVendorId?: string; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [vendorId, setVendorId] = useState('')
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10))
  const [costPrice, setCostPrice] = useState<number | ''>('')
  const [gstPercentage, setGstPercentage] = useState<number>(18)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open) return
    apiFetch('/api/vendors').then(res => res.json()).then((data) => setVendors(Array.isArray(data) ? data : []))
    // Pre-fill from whatever vendor the employee last logged at receipt time -- just a
    // convenience since both flows now reference the same vendors table; still editable.
    if (defaultVendorId) setVendorId((current) => current || defaultVendorId)
  }, [open, defaultVendorId])

  const { run: attach, pending: busy } = useAsyncAction(async () => {
    setErr('')
    if (!vendorId) { setErr('Select a vendor.'); return }
    if (costPrice === '' || costPrice < 0) { setErr('Enter a valid cost.'); return }
    const res = await apiFetch('/api/purchase-orders/from-accessory-stock', {
      method: 'POST',
      body: JSON.stringify({
        sku_id: skuId, vendor_id: vendorId, po_date: poDate,
        cost_price: costPrice, gst_percentage: gstPercentage,
      }),
    })
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error || 'Failed to attach PO.'); return }
    setOpen(false)
    onDone()
  })

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-amber-700 underline text-xs whitespace-nowrap"
        title="Units received but not yet on a purchase order -- independent of how many have since sold. This count only ever grows when stock is received, never shrinks when stock sells."
      >
        {backlogQty} received, awaiting PO -- Attach
      </button>
    )
  }

  return (
    <div className="border rounded p-2 bg-gray-50 space-y-1 w-56">
      {err && <div className="text-red-600 text-xs">{err}</div>}
      <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="border p-1 w-full rounded text-xs">
        <option value="">Select vendor...</option>
        {vendors.map(v => <option key={v.id} value={v.id}>{v.company_name}</option>)}
      </select>
      <input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} className="border p-1 w-full rounded text-xs" />
      <div className="flex gap-1">
        <input type="number" value={costPrice} onChange={(e) => setCostPrice(e.target.value === '' ? '' : Number(e.target.value))} placeholder="Unit cost" className="border p-1 w-full rounded text-xs" />
        <input type="number" value={gstPercentage} onChange={(e) => setGstPercentage(Number(e.target.value))} placeholder="GST%" className="border p-1 w-16 rounded text-xs" />
      </div>
      <div className="flex gap-1">
        <button onClick={() => setOpen(false)} disabled={busy} className="text-xs px-2 py-1 rounded bg-gray-100 flex-1">Cancel</button>
        <button onClick={() => attach()} disabled={busy} className="text-xs px-2 py-1 rounded bg-blue-600 text-white flex-1 inline-flex items-center justify-center gap-1">
          {busy && <Loader2 className="size-3 animate-spin" />}
          Attach
        </button>
      </div>
    </div>
  )
}

function AccessoriesPage() {
  const router = useRouter()
  const { isOwner } = useRole()
  const [skus, setSkus] = useState<AccessorySku[]>([])
  const [templates, setTemplates] = useState<CategoryTemplate[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [poBacklog, setPoBacklog] = useState<Map<string, number>>(new Map())
  const [lastVendors, setLastVendors] = useState<Map<string, string>>(new Map())
  const [lastEntries, setLastEntries] = useState<Map<string, { vendor_id: string; vendor_name: string; unit_price: number | null; purchase_date: string | null }>>(new Map())
  const [showArchived, setShowArchived] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ category: ACCESSORY_CATEGORIES.join(',') })
    if (search) params.set('search', search)
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
    if (isOwner && loadedSkus.length > 0) {
      const vendorRes = await apiFetch(`/api/sku-master/last-vendors?ids=${loadedSkus.map((s) => s.id).join(',')}`)
      if (vendorRes.ok) setLastVendors(new Map(Object.entries(await vendorRes.json())))
    } else {
      setLastVendors(new Map())
    }
    if (loadedSkus.length > 0) {
      const entryRes = await apiFetch(`/api/sku-master/last-entry-vendors?ids=${loadedSkus.map((s) => s.id).join(',')}`)
      if (entryRes.ok) setLastEntries(new Map(Object.entries(await entryRes.json())))
    } else {
      setLastEntries(new Map())
    }
    setLoading(false)
  }, [search, isOwner, showArchived, page])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Any filter change invalidates the current page's meaning -- reset to page 1.
  useEffect(() => { setPage(1) }, [search, showArchived])

  useEffect(() => {
    apiFetch('/api/sku-category-templates').then(res => res.json()).then((all) => {
      setTemplates(Array.isArray(all) ? all.filter((t: CategoryTemplate) => ACCESSORY_CATEGORIES.includes(t.category)) : [])
    })
  }, [])

  const displayName = (s: AccessorySku) => s.sku_description || s.model_name || s.full_sku_code

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Accessories</h1>
        <button onClick={() => setModalOpen(true)} className="bg-blue-600 text-white px-4 py-2 rounded text-sm">
          + New Accessory Type
        </button>
      </div>

      <div className="flex items-center gap-4 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search accessories..."
          className="border p-2 rounded"
        />
        {isOwner && (
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <Checkbox checked={showArchived} onCheckedChange={(v) => setShowArchived(!!v)} />
            Show archived
          </label>
        )}
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th className="p-2 w-10 text-right">#</th>
                  <th className="p-2">Name</th>
                  <th className="p-2">Category</th>
                  <th className="p-2">Brand</th>
                  <th className="p-2 text-right">In Stock</th>
                  <th className="p-2 text-right">Selling Price</th>
                  <th className="p-2" title="Vendor/price optionally logged by whoever received the stock -- visible to everyone.">Last Purchase</th>
                  {isOwner && <th className="p-2 text-right">Cost</th>}
                  {isOwner && <th className="p-2">Last Vendor (PO)</th>}
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {skus.length === 0 && (
                  <tr><td colSpan={isOwner ? 10 : 8} className="p-4 text-center text-sm text-gray-400">No accessories found.</td></tr>
                )}
                {skus.map((s, idx) => (
                  <tr key={s.id} className={s.status !== 'active' ? 'opacity-50' : ''}>
                    <td className="p-2 text-right tabular-nums text-gray-400">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                    <td className="p-2">
                      <Link href={`/dashboard/accessories/${s.id}`} className="text-blue-600 underline">
                        {displayName(s)}
                      </Link>
                      {s.status !== 'active' && <span className="ml-2 text-xs text-gray-400 capitalize">({s.status})</span>}
                    </td>
                    <td className="p-2">{s.category}</td>
                    <td className="p-2">{s.brand || '—'}</td>
                    <td className="p-2 text-right tabular-nums">{s.quantity_in_stock}</td>
                    <td className="p-2 text-right tabular-nums">{s.selling_price_default ? `₹${s.selling_price_default.toFixed(2)}` : '—'}</td>
                    <td className="p-2 text-xs">
                      {lastEntries.has(s.id) ? (
                        <>
                          {lastEntries.get(s.id)!.vendor_name}
                          {lastEntries.get(s.id)!.unit_price != null && (
                            <span className="text-gray-500"> @ ₹{lastEntries.get(s.id)!.unit_price!.toFixed(2)}</span>
                          )}
                          {lastEntries.get(s.id)!.purchase_date && (
                            <div className="text-gray-400">{lastEntries.get(s.id)!.purchase_date!.slice(0, 10)}</div>
                          )}
                        </>
                      ) : '—'}
                    </td>
                    {isOwner && <td className="p-2 text-right tabular-nums">{s.base_cost != null ? `₹${s.base_cost.toFixed(2)}` : '—'}</td>}
                    {isOwner && <td className="p-2">{lastVendors.get(s.id) || '—'}</td>}
                    <td className="p-2">
                      <div className="flex flex-col gap-1 items-start">
                        {s.status === 'active' && <ReceiveStockControl skuId={s.id} onDone={fetchAll} />}
                        {s.status === 'active' && s.quantity_in_stock > 0 && (
                          <button onClick={() => router.push(`/dashboard/entry/sell?accessory_id=${s.id}&return_to=%2Fdashboard%2Faccessories`)} className="text-green-700 underline text-xs">
                            Sell
                          </button>
                        )}
                        {isOwner && s.status === 'active' && <AdjustQuantityControl skuId={s.id} onDone={fetchAll} />}
                        {isOwner && poBacklog.has(s.id) && (
                          <AttachPoControl skuId={s.id} backlogQty={poBacklog.get(s.id)!} defaultVendorId={lastEntries.get(s.id)?.vendor_id} onDone={fetchAll} />
                        )}
                        {isOwner && <ArchiveControl sku={s} onDone={fetchAll} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </>
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

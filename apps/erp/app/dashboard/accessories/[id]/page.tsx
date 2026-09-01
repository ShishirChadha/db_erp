'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'
import { useRole } from '@/lib/auth/useRole'
import RequirePageAccess from '@/components/RequirePageAccess'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AddVendorDialog, type Vendor } from '@/components/AddVendorDialog'

const PAYMENT_ACCOUNTS = ['Digitalbluez', 'Techtenth', 'Cash']

interface Movement {
  id: string
  movement_type: string
  quantity_change: number
  quantity_before: number | null
  quantity_after: number | null
  po_number: string | null
  vendor_id: string | null
  vendor_name: string | null
  unit_price: number | null
  purchase_date: string | null
  payment_account: string | null
  notes: string | null
  created_at: string
}

interface Purchase {
  po_number: string | null
  po_date: string | null
  vendor_name: string | null
  quantity: number
  unit_price: number
  gst_percentage: number
  line_total: number
}

interface HistoryResponse {
  sku: {
    id: string
    full_sku_code: string
    sku_description: string
    category: string
    brand: string | null
    model_name: string | null
    quantity_in_stock: number
    status: string
    selling_price_default: number | null
  }
  summary: { received: number; sold: number; adjusted: number; in_stock: number }
  movements: Movement[]
  purchases?: Purchase[]
  cost_price?: number | null
  last_vendor?: string | null
}

const MOVEMENT_LABELS: Record<string, string> = {
  receipt: 'Received',
  sale: 'Sold',
  adjustment: 'Adjusted',
}

// Notes are meant to be a quick, temporary remark at entry time -- this lets anyone with
// access come back and fix it up later without re-recording the whole movement (see
// docs/decisions.md).
function EditableNote({ movementId, notes, onSaved }: { movementId: string; notes: string | null; onSaved: (notes: string | null) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(notes || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    setBusy(true)
    setErr('')
    const res = await apiFetch(`/api/stock-movements/${movementId}`, {
      method: 'PATCH',
      body: JSON.stringify({ notes: value }),
    })
    setBusy(false)
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error || 'Failed to save.'); return }
    const updated = await res.json()
    onSaved(updated.notes)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        onClick={() => { setValue(notes || ''); setEditing(true) }}
        className="text-left text-muted-foreground hover:text-foreground hover:underline w-full"
        title="Click to edit"
      >
        {notes || '—'}
      </button>
    )
  }

  return (
    <div className="space-y-1 min-w-[10rem]">
      {err && <div className="text-destructive text-xs">{err}</div>}
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="border p-1 w-full rounded text-xs"
        autoFocus
      />
      <div className="flex gap-1">
        <button onClick={() => setEditing(false)} disabled={busy} className="text-xs px-2 py-0.5 rounded bg-muted">Cancel</button>
        <button onClick={save} disabled={busy} className="text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground">Save</button>
      </div>
    </div>
  )
}

// Corrects a receipt's vendor/price/purchase-date/payment-account/notes -- everything
// captured optionally at receipt time, for when the wrong amount or vendor got typed in.
// Quantity is intentionally not editable here: trg_sync_sku_stock only fires on INSERT,
// so editing a past quantity would silently desync quantity_in_stock and corrupt every
// later movement's before/after running total for this SKU -- use "Correct Quantity"
// (a real 'adjustment' entry) for that instead. Only ever shown for movement_type
// 'receipt' (see docs/decisions.md).
function EditReceiptDialog({ movement, onClose, onSaved }: { movement: Movement; onClose: () => void; onSaved: (patch: Partial<Movement>) => void }) {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [vendorId, setVendorId] = useState(movement.vendor_id || '')
  const [unitPrice, setUnitPrice] = useState<number | ''>(movement.unit_price ?? '')
  const [purchaseDate, setPurchaseDate] = useState(movement.purchase_date || '')
  const [paymentAccount, setPaymentAccount] = useState(movement.payment_account || PAYMENT_ACCOUNTS[0])
  const [notes, setNotes] = useState(movement.notes || '')
  const [addVendorOpen, setAddVendorOpen] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    apiFetch('/api/vendors').then(res => res.json()).then((data) => setVendors(Array.isArray(data) ? data : []))
  }, [])

  const { run: submit, pending: busy } = useAsyncAction(async () => {
    setErr('')
    const res = await apiFetch(`/api/stock-movements/${movement.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        vendor_id: vendorId || null,
        unit_price: unitPrice === '' ? null : unitPrice,
        purchase_date: purchaseDate || null,
        payment_account: paymentAccount || null,
        notes,
      }),
    })
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error || 'Failed to save.'); return }
    onSaved(await res.json())
  })

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Receipt</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {err && <div className="text-destructive text-xs">{err}</div>}
            <label className="block text-xs text-muted-foreground">
              Purchase date
              <input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="border p-1 w-full rounded text-sm mt-0.5"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              Vendor
              <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="border p-1 w-full rounded text-sm mt-0.5">
                <option value="">No vendor</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.company_name}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => setAddVendorOpen(true)} className="text-primary underline text-xs">
              + Add new vendor
            </button>
            <label className="block text-xs text-muted-foreground">
              Unit price
              <input
                type="number"
                min={0}
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value === '' ? '' : Number(e.target.value))}
                className="border p-1 w-full rounded text-sm mt-0.5"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              Payment account
              <select value={paymentAccount} onChange={(e) => setPaymentAccount(e.target.value)} className="border p-1 w-full rounded text-sm mt-0.5">
                {PAYMENT_ACCOUNTS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label className="block text-xs text-muted-foreground">
              Notes
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="border p-1 w-full rounded text-sm mt-0.5"
              />
            </label>
          </div>
          <div className="flex gap-3 mt-4">
            <Button className="flex-1 bg-primary hover:bg-primary/90" onClick={() => submit()} loading={busy}>
              Save
            </Button>
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {addVendorOpen && (
        <AddVendorDialog
          onClose={() => setAddVendorOpen(false)}
          onAdded={(v) => {
            setVendors((prev) => (prev.some((x) => x.id === v.id) ? prev : [...prev, v]))
            setVendorId(v.id)
            setAddVendorOpen(false)
          }}
        />
      )}
    </>
  )
}

function AccessoryDetailPage() {
  const params = useParams()
  const router = useRouter()
  const skuId = params.id as string
  const { isOwner } = useRole()

  const [data, setData] = useState<HistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingMovement, setEditingMovement] = useState<Movement | null>(null)

  const fetchHistory = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/sku-master/${skuId}/history`)
      if (!res.ok) throw new Error('Failed to load accessory history')
      setData(await res.json())
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [skuId])

  useEffect(() => { fetchHistory() }, [fetchHistory])

  if (loading) return <div className="p-4">Loading…</div>
  if (error) return <div className="p-4 text-destructive">Error: {error}</div>
  if (!data) return null

  const { sku, summary, movements, purchases, cost_price, last_vendor } = data
  const displayName = sku.sku_description || sku.model_name || sku.full_sku_code

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <button onClick={() => router.back()} className="text-sm text-muted-foreground mb-2">&larr; Back</button>
      <h1 className="text-2xl font-bold mb-1">{displayName}</h1>
      <p className="text-muted-foreground mb-4">
        {sku.full_sku_code} — {sku.category}{sku.brand ? ` · ${sku.brand}` : ''}
        {sku.status !== 'active' && <span className="ml-2 text-xs text-muted-foreground capitalize">({sku.status})</span>}
      </p>

      {/* Reconciliation summary -- the "why does in-stock show this number" answer,
          derived live from the same stock_movements ledger the trigger uses, so it
          can never disagree with quantity_in_stock itself. */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="border rounded-lg p-3 text-center">
          <div className="text-xs text-muted-foreground">Received</div>
          <div className="text-lg font-semibold tabular-nums">{summary.received}</div>
        </div>
        <div className="border rounded-lg p-3 text-center">
          <div className="text-xs text-muted-foreground">Sold</div>
          <div className="text-lg font-semibold tabular-nums">{summary.sold}</div>
        </div>
        <div className="border rounded-lg p-3 text-center">
          <div className="text-xs text-muted-foreground">Adjusted</div>
          <div className="text-lg font-semibold tabular-nums">{summary.adjusted >= 0 ? '+' : ''}{summary.adjusted}</div>
        </div>
        <div className="border rounded-lg p-3 text-center bg-info/15">
          <div className="text-xs text-muted-foreground">In Stock</div>
          <div className="text-lg font-semibold tabular-nums">{summary.in_stock}</div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-6">
        In stock = received + adjusted − sold. "Received" counts everything ever bought,
        regardless of how much has since sold — a purchase order for this item should
        reflect Received, not the current In Stock number.
      </p>

      {isOwner && (
        <div className="border rounded-lg p-4 mb-6">
          <h2 className="font-semibold mb-2">Cost &amp; Last Vendor</h2>
          <p className="text-sm text-muted-foreground">
            Current cost: {cost_price != null ? `₹${cost_price.toFixed(2)}` : '—'}
            {last_vendor && <> — Last purchased from <span className="font-medium">{last_vendor}</span></>}
          </p>
        </div>
      )}

      {isOwner && (
        <div className="border rounded-lg p-4 mb-6">
          <h2 className="font-semibold mb-3">Purchase History</h2>
          {!purchases || purchases.length === 0 ? (
            <p className="text-sm text-muted-foreground">No purchase orders recorded yet for this item.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border">
                <thead>
                  <tr>
                    <th className="border p-2">PO #</th>
                    <th className="border p-2">Date</th>
                    <th className="border p-2">Vendor</th>
                    <th className="border p-2 text-right">Qty</th>
                    <th className="border p-2 text-right">Unit Cost</th>
                    <th className="border p-2 text-right">GST %</th>
                    <th className="border p-2 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((p, idx) => (
                    <tr key={idx}>
                      <td className="border p-2">{p.po_number || '—'}</td>
                      <td className="border p-2">{p.po_date?.slice(0, 10) || '—'}</td>
                      <td className="border p-2">{p.vendor_name || '—'}</td>
                      <td className="border p-2 text-right tabular-nums">{p.quantity}</td>
                      <td className="border p-2 text-right tabular-nums">₹{p.unit_price?.toFixed(2)}</td>
                      <td className="border p-2 text-right tabular-nums">{p.gst_percentage}%</td>
                      <td className="border p-2 text-right tabular-nums">₹{p.line_total?.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="border rounded-lg p-4">
        <h2 className="font-semibold mb-3">Movement Ledger</h2>
        {movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stock movements recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border">
              <thead>
                <tr>
                  <th className="border p-2">Date</th>
                  <th className="border p-2">Type</th>
                  <th className="border p-2 text-right">Change</th>
                  <th className="border p-2 text-right">Before → After</th>
                  <th className="border p-2">PO #</th>
                  <th className="border p-2" title="Optionally logged by whoever received the stock -- visible to everyone.">Vendor</th>
                  <th className="border p-2 text-right">Price</th>
                  <th className="border p-2">Payment</th>
                  <th className="border p-2" title="Click a note to edit it">Notes</th>
                  <th className="border p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="border p-2">{(m.purchase_date || m.created_at)?.slice(0, 10)}</td>
                    <td className="border p-2">{MOVEMENT_LABELS[m.movement_type] || m.movement_type}</td>
                    <td className="border p-2 text-right tabular-nums">{m.quantity_change > 0 ? '+' : ''}{m.quantity_change}</td>
                    <td className="border p-2 text-right tabular-nums text-muted-foreground">
                      {m.quantity_before ?? '—'} → {m.quantity_after ?? '—'}
                    </td>
                    <td className="border p-2">{m.po_number || (m.movement_type === 'receipt' ? <span className="text-warning">awaiting PO</span> : '—')}</td>
                    <td className="border p-2">{m.vendor_name || '—'}</td>
                    <td className="border p-2 text-right tabular-nums">{m.unit_price != null ? `₹${m.unit_price.toFixed(2)}` : '—'}</td>
                    <td className="border p-2">{m.payment_account || '—'}</td>
                    <td className="border p-2">
                      <EditableNote
                        movementId={m.id}
                        notes={m.notes}
                        onSaved={(notes) => {
                          setData((prev) =>
                            prev
                              ? { ...prev, movements: prev.movements.map((mv) => (mv.id === m.id ? { ...mv, notes } : mv)) }
                              : prev
                          )
                        }}
                      />
                    </td>
                    <td className="border p-2">
                      {m.movement_type === 'receipt' && (
                        <button onClick={() => setEditingMovement(m)} className="text-primary underline text-xs whitespace-nowrap">
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editingMovement && (
        <EditReceiptDialog
          movement={editingMovement}
          onClose={() => setEditingMovement(null)}
          onSaved={(patch) => {
            setData((prev) =>
              prev
                ? { ...prev, movements: prev.movements.map((mv) => (mv.id === editingMovement.id ? { ...mv, ...patch } : mv)) }
                : prev
            )
            setEditingMovement(null)
          }}
        />
      )}
    </div>
  )
}

export default function AccessoryDetailPageGuarded() {
  return (
    <RequirePageAccess pageKey="accessories">
      <AccessoryDetailPage />
    </RequirePageAccess>
  )
}

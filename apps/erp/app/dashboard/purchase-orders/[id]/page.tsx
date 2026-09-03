'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import RequireOwner from '@/components/RequireOwner'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { EditPoItemDialog } from '@/components/EditPoItemDialog'
import { EditPoVendorDialog } from '@/components/EditPoVendorDialog'
import { AttachUnitsDialog } from '@/components/AttachUnitsDialog'
import { MoveUnitDialog } from '@/components/MoveUnitDialog'
import { AddVendorPaymentDialog } from '@/components/AddVendorPaymentDialog'

interface POItem {
  id: string
  line_item_number: number
  sku_id: string
  base_sku_code: string
  variant_number: number
  sku_code: string
  sku_description: string
  sku_brand: string
  sku_model: string
  sku_specs: Record<string, any>
  hsn_code: string
  quantity: number
  unit_price: number
  gst_percentage: number
  line_total: number
  asset_numbers_reserved: string[]
  serial_numbers: string[]
  units: { asset_number: string; serial_number: string | null; entry_date: string | null; status: string }[]
  sku_category: string | null
  is_serialized: boolean
  received_quantity: number
  notes?: string | null
}

interface PurchaseOrder {
  id: string
  po_number: string
  po_date: string
  vendor_id: string
  vendor_name: string
  po_status: string
  purchase_type: string
  purchased_by_type: string
  expected_delivery_date: string | null
  delivery_location: string | null
  remarks: string | null
  total_amount: number
  gst_total: number
  grand_total: number
  amount_paid: number
  payment_status: string
  items: POItem[]
}

interface VendorPayment {
  id: string
  amount: number
  payment_account: string | null
  paid_on: string
  method: string | null
  reference: string | null
  note: string | null
  recorded_at: string
  recorded_by_name: string | null
}

function PODetailPage() {
  const params = useParams()
  const router = useRouter()
  const poId = params.id as string

  const [po, setPo] = useState<PurchaseOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [showReceiveModal, setShowReceiveModal] = useState(false)
  const [receipts, setReceipts] = useState<Record<string, string>>({}) // serialized: asset_number -> serial
  const [fungibleReceipts, setFungibleReceipts] = useState<Record<string, number | ''>>({}) // fungible: po_item_id -> qty received now
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editingVendor, setEditingVendor] = useState(false)
  const [attachingUnits, setAttachingUnits] = useState(false)
  const [movingUnit, setMovingUnit] = useState<{ assetNumber: string; serialNumber: string | null; entryDate: string | null; skuLabel: string } | null>(null)
  const [removingAssetNumber, setRemovingAssetNumber] = useState<string | null>(null)
  const [payments, setPayments] = useState<VendorPayment[]>([])
  const [showAddPayment, setShowAddPayment] = useState(false)

  const fetchPO = async () => {
    setLoading(true)
    const res = await apiFetch(`/api/purchase-orders/${poId}`)
    if (res.ok) {
      const data = await res.json()
      // Ensure items is an array
      data.items = data.items || []
      setPo(data)
    }
    setLoading(false)
  }

  const loadPayments = async () => {
    const res = await apiFetch(`/api/purchase-orders/${poId}/payments`)
    if (res.ok) setPayments(await res.json())
  }

  useEffect(() => {
    fetchPO()
    loadPayments()
  }, [poId])

  const deletePayment = async (paymentId: string) => {
    if (!confirm('Remove this payment entry?')) return
    const res = await apiFetch(`/api/purchase-orders/${poId}/payments/${paymentId}`, { method: 'DELETE' })
    if (res.ok) {
      loadPayments()
      fetchPO()
    }
  }

  const { run: handleReceiveSubmit, pending: receiving } = useAsyncAction(async () => {
    if (!po) return
    const itemsPayload: any[] = []
    for (const item of po.items) {
      if (item.is_serialized) {
        const assetsToReceive = (item.asset_numbers_reserved || []).filter(asset => receipts[asset])
        if (assetsToReceive.length === 0) continue
        const assets = assetsToReceive.map(asset => ({ asset_number: asset, serial_number: receipts[asset] }))
        itemsPayload.push({ po_item_id: item.id, assets })
      } else {
        // Fungible line: a single quantity received now (no serials).
        const qty = fungibleReceipts[item.id]
        if (!qty || qty <= 0) continue
        itemsPayload.push({ po_item_id: item.id, quantity: qty })
      }
    }
    if (itemsPayload.length === 0) {
      alert('Nothing entered to receive.')
      return
    }
    const res = await apiFetch(`/api/purchase-orders/${poId}/receive`, {
      method: 'POST',
      body: JSON.stringify({ items: itemsPayload }),
    })
    if (res.ok) {
      const result = await res.json().catch(() => ({}))
      const promoted = result.promoted_count || 0
      alert(
        promoted > 0
          ? `Goods received successfully! (${promoted} matched existing employee-intake stock -- no duplicate stock added.)`
          : 'Goods received successfully!'
      )
      setShowReceiveModal(false)
      setReceipts({})
      setFungibleReceipts({})
      fetchPO()
      return
    }
    const err = await res.json().catch(() => ({}))
    // One or more serials already exist elsewhere in the system -- hard block, no
    // confirm-and-proceed override. Surface exactly which ones collided.
    if (err.error_code === 'duplicate_serial') {
      const lines = (err.duplicates || []).map((d: any) =>
        `${d.serial_number} -- already ${d.existing.asset_number || 'untagged'} (status: ${d.existing.status}, source: ${d.existing.source})`
      ).join('\n')
      alert(`${err.error}\n\n${lines}`)
      return
    }
    alert(err.error || 'Failed to receive goods.')
  })

  const { run: handleSubmitPO, pending: submittingPO } = useAsyncAction(async () => {
    const res = await apiFetch(`/api/purchase-orders/${poId}/submit`, { method: 'POST' })
    if (res.ok) {
      alert('PO submitted successfully.')
      fetchPO()
    } else {
      const err = await res.json().catch(() => ({}))
      alert(err.error || 'Submission failed')
    }
  })

  const { run: handleCancelPO, pending: cancellingPO } = useAsyncAction(async () => {
    if (!confirm('Are you sure you want to cancel this Purchase Order?')) return
    const res = await apiFetch(`/api/purchase-orders/${poId}`, {
      method: 'PUT',
      body: JSON.stringify({ po_status: 'cancelled' })
    })
    if (res.ok) {
      alert('Purchase Order cancelled.')
      fetchPO()
    } else {
      const err = await res.json().catch(() => ({}))
      alert(err.error || 'Failed to cancel PO')
    }
  })

  const { run: handleDeletePO, pending: deletingPO } = useAsyncAction(async () => {
    if (!confirm('PERMANENTLY DELETE this Purchase Order? All items and assets will be removed. This cannot be undone.')) return
    const res = await apiFetch(`/api/purchase-orders/${poId}/hard-delete`, { method: 'DELETE' })
    if (res.ok) {
      alert('Purchase Order permanently deleted.')
      router.push('/dashboard/purchase-orders')
    } else {
      const err = await res.json().catch(() => ({}))
      alert(err.error || 'Failed to delete PO')
    }
  })

  const handleRemoveUnit = async (assetNumber: string) => {
    if (removingAssetNumber) return
    if (!confirm(`Remove ${assetNumber} from this PO?`)) return
    setRemovingAssetNumber(assetNumber)
    try {
      const body = { asset_number: assetNumber }
      let res = await apiFetch(`/api/purchase-orders/${poId}/remove-unit`, { method: 'POST', body: JSON.stringify(body) })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        if (err.error_code === 'already_invoiced') {
          if (!confirm(`${err.error}\n\nProceed anyway?`)) return
          res = await apiFetch(`/api/purchase-orders/${poId}/remove-unit`, {
            method: 'POST',
            body: JSON.stringify({ ...body, confirm_despite_invoice: true }),
          })
        }
        if (!res.ok) {
          const err2 = await res.json().catch(() => ({}))
          alert(err2.error || 'Failed to remove unit.')
          return
        }
      }
      fetchPO()
    } finally {
      setRemovingAssetNumber(null)
    }
  }

  if (loading) return <div className="p-4">Loading PO...</div>
  if (!po) return <div className="p-4 text-destructive">Purchase Order not found.</div>

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <button onClick={() => router.push('/dashboard/purchase-orders')} className="text-sm text-muted-foreground hover:text-foreground mb-2">
        ← Back to Purchase Orders
      </button>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">{po.po_number}</h1>
        <span className={`px-2 py-1 rounded text-primary-foreground capitalize ${po.po_status === 'draft' ? 'bg-muted-foreground' : 'bg-success'}`}>
          {(po.po_status || '').replace('_', ' ')}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6 bg-card p-4 shadow rounded">
        <div>
          <p>
            <strong>Vendor:</strong> {po.vendor_name}
            {po.po_status !== 'cancelled' && (
              <button onClick={() => setEditingVendor(true)} className="ml-2 text-xs text-primary underline">Edit</button>
            )}
          </p>
          <p>
            <strong>PO Date:</strong> {po.po_date}
            {po.po_status !== 'cancelled' && (
              <button onClick={() => setEditingVendor(true)} className="ml-2 text-xs text-primary underline">Edit</button>
            )}
          </p>
          <p><strong>Expected Delivery:</strong> {po.expected_delivery_date || 'N/A'}</p>
        </div>
        <div>
          <p><strong>Type:</strong> {po.purchase_type} / {po.purchased_by_type}</p>
          <p><strong>Status:</strong> {(po.po_status || '').replace('_', ' ')}</p>
          <p><strong>Remarks:</strong> {po.remarks || '-'}</p>
        </div>
      </div>

      <div className="flex justify-between items-center mb-2">
        <h2 className="text-lg font-semibold">Line Items</h2>
        {po.po_status !== 'cancelled' && (
          <button onClick={() => setAttachingUnits(true)} className="text-sm text-primary underline">
            + Add Units from Stock
          </button>
        )}
      </div>
      <table className="min-w-full border mb-4 text-sm">
        <thead>
          <tr>
            <th className="border p-2">Item #</th>
            <th className="border p-2">SKU</th>
            <th className="border p-2">Specs</th>
            <th className="border p-2">HSN</th>
            <th className="border p-2">Qty</th>
            <th className="border p-2">Unit Price</th>
            <th className="border p-2">GST</th>
            <th className="border p-2">Line Total</th>
            <th className="border p-2">Assets Reserved</th>
            <th className="border p-2">Received</th>
            {po.po_status !== 'cancelled' && <th className="border p-2">Edit</th>}
          </tr>
        </thead>
        <tbody>
          {(po.items || []).map(item => {
            // Build specs summary
            const specsSummary = [
              item.sku_brand,
              item.sku_model,
              ...Object.entries(item.sku_specs || {})
                .filter(([_, val]) => val !== null && val !== '' && val !== undefined)
                .map(([key, val]) => `${key}: ${val}`)
            ].filter(Boolean).join(', ') || '—'

            return (
              <tr key={item.id}>
                <td className="border p-2">{item.line_item_number}</td>
                <td className="border p-2">
                  <div className="font-medium">{item.sku_code || `${item.base_sku_code}-${String(item.variant_number).padStart(3, '0')}`}</div>
                  <div className="text-xs text-muted-foreground">{item.sku_description}</div>
                </td>
                <td className="border p-2 text-xs text-muted-foreground">{specsSummary}</td>
                <td className="border p-2 text-xs">{item.hsn_code || '—'}</td>
                <td className="border p-2">{item.quantity}</td>
                <td className="border p-2">₹{(item.unit_price ?? 0).toFixed(2)}</td>
                <td className="border p-2">{item.gst_percentage}%</td>
                <td className="border p-2">₹{(item.line_total ?? 0).toFixed(2)}</td>
                <td className="border p-2 text-sm">
                  {item.is_serialized ? (
                    (item.units || []).length > 0 ? (
                      <div className="space-y-0.5">
                        {item.units.map((unit) => (
                          <div key={unit.asset_number} className="flex items-center gap-1">
                            <span>{unit.asset_number}</span>
                            <span className="text-xs text-muted-foreground">
                              ({unit.entry_date ? unit.entry_date.slice(0, 10) : 'no entry date'})
                            </span>
                            {po.po_status !== 'cancelled' && (
                              <button
                                onClick={() => setMovingUnit({
                                  assetNumber: unit.asset_number,
                                  serialNumber: unit.serial_number,
                                  entryDate: unit.entry_date,
                                  skuLabel: item.sku_code,
                                })}
                                className="text-xs text-muted-foreground hover:text-primary/80 underline"
                              >
                                Move
                              </button>
                            )}
                            {po.po_status !== 'cancelled' && (
                              <button
                                onClick={() => handleRemoveUnit(unit.asset_number)}
                                disabled={removingAssetNumber === unit.asset_number}
                                className="text-xs text-muted-foreground hover:text-destructive underline disabled:opacity-50"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : '-'
                  ) : <span className="text-muted-foreground">quantity item</span>}
                </td>
                <td className="border p-2 text-sm">
                  {item.is_serialized
                    ? ((item.serial_numbers || []).join(', ') || '-')
                    : `${item.received_quantity} of ${item.quantity}`}
                </td>
                {po.po_status !== 'cancelled' && (
                  <td className="border p-2 text-center">
                    <button onClick={() => setEditingItemId(item.id)} className="text-xs text-primary underline">Edit</button>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="text-right font-bold text-lg">
        Grand Total: ₹{(po.grand_total ?? 0).toFixed(2)}
      </div>

      <div className="border rounded p-3 space-y-2 mt-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Vendor Payment</p>
            <div className="text-sm capitalize">
              {po.payment_status} · ₹{(po.amount_paid ?? 0).toFixed(2)} of ₹{(po.grand_total ?? 0).toFixed(2)}
            </div>
          </div>
          {po.payment_status !== 'paid' && (
            <button
              onClick={() => setShowAddPayment(true)}
              className="border rounded px-3 py-1.5 text-sm hover:bg-muted"
            >
              Add Payment
            </button>
          )}
        </div>
        {payments.length > 0 && (
          <ul className="text-xs border-t pt-2 divide-y max-h-32 overflow-y-auto">
            {payments.map((p) => (
              <li key={p.id} className="py-1 flex items-center justify-between gap-2">
                <div>
                  ₹{p.amount.toFixed(2)}{p.payment_account ? ` · ${p.payment_account}` : ''}{p.method ? ` · ${p.method}` : ''}
                  {p.note ? ` · ${p.note}` : ''}
                  <div className="text-muted-foreground">
                    {new Date(p.paid_on).toLocaleDateString()}{p.recorded_by_name ? ` · ${p.recorded_by_name}` : ''}
                  </div>
                </div>
                <button type="button" onClick={() => deletePayment(p.id)} className="text-destructive underline shrink-0">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Buttons (unchanged, but make sure they also handle undefined status) */}
      {['submitted', 'partially_received'].includes(po.po_status || '') && (
        <div className="mt-4">
          <button onClick={() => setShowReceiveModal(true)} className="bg-primary text-primary-foreground px-4 py-2 rounded">
            Receive Goods
          </button>
        </div>
      )}

      {po.po_status === 'draft' && (
        <div className="mt-4">
          <button onClick={() => handleSubmitPO()} disabled={submittingPO} className="bg-success text-success-foreground px-4 py-2 rounded disabled:opacity-50 inline-flex items-center gap-1.5">
            {submittingPO && <Loader2 className="size-4 animate-spin" />}
            Submit PO
          </button>
        </div>
      )}

      {['draft', 'submitted'].includes(po.po_status || '') && (
        <div className="mt-4">
          <button onClick={() => handleCancelPO()} disabled={cancellingPO} className="bg-destructive text-destructive-foreground px-4 py-2 rounded disabled:opacity-50 inline-flex items-center gap-1.5">
            {cancellingPO && <Loader2 className="size-4 animate-spin" />}
            Cancel PO
          </button>
        </div>
      )}

      {['draft', 'cancelled'].includes(po.po_status || '') && (
        <div className="mt-4">
          <button onClick={() => handleDeletePO()} disabled={deletingPO} className="bg-destructive text-destructive-foreground px-4 py-2 rounded disabled:opacity-50 inline-flex items-center gap-1.5">
            {deletingPO && <Loader2 className="size-4 animate-spin" />}
            Delete PO
          </button>
        </div>
      )}

      {['submitted', 'partially_received', 'received', 'invoiced'].includes(po.po_status || '') && (
        <div className="mt-4">
          <button onClick={() => router.push(`/dashboard/purchase-invoices/new?po_id=${poId}`)} className="bg-purple text-primary-foreground px-4 py-2 rounded">
            Create Invoice
          </button>
        </div>
      )}

      {/* Receive Modal (unchanged) */}
      {showReceiveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-card p-6 rounded shadow-lg max-w-lg w-full">
            <h2 className="text-xl font-bold mb-4">Receive Goods</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Enter serial numbers for serialized units, or a received quantity for accessory lines.
            </p>
            {po.items.map(item => {
              const remaining = item.quantity - item.received_quantity
              return (
                <div key={item.id} className="mb-4">
                  <p className="font-medium">
                    {item.sku_code || `${item.base_sku_code}-${String(item.variant_number).padStart(3, '0')}`} (Qty: {item.quantity})
                    {!item.is_serialized && item.received_quantity > 0 && (
                      <span className="text-xs text-muted-foreground"> — {item.received_quantity} already received</span>
                    )}
                  </p>
                  {item.is_serialized ? (
                    (item.asset_numbers_reserved || []).map(asset => (
                      <div key={asset} className="flex items-center gap-2 mt-1">
                        <label className="w-24 text-sm">{asset}</label>
                        <input
                          type="text"
                          value={receipts[asset] || ''}
                          onChange={(e) => setReceipts(prev => ({ ...prev, [asset]: e.target.value }))}
                          className="border p-1 flex-1 rounded"
                          placeholder="Serial #"
                        />
                      </div>
                    ))
                  ) : remaining > 0 ? (
                    <div className="flex items-center gap-2 mt-1">
                      <label className="text-sm">Quantity received now:</label>
                      <input
                        type="number"
                        min={1}
                        max={remaining}
                        value={fungibleReceipts[item.id] ?? ''}
                        onChange={(e) => setFungibleReceipts(prev => ({ ...prev, [item.id]: e.target.value === '' ? '' : Number(e.target.value) }))}
                        className="border p-1 w-24 rounded"
                        placeholder={`max ${remaining}`}
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-success mt-1">Fully received.</p>
                  )}
                </div>
              )
            })}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowReceiveModal(false)} className="px-4 py-2 border rounded">
                Cancel
              </button>
              <button onClick={() => handleReceiveSubmit()} disabled={receiving} className="px-4 py-2 bg-primary text-primary-foreground rounded disabled:opacity-50 inline-flex items-center gap-1.5">
                {receiving && <Loader2 className="size-4 animate-spin" />}
                Confirm Receipt
              </button>
            </div>
          </div>
        </div>
      )}

      {editingItemId && po.items.find(i => i.id === editingItemId) && (
        <EditPoItemDialog
          poId={poId}
          poStatus={po.po_status}
          item={(() => {
            const i = po.items.find(x => x.id === editingItemId)!
            return { id: i.id, sku_id: i.sku_id, sku_code: i.sku_code, quantity: i.quantity, unit_price: i.unit_price, gst_percentage: i.gst_percentage, notes: i.notes, hsn_code: i.hsn_code }
          })()}
          allItems={po.items.map(i => ({ id: i.id, sku_id: i.sku_id, sku_code: i.sku_code, quantity: i.quantity, unit_price: i.unit_price, gst_percentage: i.gst_percentage, notes: i.notes }))}
          onClose={() => setEditingItemId(null)}
          onSaved={fetchPO}
        />
      )}

      {editingVendor && (
        <EditPoVendorDialog
          poId={poId}
          currentVendorId={po.vendor_id}
          currentPoDate={po.po_date}
          onClose={() => setEditingVendor(false)}
          onSaved={fetchPO}
        />
      )}

      {attachingUnits && (
        <AttachUnitsDialog
          poId={poId}
          onClose={() => setAttachingUnits(false)}
          onSaved={fetchPO}
        />
      )}

      {movingUnit && (
        <MoveUnitDialog
          sourcePoId={poId}
          assetNumber={movingUnit.assetNumber}
          serialNumber={movingUnit.serialNumber}
          entryDate={movingUnit.entryDate}
          skuLabel={movingUnit.skuLabel}
          onClose={() => setMovingUnit(null)}
          onSaved={fetchPO}
        />
      )}

      {showAddPayment && po && (
        <AddVendorPaymentDialog
          poId={poId}
          balanceDue={(po.grand_total ?? 0) - (po.amount_paid ?? 0)}
          onClose={() => setShowAddPayment(false)}
          onSaved={() => {
            loadPayments()
            fetchPO()
          }}
        />
      )}
    </div>
  )
}

export default function PODetailPageGuarded() {
  return (
    <RequireOwner>
      <PODetailPage />
    </RequireOwner>
  )
}
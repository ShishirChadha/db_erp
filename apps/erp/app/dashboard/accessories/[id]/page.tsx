'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'
import { useRole } from '@/lib/auth/useRole'
import RequirePageAccess from '@/components/RequirePageAccess'

interface Movement {
  id: string
  movement_type: string
  quantity_change: number
  quantity_before: number | null
  quantity_after: number | null
  po_number: string | null
  vendor_name: string | null
  unit_price: number | null
  purchase_date: string | null
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

function AccessoryDetailPage() {
  const params = useParams()
  const router = useRouter()
  const skuId = params.id as string
  const { isOwner } = useRole()

  const [data, setData] = useState<HistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
  if (error) return <div className="p-4 text-red-600">Error: {error}</div>
  if (!data) return null

  const { sku, summary, movements, purchases, cost_price, last_vendor } = data
  const displayName = sku.sku_description || sku.model_name || sku.full_sku_code

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <button onClick={() => router.back()} className="text-sm text-gray-500 mb-2">&larr; Back</button>
      <h1 className="text-2xl font-bold mb-1">{displayName}</h1>
      <p className="text-gray-600 mb-4">
        {sku.full_sku_code} — {sku.category}{sku.brand ? ` · ${sku.brand}` : ''}
        {sku.status !== 'active' && <span className="ml-2 text-xs text-gray-400 capitalize">({sku.status})</span>}
      </p>

      {/* Reconciliation summary -- the "why does in-stock show this number" answer,
          derived live from the same stock_movements ledger the trigger uses, so it
          can never disagree with quantity_in_stock itself. */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="border rounded-lg p-3 text-center">
          <div className="text-xs text-gray-500">Received</div>
          <div className="text-lg font-semibold tabular-nums">{summary.received}</div>
        </div>
        <div className="border rounded-lg p-3 text-center">
          <div className="text-xs text-gray-500">Sold</div>
          <div className="text-lg font-semibold tabular-nums">{summary.sold}</div>
        </div>
        <div className="border rounded-lg p-3 text-center">
          <div className="text-xs text-gray-500">Adjusted</div>
          <div className="text-lg font-semibold tabular-nums">{summary.adjusted >= 0 ? '+' : ''}{summary.adjusted}</div>
        </div>
        <div className="border rounded-lg p-3 text-center bg-blue-50">
          <div className="text-xs text-gray-500">In Stock</div>
          <div className="text-lg font-semibold tabular-nums">{summary.in_stock}</div>
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-6">
        In stock = received + adjusted − sold. "Received" counts everything ever bought,
        regardless of how much has since sold — a purchase order for this item should
        reflect Received, not the current In Stock number.
      </p>

      {isOwner && (
        <div className="border rounded-lg p-4 mb-6">
          <h2 className="font-semibold mb-2">Cost &amp; Last Vendor</h2>
          <p className="text-sm text-gray-600">
            Current cost: {cost_price != null ? `₹${cost_price.toFixed(2)}` : '—'}
            {last_vendor && <> — Last purchased from <span className="font-medium">{last_vendor}</span></>}
          </p>
        </div>
      )}

      {isOwner && (
        <div className="border rounded-lg p-4 mb-6">
          <h2 className="font-semibold mb-3">Purchase History</h2>
          {!purchases || purchases.length === 0 ? (
            <p className="text-sm text-gray-400">No purchase orders recorded yet for this item.</p>
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
          <p className="text-sm text-gray-400">No stock movements recorded yet.</p>
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
                  <th className="border p-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="border p-2">{(m.purchase_date || m.created_at)?.slice(0, 10)}</td>
                    <td className="border p-2">{MOVEMENT_LABELS[m.movement_type] || m.movement_type}</td>
                    <td className="border p-2 text-right tabular-nums">{m.quantity_change > 0 ? '+' : ''}{m.quantity_change}</td>
                    <td className="border p-2 text-right tabular-nums text-gray-500">
                      {m.quantity_before ?? '—'} → {m.quantity_after ?? '—'}
                    </td>
                    <td className="border p-2">{m.po_number || (m.movement_type === 'receipt' ? <span className="text-amber-600">awaiting PO</span> : '—')}</td>
                    <td className="border p-2">{m.vendor_name || '—'}</td>
                    <td className="border p-2 text-right tabular-nums">{m.unit_price != null ? `₹${m.unit_price.toFixed(2)}` : '—'}</td>
                    <td className="border p-2 text-gray-500">{m.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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

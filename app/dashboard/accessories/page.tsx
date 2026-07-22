'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'
import { useRole } from '@/lib/auth/useRole'
import RequirePageAccess from '@/components/RequirePageAccess'

interface Accessory {
  id: string
  accessory_name: string
  category: string | null
  brand: string | null
  quantity: number
  unit_cost?: number | null
  selling_price: number | null
  supplier?: string | null
  review_status: string
}

function ActivateRow({ item, onDone }: { item: Accessory; onDone: () => void }) {
  const [unitCost, setUnitCost] = useState<number | ''>('')
  const [sellingPrice, setSellingPrice] = useState<number | ''>('')
  const [supplier, setSupplier] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const activate = async () => {
    setErr('')
    setBusy(true)
    try {
      const res = await apiFetch(`/api/accessories/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          unit_cost: unitCost === '' ? null : unitCost,
          selling_price: sellingPrice === '' ? null : sellingPrice,
          supplier: supplier || null,
          review_status: 'active',
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to activate.')
      onDone()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <tr>
      <td className="border p-2">{item.accessory_name}</td>
      <td className="border p-2 text-amber-700 text-xs">pending review</td>
      <td className="border p-2"><input type="number" value={unitCost} onChange={(e) => setUnitCost(e.target.value === '' ? '' : Number(e.target.value))} className="border p-1 w-24 rounded text-sm" placeholder="Cost" /></td>
      <td className="border p-2"><input type="number" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value === '' ? '' : Number(e.target.value))} className="border p-1 w-24 rounded text-sm" placeholder="Selling price" /></td>
      <td className="border p-2"><input value={supplier} onChange={(e) => setSupplier(e.target.value)} className="border p-1 w-32 rounded text-sm" placeholder="Supplier" /></td>
      <td className="border p-2">
        {err && <div className="text-red-600 text-xs mb-1">{err}</div>}
        <button onClick={activate} disabled={busy} className="bg-blue-600 text-white px-3 py-1 rounded text-xs disabled:opacity-50">
          {busy ? 'Saving...' : 'Activate'}
        </button>
      </td>
    </tr>
  )
}

function AccessoriesPage() {
  const router = useRouter()
  const { isOwner } = useRole()
  const [active, setActive] = useState<Accessory[]>([])
  const [pending, setPending] = useState<Accessory[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    const [activeRes, pendingRes] = await Promise.all([
      apiFetch(`/api/accessories?${params.toString()}`),
      isOwner ? apiFetch('/api/accessories?review_status=pending_review') : Promise.resolve(null),
    ])
    setActive(activeRes.ok ? await activeRes.json() : [])
    setPending(pendingRes?.ok ? await pendingRes.json() : [])
    setLoading(false)
  }, [search, isOwner])

  useEffect(() => { fetchAll() }, [fetchAll])

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Accessories</h1>

      {isOwner && pending.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-2">Pending Review ({pending.length})</h2>
          <table className="min-w-full border text-sm">
            <thead>
              <tr>
                <th className="border p-2">Name</th>
                <th className="border p-2">Status</th>
                <th className="border p-2">Unit Cost</th>
                <th className="border p-2">Selling Price</th>
                <th className="border p-2">Supplier</th>
                <th className="border p-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {pending.map(p => <ActivateRow key={p.id} item={p} onDone={fetchAll} />)}
            </tbody>
          </table>
        </div>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search accessories..."
        className="border p-2 rounded mb-4"
      />

      {loading ? (
        <div>Loading...</div>
      ) : (
        <table className="min-w-full border text-sm">
          <thead>
            <tr>
              <th className="border p-2">Name</th>
              <th className="border p-2">Category</th>
              <th className="border p-2">Brand</th>
              <th className="border p-2">In Stock</th>
              <th className="border p-2">Selling Price</th>
              {isOwner && <th className="border p-2">Unit Cost</th>}
              {isOwner && <th className="border p-2">Supplier</th>}
              <th className="border p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {active.map(a => (
              <tr key={a.id}>
                <td className="border p-2">{a.accessory_name}</td>
                <td className="border p-2">{a.category || '—'}</td>
                <td className="border p-2">{a.brand || '—'}</td>
                <td className="border p-2">{a.quantity}</td>
                <td className="border p-2">{a.selling_price ? `₹${a.selling_price.toFixed(2)}` : '—'}</td>
                {isOwner && <td className="border p-2">{a.unit_cost != null ? `₹${a.unit_cost.toFixed(2)}` : '—'}</td>}
                {isOwner && <td className="border p-2">{a.supplier || '—'}</td>}
                <td className="border p-2">
                  {a.quantity > 0 && (
                    <button onClick={() => router.push(`/dashboard/entry/sell?accessory_id=${a.id}`)} className="text-green-700 underline text-xs">
                      Sell
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {active.length === 0 && (
              <tr><td colSpan={isOwner ? 8 : 6} className="border p-4 text-center text-gray-400">No accessories found.</td></tr>
            )}
          </tbody>
        </table>
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

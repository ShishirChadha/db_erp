'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '@/lib/api-client'

interface SacCode {
  id: string
  code: string
  description: string
  is_active: boolean
}

// GST SAC (Services Accounting Code) master list for every Service-category SKU
// (labor, OS installs, diagnostics, rental rate, etc.) -- owner-managed here so a
// code is picked, not retyped/mistyped per SKU. Deactivating a code hides it from
// the picker on new Service SKUs without touching any SKU that already references
// it (no DELETE route exists -- see app/api/sac-codes).
export default function SacCodesManager() {
  const [codes, setCodes] = useState<SacCode[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')

  const [newCode, setNewCode] = useState('')
  const [newDescription, setNewDescription] = useState('')

  const fetchCodes = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch('/api/sac-codes')
    setCodes(res.ok ? await res.json() : [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchCodes() }, [fetchCodes])

  const addCode = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setError('')
    if (!newCode.trim() || !newDescription.trim()) { busyRef.current = false; return }
    setBusy(true)
    try {
      const res = await apiFetch('/api/sac-codes', {
        method: 'POST',
        body: JSON.stringify({ code: newCode.trim(), description: newDescription.trim() }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to add.')
      setNewCode('')
      setNewDescription('')
      await fetchCodes()
    } catch (e: any) {
      setError(e.message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const toggleActive = async (c: SacCode) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await apiFetch(`/api/sac-codes/${c.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !c.is_active }),
      })
      await fetchCodes()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        GST SAC codes for services (labor, OS installs, diagnostics, rental rate, etc.). Every Service-category SKU must pick one of these — the code is used verbatim on invoice line items, same as an HSN code for goods. Deactivating a code hides it from the picker without touching any SKU that already uses it.
      </p>

      {error && <div className="text-destructive text-sm mb-2">{error}</div>}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="border rounded divide-y mb-3">
          {codes.length === 0 && <p className="text-sm text-muted-foreground p-2">No SAC codes yet.</p>}
          {codes.map(c => (
            <div key={c.id} className="flex justify-between items-center p-2 gap-2">
              <span className={c.is_active ? '' : 'text-muted-foreground line-through'}>
                <span className="font-mono">{c.code}</span> — {c.description}
              </span>
              <button
                onClick={() => toggleActive(c)}
                disabled={busy}
                className={`text-xs px-2 py-1 rounded shrink-0 ${c.is_active ? 'bg-destructive/10 text-destructive' : 'bg-success/15 text-success'}`}
              >
                {c.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={newCode}
          onChange={(e) => setNewCode(e.target.value)}
          placeholder="Code, e.g. 998714"
          className="border p-2 rounded w-40"
        />
        <input
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
          placeholder="Description, e.g. Maintenance and repair services of computers"
          className="border p-2 rounded flex-1"
          onKeyDown={(e) => { if (e.key === 'Enter') addCode() }}
        />
        <button onClick={addCode} disabled={busy} className="bg-primary text-primary-foreground px-4 py-2 rounded disabled:opacity-50">
          Add
        </button>
      </div>
    </div>
  )
}

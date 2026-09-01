'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '@/lib/api-client'

interface Option {
  id: string
  category: string
  value: string
  is_active: boolean
  sort_order: number
  owner_only: boolean
}

const KNOWN_CATEGORIES = [
  { key: 'stock_intake_type', label: 'Stock Intake Type' },
  { key: 'expense_types', label: 'Expense Types' },
  { key: 'brand', label: 'Brand' },
  { key: 'model_laptop', label: 'Model (Laptop)' },
  { key: 'model_desktop', label: 'Model (Desktop)' },
  { key: 'model_tablet', label: 'Model (Tablet)' },
  { key: 'model_monitor', label: 'Model (Monitor)' },
  { key: 'cpu', label: 'CPU' },
  { key: 'gpu', label: 'GPU (Laptop/Desktop)' },
  { key: 'cpu_series', label: 'CPU Series (standalone CPU SKUs)' },
  { key: 'gpu_series', label: 'GPU Series (standalone GPU SKUs)' },
  { key: 'monitor_resolution', label: 'Monitor Resolution' },
  { key: 'apple_model_year', label: 'Apple Model Year' },
  { key: 'generation', label: 'Generation' },
  { key: 'ram', label: 'RAM' },
  { key: 'storage', label: 'Storage' },
  { key: 'screen_size_laptop', label: 'Screen Size (Laptop/Tablet)' },
  { key: 'screen_size_monitor', label: 'Screen Size (Monitor)' },
  { key: 'staff_names', label: 'Staff Names (Sold By)' },
]

// Generic manager for any `custom_options` category -- used by every searchable
// dropdown across the app (Stock Intake today; anything else that calls
// useCustomOptions(category) tomorrow). Owner curates the list here; forms elsewhere
// just read whatever is active.
export default function DropdownOptionsManager() {
  const [category, setCategory] = useState(KNOWN_CATEGORIES[0].key)
  const [customCategory, setCustomCategory] = useState('')
  const [options, setOptions] = useState<Option[]>([])
  const [newValue, setNewValue] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')

  const activeCategory = category === '__custom__' ? customCategory.trim() : category

  const fetchOptions = useCallback(async () => {
    if (!activeCategory) { setOptions([]); return }
    setLoading(true)
    const res = await apiFetch(`/api/custom-options?category=${encodeURIComponent(activeCategory)}&include_inactive=true`)
    setOptions(res.ok ? await res.json() : [])
    setLoading(false)
  }, [activeCategory])

  useEffect(() => { fetchOptions() }, [fetchOptions])

  // Both actions share a single `busy` lock (matching existing behavior where
  // add and toggle disable each other) -- guard re-entrancy with a ref so a
  // rapid double click can't fire two requests before the state update renders.
  const addValue = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setError('')
    if (!newValue.trim()) { busyRef.current = false; return }
    setBusy(true)
    try {
      const res = await apiFetch('/api/custom-options', {
        method: 'POST',
        body: JSON.stringify({ category: activeCategory, value: newValue.trim() }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to add.')
      setNewValue('')
      await fetchOptions()
    } catch (e: any) {
      setError(e.message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const toggleActive = async (opt: Option) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await apiFetch(`/api/custom-options/${opt.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !opt.is_active }),
      })
      await fetchOptions()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  // "Owner only" -- a non-owner never even sees this value in the dropdown (not
  // just redacted after the fact). Useful for sensitive categories like
  // expense_types (Salaries, Bank Charges, GST Payment) where the value itself
  // is fine to show the owner but shouldn't be offered to staff at all.
  const toggleOwnerOnly = async (opt: Option) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await apiFetch(`/api/custom-options/${opt.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ owner_only: !opt.owner_only }),
      })
      await fetchOptions()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        Values shown in searchable dropdowns across the app (e.g. Stock Intake's CPU, RAM, storage, screen size). Deactivating a value hides it from the picker without deleting history that already used it.
      </p>

      <div className="flex gap-2 mb-3">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="border p-2 rounded">
          {KNOWN_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          <option value="__custom__">Other category...</option>
        </select>
        {category === '__custom__' && (
          <input
            value={customCategory}
            onChange={(e) => setCustomCategory(e.target.value)}
            placeholder="category key, e.g. warranty_type"
            className="border p-2 rounded"
          />
        )}
      </div>

      {error && <div className="text-destructive text-sm mb-2">{error}</div>}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="border rounded divide-y mb-3">
          {options.length === 0 && <p className="text-sm text-muted-foreground p-2">No values yet.</p>}
          {options.map(opt => (
            <div key={opt.id} className="flex justify-between items-center p-2 gap-2">
              <span className={opt.is_active ? '' : 'text-muted-foreground line-through'}>
                {opt.value}
                {opt.owner_only && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700">Owner only</span>}
              </span>
              <span className="flex gap-2 shrink-0">
                <button
                  onClick={() => toggleOwnerOnly(opt)}
                  disabled={busy}
                  className={`text-xs px-2 py-1 rounded ${opt.owner_only ? 'bg-amber-500/15 text-amber-700' : 'bg-muted text-muted-foreground'}`}
                >
                  {opt.owner_only ? 'Make visible to all' : 'Make owner only'}
                </button>
                <button
                  onClick={() => toggleActive(opt)}
                  disabled={busy}
                  className={`text-xs px-2 py-1 rounded ${opt.is_active ? 'bg-destructive/10 text-destructive' : 'bg-success/15 text-success'}`}
                >
                  {opt.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="Add new value..."
          className="border p-2 rounded flex-1"
          onKeyDown={(e) => { if (e.key === 'Enter') addValue() }}
        />
        <button onClick={addValue} disabled={busy || !activeCategory} className="bg-primary text-primary-foreground px-4 py-2 rounded disabled:opacity-50">
          Add
        </button>
      </div>
    </div>
  )
}

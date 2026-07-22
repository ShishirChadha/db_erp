'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'

interface Option {
  id: string
  category: string
  value: string
  is_active: boolean
  sort_order: number
}

const KNOWN_CATEGORIES = [
  { key: 'cpu', label: 'CPU' },
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

  const addValue = async () => {
    setError('')
    if (!newValue.trim()) return
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
      setBusy(false)
    }
  }

  const toggleActive = async (opt: Option) => {
    setBusy(true)
    await apiFetch(`/api/custom-options/${opt.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: !opt.is_active }),
    })
    await fetchOptions()
    setBusy(false)
  }

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-3">Dropdown Options</h2>
      <p className="text-sm text-gray-600 mb-4">
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

      {error && <div className="text-red-600 text-sm mb-2">{error}</div>}

      {loading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : (
        <div className="border rounded divide-y mb-3">
          {options.length === 0 && <p className="text-sm text-gray-400 p-2">No values yet.</p>}
          {options.map(opt => (
            <div key={opt.id} className="flex justify-between items-center p-2">
              <span className={opt.is_active ? '' : 'text-gray-400 line-through'}>{opt.value}</span>
              <button
                onClick={() => toggleActive(opt)}
                disabled={busy}
                className={`text-xs px-2 py-1 rounded ${opt.is_active ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}
              >
                {opt.is_active ? 'Deactivate' : 'Activate'}
              </button>
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
        <button onClick={addValue} disabled={busy || !activeCategory} className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50">
          Add
        </button>
      </div>
    </section>
  )
}

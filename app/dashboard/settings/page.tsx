'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

interface AssetCounter {
  prefix: string
  year: string
  last_number: number
  year_suffix: string
}

const ENTITY_LABELS: Record<string, string> = {
  DBAS: 'Digitalbluez',
  TTAS: 'Techtenth',
  CSAS: 'Cash',
  OTHR: 'Other',
}

export default function SettingsPage() {
  const [counters, setCounters] = useState<AssetCounter[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // Edit state
  const [editValues, setEditValues] = useState<Record<string, { last: number; suffix: string }>>({})

  const fetchCounters = async () => {
    setLoading(true)
    const res = await apiFetch('/api/settings/asset-counters')
    if (res.ok) {
      const data = await res.json()
      setCounters(data)
      const init: any = {}
      data.forEach((c: AssetCounter) => {
        init[c.prefix] = { last: c.last_number, suffix: c.year_suffix || '' }
      })
      setEditValues(init)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchCounters()
  }, [])

  const handleSave = async (prefix: string) => {
    setSaving(prefix)
    const vals = editValues[prefix]
    const res = await apiFetch('/api/settings/asset-counters', {
      method: 'PUT',
      body: JSON.stringify({
        prefix,
        last_number: vals.last,
        year_suffix: vals.suffix || null,
      }),
    })
    if (res.ok) {
      alert(`Counter for ${prefix} updated.`)
     
      fetchCounters()
    } else {
      const err = await res.json().catch(() => ({}))
      alert(err.error || 'Failed to update')
    }
    setSaving(null)
  }

  const handleRecalculate = async () => {
    setRefreshing(true)
    const res = await apiFetch('/api/settings/asset-counters', { method: 'POST' })
    if (res.ok) {
      alert('Counters recalculated from existing assets.')
      fetchCounters()
    } else {
      const err = await res.json().catch(() => ({}))
      alert(err.error || 'Recalculate failed')
    }
    setRefreshing(false)
  }

  const updateEdit = (prefix: string, field: 'last' | 'suffix', value: string) => {
    setEditValues(prev => ({
      ...prev,
      [prefix]: {
        ...prev[prefix],
        [field]: field === 'last' ? parseInt(value) || 0 : value,
      },
    }))
  }

  if (loading) return <div className="p-4">Loading settings…</div>

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Asset Number Sequences</h2>
        <p className="text-sm text-gray-600 mb-4">
          Set the last used number and year suffix. After saving, the counter is automatically refreshed from actual assets.
        </p>

        <table className="min-w-full border mb-4">
          <thead>
            <tr>
              <th className="border p-2">Entity</th>
              <th className="border p-2">Prefix</th>
              <th className="border p-2">Year Suffix (e.g., 26)</th>
              <th className="border p-2">Last Used Seq</th>
              <th className="border p-2">Preview</th>
              <th className="border p-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {counters.map(counter => {
              const vals = editValues[counter.prefix] || { last: 0, suffix: '' }
const nextNum = vals.last + 1
const suffix = vals.suffix || new Date().getFullYear().toString().slice(-2) // fallback to current year if empty
const preview = `${counter.prefix}${suffix}-${nextNum}`

              return (
                <tr key={counter.prefix}>
                  <td className="border p-2">{ENTITY_LABELS[counter.prefix]}</td>
                  <td className="border p-2 font-mono">{counter.prefix}</td>
                  <td className="border p-2">
                    <input
                      type="text"
                      maxLength={2}
                      value={vals.suffix}
                      onChange={(e) => updateEdit(counter.prefix, 'suffix', e.target.value)}
                      className="border p-1 w-16 rounded"
                      placeholder="YY"
                    />
                  </td>
                  <td className="border p-2">
                    <input
                      type="number"
                      min={0}
                      value={vals.last}
                      onChange={(e) => updateEdit(counter.prefix, 'last', e.target.value)}
                      className="border p-1 w-24 rounded"
                    />
                  </td>
                  <td className="border p-2 font-mono text-gray-700">{preview}</td>
                  <td className="border p-2">
                    <button
                      onClick={() => handleSave(counter.prefix)}
                      disabled={saving === counter.prefix}
                      className="bg-blue-600 text-white px-3 py-1 rounded disabled:opacity-50"
                    >
                      {saving === counter.prefix ? 'Saving…' : 'Save'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <button
          onClick={handleRecalculate}
          disabled={refreshing}
          className="bg-gray-200 px-4 py-2 rounded disabled:opacity-50"
        >
          {refreshing ? 'Recalculating…' : 'Refresh Counters from Database'}
        </button>
      </section>

      <p className="text-sm text-gray-400 mt-8">More settings coming soon.</p>
    </div>
  )
}
'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useCustomOptions } from '@/lib/useCustomOptions'
import { SearchableSelect } from '@/components/SearchableSelect'
import RequirePageAccess from '@/components/RequirePageAccess'
import { getCustomOptionsCategory } from '@/lib/sku-field-options'
import { TYPE_TO_CATEGORY } from '@/lib/sku-category-map'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { ReviewSummaryDialog } from '@/components/ReviewSummaryDialog'

interface Accessory {
  id: string
  accessory_name: string
  quantity: number
}

// Accessories are sku_master rows filtered to the non-serialized categories (see
// docs/decisions.md, 2026-07-23) -- map the raw SKU shape into this page's existing
// Accessory shape so the rest of the component doesn't need to change.
const ACCESSORY_CATEGORIES = 'RAM,SSD,CPU,GPU,KBD,MOUSE,ACC,ADP'
function mapSkuToAccessory(s: any): Accessory {
  return {
    id: s.id,
    accessory_name: s.sku_description || s.model_name || s.full_sku_code,
    quantity: s.quantity_in_stock,
  }
}

const TYPE_OPTIONS = ['Laptop', 'Desktop', 'Monitor', 'Tablet', 'Tiny']
const BUYER_OPTIONS = ['Digitalbluez', 'Techtenth', 'Cash', 'Other']

function today() {
  return new Date().toISOString().slice(0, 10)
}

function StockIntakePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Where to return after Back/Done -- the page this form was opened from (Live
  // Stock, Stock, etc.), falling back to the New Entry hub when opened from there.
  const returnTo = searchParams.get('return_to')
  const backHref = returnTo && returnTo.startsWith('/dashboard') ? returnTo : '/dashboard/entry'
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [showReview, setShowReview] = useState(false)

  const [type, setType] = useState('Laptop')
  const [brand, setBrand] = useState('')
  const [brandOther, setBrandOther] = useState('')
  const [model, setModel] = useState('')
  const [cpu, setCpu] = useState('')
  const [generation, setGeneration] = useState('')
  const [ram, setRam] = useState('')
  const [ssd, setSsd] = useState('')
  const [screenSize, setScreenSize] = useState('')
  const [modelYear, setModelYear] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [purchasedByType, setPurchasedByType] = useState('Digitalbluez')
  const [conditionNotes, setConditionNotes] = useState('')
  const [receivedDate, setReceivedDate] = useState(today())
  const [bundled, setBundled] = useState<{ accessory_id: string; accessory_name: string; quantity: number }[]>([])
  const [accessorySearch, setAccessorySearch] = useState('')
  const [accessoryOptions, setAccessoryOptions] = useState<Accessory[]>([])

  const { values: cpuOptions } = useCustomOptions('cpu')
  const { values: generationOptions } = useCustomOptions('generation')
  const { values: ramOptions } = useCustomOptions('ram')
  const { values: storageOptions } = useCustomOptions('storage')
  const { values: laptopScreenOptions } = useCustomOptions('screen_size_laptop')
  const { values: monitorScreenOptions } = useCustomOptions('screen_size_monitor')
  const { values: brandOptions } = useCustomOptions('brand')
  const { values: modelYearOptions } = useCustomOptions('apple_model_year')
  const modelCategory = getCustomOptionsCategory(TYPE_TO_CATEGORY[type] || 'OTHER', 'model')
  const { values: modelOptions } = useCustomOptions(modelCategory || 'model_laptop')
  const screenOptions = type === 'Monitor' ? monitorScreenOptions : laptopScreenOptions

  // Prefill CPU/Generation/RAM/SSD/Screen Size/Model Year from whatever was last
  // recorded for this exact brand+model -- a repeatedly purchased model shouldn't
  // need every spec field re-picked by hand each time. Only fills fields that are
  // still empty, so it never overwrites something the user already chose, and it's
  // fully editable afterward either way.
  useEffect(() => {
    if (!model.trim()) return
    const category = TYPE_TO_CATEGORY[type] || 'OTHER'
    let cancelled = false
    apiFetch(`/api/sku-master?latest_for_model=${encodeURIComponent(model)}&category=${encodeURIComponent(category)}`)
      .then(res => res.json())
      .then((specs) => {
        if (cancelled || !specs) return
        if (!cpu && specs.cpu) setCpu(specs.cpu)
        if (!generation && specs.generation) setGeneration(specs.generation)
        if (!ram && specs.ram) setRam(specs.ram)
        if (!ssd && specs.ssd) setSsd(specs.ssd)
        if (!screenSize && specs.screen_size) setScreenSize(specs.screen_size)
        if (!modelYear && specs.model_year) setModelYear(specs.model_year)
      })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, type])

  useEffect(() => {
    if (!accessorySearch.trim()) { setAccessoryOptions([]); return }
    const timer = setTimeout(async () => {
      const res = await apiFetch(`/api/sku-master?category=${ACCESSORY_CATEGORIES}&search=${encodeURIComponent(accessorySearch)}`)
      const data = await res.json()
      setAccessoryOptions(Array.isArray(data) ? data.map(mapSkuToAccessory) : [])
    }, 300)
    return () => clearTimeout(timer)
  }, [accessorySearch])

  const addBundledAccessory = (a: Accessory) => {
    if (bundled.some(b => b.accessory_id === a.id)) return
    setBundled(prev => [...prev, { accessory_id: a.id, accessory_name: a.accessory_name, quantity: 1 }])
    setAccessorySearch(''); setAccessoryOptions([])
  }

  const resetForm = () => {
    setType('Laptop'); setBrand(''); setBrandOther(''); setModel('')
    setCpu(''); setGeneration(''); setRam(''); setSsd(''); setScreenSize('')
    setModelYear(''); setBundled([]); setAccessorySearch(''); setAccessoryOptions([])
    setSerialNumber(''); setPurchasedByType('Digitalbluez'); setConditionNotes('')
    setReceivedDate(today())
  }

  const openReview = () => {
    setError('')
    if (!model.trim()) { setError('Model is required.'); return }
    setShowReview(true)
  }

  const { run: handleSubmit, pending: submitting } = useAsyncAction(async () => {
    setError('')
    if (!model.trim()) { setError('Model is required.'); return }

    const payload = {
      type,
      brand,
      brand_other: brandOther,
      model,
      cpu,
      generation,
      ram,
      ssd,
      screen_size: screenSize,
      model_year: modelYear,
      serial_number: serialNumber,
      purchased_by_type: purchasedByType,
      condition_notes: conditionNotes,
      received_date: receivedDate,
      bundled_accessories: bundled.length > 0 ? bundled.map(b => ({ accessory_id: b.accessory_id, quantity: b.quantity })) : undefined,
    }

    try {
      const res = await apiFetch('/api/stock-intake', { method: 'POST', body: JSON.stringify(payload) })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        // Serial number matched an existing unit elsewhere in the system -- let the
        // user confirm this is a legitimate separate entry rather than silently
        // blocking or silently allowing a duplicate through.
        if (err.error_code === 'duplicate_serial' && confirm(`${err.error}\n\nProceed anyway?`)) {
          const res2 = await apiFetch('/api/stock-intake', {
            method: 'POST',
            body: JSON.stringify({ ...payload, confirm_duplicate: true }),
          })
          if (!res2.ok) {
            const err2 = await res2.json().catch(() => ({}))
            throw new Error(err2.error || 'Failed to save entry.')
          }
          setDone(true)
          resetForm()
          return
        }
        throw new Error(err.error || 'Failed to save entry.')
      }
      setDone(true)
      resetForm()
    } catch (err: any) {
      setError(err.message)
    }
  })

  const showLaptopFields = type === 'Laptop' || type === 'Desktop' || type === 'Tiny'
  const showScreenField = type === 'Laptop' || type === 'Monitor' || type === 'Tablet'

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <button onClick={() => router.push(backHref)} className="text-sm text-gray-600 hover:text-gray-900 mb-2">
        ← Back
      </button>
      <h1 className="text-2xl font-bold mb-1">Stock Intake</h1>
      <p className="text-sm text-gray-500 mb-4">
        Register a unit you just received. No price or vendor info needed here — the owner will fill that in.
      </p>

      {done && (
        <div className="bg-green-50 border border-green-200 text-green-800 rounded p-3 mb-4 flex justify-between items-center">
          <span>Added to stock — pending QC before it can be sold.</span>
          <button onClick={() => setDone(false)} className="text-sm underline">Add another</button>
        </div>
      )}
      {error && <div className="text-red-600 mb-4">{error}</div>}

      <div className="space-y-4 bg-white p-4 rounded shadow">
        <div>
          <label className="block font-medium text-sm mb-1">Date Received</label>
          <input
            type="date"
            value={receivedDate}
            max={today()}
            onChange={(e) => setReceivedDate(e.target.value)}
            className="border p-2 w-full rounded"
          />
          <p className="text-xs text-gray-400 mt-1">Backdate this if the unit was actually received earlier.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block font-medium text-sm mb-1">Type *</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="border p-2 w-full rounded">
              {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-medium text-sm mb-1">Brand</label>
            <SearchableSelect options={brandOptions} value={brand} onChange={setBrand} placeholder="Select brand..." />
          </div>
        </div>

        <div>
          <label className="block font-medium text-sm mb-1">Model *</label>
          {modelCategory ? (
            <SearchableSelect options={modelOptions} value={model} onChange={setModel} placeholder="Select model..." otherPosition="top" />
          ) : (
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. Latitude E5450" className="border p-2 w-full rounded" />
          )}
        </div>

        {showLaptopFields && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-medium text-sm mb-1">CPU</label>
              <SearchableSelect options={cpuOptions} value={cpu} onChange={setCpu} placeholder="Select CPU..." />
            </div>
            <div>
              <label className="block font-medium text-sm mb-1">Generation</label>
              <SearchableSelect options={generationOptions} value={generation} onChange={setGeneration} placeholder="Select generation..." />
            </div>
            <div>
              <label className="block font-medium text-sm mb-1">RAM</label>
              <SearchableSelect options={ramOptions} value={ram} onChange={setRam} placeholder="Select RAM..." />
            </div>
            <div>
              <label className="block font-medium text-sm mb-1">SSD / Storage</label>
              <SearchableSelect options={storageOptions} value={ssd} onChange={setSsd} placeholder="Select storage..." />
            </div>
            {brand === 'Apple' && (
              <div>
                <label className="block font-medium text-sm mb-1">Model Year</label>
                <SearchableSelect options={modelYearOptions} value={modelYear} onChange={setModelYear} placeholder="Select year..." />
              </div>
            )}
          </div>
        )}

        {showScreenField && (
          <div>
            <label className="block font-medium text-sm mb-1">Screen Size</label>
            <SearchableSelect options={screenOptions} value={screenSize} onChange={setScreenSize} placeholder="Select screen size..." />
          </div>
        )}

        <div>
          <label className="block font-medium text-sm mb-1">Bundled Accessories Received (e.g. mouse, adapter, bag)</label>
          <input
            value={accessorySearch}
            onChange={(e) => setAccessorySearch(e.target.value)}
            placeholder="Search to add..."
            className="border p-2 w-full rounded"
          />
          {accessoryOptions.length > 0 && (
            <ul className="border rounded mt-1 max-h-40 overflow-y-auto">
              {accessoryOptions.map(a => (
                <li key={a.id} onClick={() => addBundledAccessory(a)} className="p-2 hover:bg-gray-100 cursor-pointer border-b last:border-b-0">
                  {a.accessory_name}
                </li>
              ))}
            </ul>
          )}
          {bundled.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {bundled.map((b, idx) => (
                <span key={b.accessory_id} className="bg-gray-100 text-sm px-2 py-1 rounded flex items-center gap-1">
                  {b.accessory_name}
                  <input
                    type="number"
                    min={1}
                    value={b.quantity}
                    onChange={(e) => setBundled(prev => prev.map((p, i) => i === idx ? { ...p, quantity: Number(e.target.value) } : p))}
                    className="w-12 border rounded text-center"
                  />
                  <button onClick={() => setBundled(prev => prev.filter((_, i) => i !== idx))} className="text-red-500">✕</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block font-medium text-sm mb-1">Serial Number</label>
            <input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} className="border p-2 w-full rounded" />
          </div>
          <div>
            <label className="block font-medium text-sm mb-1">Purchased By</label>
            <select value={purchasedByType} onChange={(e) => setPurchasedByType(e.target.value)} className="border p-2 w-full rounded">
              {BUYER_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block font-medium text-sm mb-1">Condition Notes</label>
          <textarea
            value={conditionNotes}
            onChange={(e) => setConditionNotes(e.target.value)}
            placeholder="e.g. Battery issue, keyboard pullout for spare parts, screen scratch..."
            className="border p-2 w-full rounded"
            rows={3}
          />
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => openReview()}
            disabled={submitting}
            className="bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-50"
          >
            {submitting && <Loader2 className="inline size-4 animate-spin mr-1" />}
            {submitting ? 'Saving...' : 'Review & Save Entry'}
          </button>
        </div>
      </div>

      {showReview && (
        <ReviewSummaryDialog
          title="Review Stock Entry"
          confirming={submitting}
          onBack={() => setShowReview(false)}
          onConfirm={async () => { await handleSubmit(); setShowReview(false) }}
          rows={[
            { label: 'Type', value: type },
            { label: 'Brand', value: brand === 'Other' ? brandOther : brand },
            { label: 'Model', value: model },
            { label: 'CPU', value: cpu },
            { label: 'Generation', value: generation },
            { label: 'RAM', value: ram },
            { label: 'SSD / Storage', value: ssd },
            { label: 'Screen Size', value: screenSize },
            { label: 'Model Year', value: modelYear },
            { label: 'Serial Number', value: serialNumber },
            { label: 'Purchased By', value: purchasedByType },
            ...(bundled.length > 0 ? [{ label: 'Bundled Accessories', value: bundled.map(b => `${b.accessory_name} ×${b.quantity}`).join(', ') }] : []),
            { label: 'Condition Notes', value: conditionNotes },
            { label: 'Date Received', value: receivedDate },
          ]}
        />
      )}
    </div>
  )
}

export default function StockIntakePageGuarded() {
  return (
    <RequirePageAccess pageKey="new_entry">
      <StockIntakePage />
    </RequirePageAccess>
  )
}

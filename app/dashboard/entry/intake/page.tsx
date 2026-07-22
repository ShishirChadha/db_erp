'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'
import { useCustomOptions } from '@/lib/useCustomOptions'
import { SearchableSelect } from '@/components/SearchableSelect'
import RequirePageAccess from '@/components/RequirePageAccess'

const TYPE_OPTIONS = ['Laptop', 'Desktop', 'Monitor', 'Tablet', 'Tiny']
const BRAND_OPTIONS = ['Apple', 'Dell', 'HP', 'Lenovo', 'Windows', 'Asus', 'Acer', 'Other']
const BUYER_OPTIONS = ['Digitalbluez', 'Techtenth', 'Cash', 'Other']

function today() {
  return new Date().toISOString().slice(0, 10)
}

function StockIntakePage() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const [type, setType] = useState('Laptop')
  const [brand, setBrand] = useState('')
  const [brandOther, setBrandOther] = useState('')
  const [model, setModel] = useState('')
  const [cpu, setCpu] = useState('')
  const [generation, setGeneration] = useState('')
  const [ram, setRam] = useState('')
  const [ssd, setSsd] = useState('')
  const [screenSize, setScreenSize] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [purchasedByType, setPurchasedByType] = useState('Digitalbluez')
  const [conditionNotes, setConditionNotes] = useState('')
  const [receivedDate, setReceivedDate] = useState(today())

  const { values: cpuOptions } = useCustomOptions('cpu')
  const { values: generationOptions } = useCustomOptions('generation')
  const { values: ramOptions } = useCustomOptions('ram')
  const { values: storageOptions } = useCustomOptions('storage')
  const { values: laptopScreenOptions } = useCustomOptions('screen_size_laptop')
  const { values: monitorScreenOptions } = useCustomOptions('screen_size_monitor')
  const screenOptions = type === 'Monitor' ? monitorScreenOptions : laptopScreenOptions

  const resetForm = () => {
    setType('Laptop'); setBrand(''); setBrandOther(''); setModel('')
    setCpu(''); setGeneration(''); setRam(''); setSsd(''); setScreenSize('')
    setSerialNumber(''); setPurchasedByType('Digitalbluez'); setConditionNotes('')
    setReceivedDate(today())
  }

  const handleSubmit = async () => {
    setError('')
    if (!model.trim()) { setError('Model is required.'); return }

    setSubmitting(true)
    try {
      const res = await apiFetch('/api/stock-intake', {
        method: 'POST',
        body: JSON.stringify({
          type,
          brand,
          brand_other: brandOther,
          model,
          cpu,
          generation,
          ram,
          ssd,
          screen_size: screenSize,
          serial_number: serialNumber,
          purchased_by_type: purchasedByType,
          condition_notes: conditionNotes,
          received_date: receivedDate,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to save entry.')
      }
      setDone(true)
      resetForm()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const showLaptopFields = type === 'Laptop' || type === 'Desktop' || type === 'Tiny'
  const showScreenField = type === 'Laptop' || type === 'Monitor' || type === 'Tablet'

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <button onClick={() => router.push('/dashboard/entry')} className="text-sm text-gray-600 hover:text-gray-900 mb-2">
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
            <select value={brand} onChange={(e) => setBrand(e.target.value)} className="border p-2 w-full rounded">
              <option value="">Select brand...</option>
              {BRAND_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>

        {brand === 'Other' && (
          <div>
            <label className="block font-medium text-sm mb-1">Other Brand</label>
            <input value={brandOther} onChange={(e) => setBrandOther(e.target.value)} className="border p-2 w-full rounded" />
          </div>
        )}

        <div>
          <label className="block font-medium text-sm mb-1">Model *</label>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. Latitude E5450" className="border p-2 w-full rounded" />
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
          </div>
        )}

        {showScreenField && (
          <div>
            <label className="block font-medium text-sm mb-1">Screen Size</label>
            <SearchableSelect options={screenOptions} value={screenSize} onChange={setScreenSize} placeholder="Select screen size..." />
          </div>
        )}

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
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-50"
          >
            {submitting ? 'Saving...' : 'Save Entry'}
          </button>
        </div>
      </div>
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

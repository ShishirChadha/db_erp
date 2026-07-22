'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'
import { SearchableCustomerSelect } from '@/components/SearchableCustomerSelect'
import QuickAddCustomerDialog from '@/components/QuickAddCustomerDialog'
import RequirePageAccess from '@/components/RequirePageAccess'

const PAYMENT_ACCOUNTS = ['Digitalbluez', 'Techtenth', 'Cash']

interface StockUnit {
  id: string
  asset_number: string | null
  serial_number: string | null
  sku_code: string
  description: string
  status: string
}

const RETURN_REASONS = ['Defective on arrival', 'Not as described', 'Changed mind', 'Wrong item', 'Other']

function unitLabel(u: StockUnit) {
  return u.asset_number || (u.serial_number ? `SN: ${u.serial_number}` : 'no tag yet')
}

// Restricted to source=employee_intake -- the interim system's Service flow only
// operates on stock that came through the new Stock Intake / Sell system, kept
// separate from the main ERP's historical/legacy stock.
function UnitPicker({
  statusFilter, selected, onSelect, onClear, placeholder, browsable = false,
}: {
  statusFilter: string
  selected: StockUnit | null
  onSelect: (u: StockUnit) => void
  onClear: () => void
  placeholder: string
  browsable?: boolean
}) {
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<StockUnit[]>([])
  const [browsableList, setBrowsableList] = useState<StockUnit[]>([])

  useEffect(() => {
    if (!browsable) return
    apiFetch(`/api/stock?status=${statusFilter}&source=employee_intake`).then(res => res.json()).then((data) => {
      setBrowsableList(Array.isArray(data) ? data : [])
    })
  }, [browsable, statusFilter])

  useEffect(() => {
    if (!search.trim()) { setOptions([]); return }
    const timer = setTimeout(async () => {
      const res = await apiFetch(`/api/stock?status=${statusFilter}&source=employee_intake&search=${encodeURIComponent(search)}`)
      const data = await res.json()
      setOptions(Array.isArray(data) ? data : [])
    }, 300)
    return () => clearTimeout(timer)
  }, [search, statusFilter])

  if (selected) {
    return (
      <div className="border p-2 rounded flex justify-between items-center bg-blue-50">
        <div>
          <div className="font-medium">{unitLabel(selected)}</div>
          <div className="text-xs text-gray-600">{selected.sku_code} — {selected.description}</div>
        </div>
        <button onClick={onClear} className="text-red-500 text-sm">✕ Change</button>
      </div>
    )
  }

  return (
    <>
      {browsable && (
        <p className="text-xs text-gray-500 mb-1">
          Search here, or browse/select from <a href="/dashboard/live-stock" className="underline">Live Stock</a>.
        </p>
      )}
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={placeholder} className="border p-2 w-full rounded" />
      {options.length > 0 && (
        <ul className="border rounded mt-1 max-h-48 overflow-y-auto">
          {options.map(u => (
            <li key={u.id} onClick={() => { onSelect(u); setSearch(''); setOptions([]) }} className="p-2 hover:bg-gray-100 cursor-pointer border-b last:border-b-0">
              <div className="font-medium">{unitLabel(u)}</div>
              <div className="text-xs text-gray-600">{u.sku_code} — {u.description}</div>
            </li>
          ))}
        </ul>
      )}
      {browsable && !search.trim() && browsableList.length > 0 && (
        <ul className="border rounded mt-2 max-h-64 overflow-y-auto">
          {browsableList.map(u => (
            <li key={u.id} onClick={() => onSelect(u)} className="p-2 hover:bg-gray-100 cursor-pointer border-b last:border-b-0 flex justify-between">
              <span className="font-medium">{unitLabel(u)}</span>
              <span className="text-xs text-gray-600">{u.sku_code} — {u.description}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function ServicePageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const prefillSubtype = searchParams.get('subtype') as 'repair' | 'replacement' | 'return' | null
  const prefillAssetId = searchParams.get('asset_id')

  const [subType, setSubType] = useState<'repair' | 'replacement' | 'return'>(prefillSubtype || 'repair')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const [customerId, setCustomerId] = useState<string | null>(null)
  const [isOwnStock, setIsOwnStock] = useState(!!prefillSubtype)
  const [ownUnit, setOwnUnit] = useState<StockUnit | null>(null)
  const [deviceDescription, setDeviceDescription] = useState('')
  const [deviceSerial, setDeviceSerial] = useState('')
  const [problem, setProblem] = useState('')
  const [amountCharged, setAmountCharged] = useState<number | ''>('')
  const [paymentAccount, setPaymentAccount] = useState('Digitalbluez')
  const [replacementUnit, setReplacementUnit] = useState<StockUnit | null>(null)
  const [customerRefreshKey, setCustomerRefreshKey] = useState(0)

  const [returnUnit, setReturnUnit] = useState<StockUnit | null>(null)
  const [returnReason, setReturnReason] = useState(RETURN_REASONS[0])
  const [returnNotes, setReturnNotes] = useState('')

  // Prefill from Live Stock's "Repair" / "Return" row actions.
  useEffect(() => {
    if (!prefillAssetId) return
    apiFetch(`/api/stock?id=${prefillAssetId}`).then(res => res.json()).then((data) => {
      const unit = Array.isArray(data) && data[0] ? data[0] : null
      if (!unit) return
      if (prefillSubtype === 'return') {
        setSubType('return')
        setReturnUnit(unit)
      } else {
        setSubType(prefillSubtype || 'repair')
        setIsOwnStock(true)
        setOwnUnit(unit)
      }
    })
  }, [prefillAssetId, prefillSubtype])

  const resetForm = () => {
    setCustomerId(null); setIsOwnStock(false); setOwnUnit(null)
    setDeviceDescription(''); setDeviceSerial(''); setProblem(''); setAmountCharged('')
    setPaymentAccount('Digitalbluez')
    setReplacementUnit(null); setReturnUnit(null); setReturnReason(RETURN_REASONS[0]); setReturnNotes('')
  }

  const handleSubmitRepairOrReplacement = async () => {
    setError('')
    if (!customerId) { setError('Select or add a customer.'); return }
    if (isOwnStock && !ownUnit) { setError('Select the unit from our stock.'); return }
    if (!isOwnStock && !deviceDescription.trim()) { setError('Describe the customer\'s device.'); return }
    if (subType === 'replacement' && !replacementUnit) { setError('Select the replacement unit.'); return }

    setSubmitting(true)
    try {
      const res = await apiFetch('/api/repair-jobs', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: customerId,
          is_own_stock: isOwnStock,
          asset_id: isOwnStock ? ownUnit!.id : null,
          customer_device_description: deviceDescription,
          customer_device_serial: deviceSerial,
          job_type: subType,
          replacement_asset_id: subType === 'replacement' ? replacementUnit!.id : null,
          problem_description: problem,
          amount_charged: amountCharged === '' ? null : amountCharged,
          payment_account: paymentAccount,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to save job.')
      }
      const body = await res.json()
      setDone(`Job ${body.job_number} saved.`)
      resetForm()
      router.replace('/dashboard/entry/service')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmitReturn = async () => {
    setError('')
    if (!returnUnit) { setError('Select the unit being returned.'); return }

    setSubmitting(true)
    try {
      const res = await apiFetch('/api/rma', {
        method: 'POST',
        body: JSON.stringify({
          asset_id: returnUnit.id,
          direction: 'from_customer',
          reason: returnReason,
          notes: returnNotes,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to record return.')
      }
      setDone('Return recorded. Unit sent back to QC.')
      resetForm()
      router.replace('/dashboard/entry/service')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <button onClick={() => router.push('/dashboard/entry')} className="text-sm text-gray-600 hover:text-gray-900 mb-2">
        ← Back
      </button>
      <h1 className="text-2xl font-bold mb-1">Service</h1>
      <p className="text-sm text-gray-500 mb-4">Repair, replacement, or return.</p>

      <div className="flex mb-4 border rounded overflow-hidden w-fit">
        {(['repair', 'replacement', 'return'] as const).map(t => (
          <button
            key={t}
            onClick={() => { setSubType(t); setError(''); setDone('') }}
            className={`px-4 py-2 text-sm font-medium capitalize ${subType === t ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {done && (
        <div className="bg-green-50 border border-green-200 text-green-800 rounded p-3 mb-4 flex justify-between items-center">
          <span>{done}</span>
          <button onClick={() => setDone('')} className="text-sm underline">Add another</button>
        </div>
      )}
      {error && <div className="text-red-600 mb-4">{error}</div>}

      {subType !== 'return' ? (
        <div className="space-y-4 bg-white p-4 rounded shadow">
          <div>
            <label className="block font-medium text-sm mb-1">Customer *</label>
            <div className="flex gap-2 items-start">
              <div className="flex-1">
                <SearchableCustomerSelect key={customerRefreshKey} value={customerId} onChange={setCustomerId} onCustomerData={() => {}} />
              </div>
              <QuickAddCustomerDialog onAdd={(created) => {
                if (created?.id) { setCustomerId(created.id); setCustomerRefreshKey(k => k + 1) }
              }} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="ownStock" checked={isOwnStock} onChange={(e) => setIsOwnStock(e.target.checked)} />
            <label htmlFor="ownStock" className="text-sm">This is our own stock (not a customer's personal device)</label>
          </div>

          {isOwnStock ? (
            <div>
              <label className="block font-medium text-sm mb-1">Unit *</label>
              <UnitPicker
                statusFilter="ready_for_sale,qc_passed,qc_pending,sold,faulty"
                selected={ownUnit}
                onSelect={setOwnUnit}
                onClear={() => setOwnUnit(null)}
                placeholder="Search our stock by asset number or serial..."
                browsable
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block font-medium text-sm mb-1">Device Description *</label>
                <input value={deviceDescription} onChange={(e) => setDeviceDescription(e.target.value)} placeholder="e.g. Dell Latitude 5420, i5 11th" className="border p-2 w-full rounded" />
              </div>
              <div>
                <label className="block font-medium text-sm mb-1">Serial Number</label>
                <input value={deviceSerial} onChange={(e) => setDeviceSerial(e.target.value)} className="border p-2 w-full rounded" />
              </div>
            </div>
          )}

          <div>
            <label className="block font-medium text-sm mb-1">Problem</label>
            <textarea value={problem} onChange={(e) => setProblem(e.target.value)} rows={2} className="border p-2 w-full rounded" />
          </div>

          {subType === 'replacement' && (
            <div>
              <label className="block font-medium text-sm mb-1">Replacement Unit (given to customer) *</label>
              <UnitPicker
                statusFilter="ready_for_sale,qc_passed"
                selected={replacementUnit}
                onSelect={setReplacementUnit}
                onClear={() => setReplacementUnit(null)}
                placeholder="Search available stock..."
                browsable
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-medium text-sm mb-1">Amount Charged (₹)</label>
              <input type="number" value={amountCharged} onChange={(e) => setAmountCharged(e.target.value === '' ? '' : Number(e.target.value))} className="border p-2 w-full rounded" />
            </div>
            <div>
              <label className="block font-medium text-sm mb-1">Received Into</label>
              <select value={paymentAccount} onChange={(e) => setPaymentAccount(e.target.value)} className="border p-2 w-full rounded">
                {PAYMENT_ACCOUNTS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={handleSubmitRepairOrReplacement} disabled={submitting} className="bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-50">
              {submitting ? 'Saving...' : `Save ${subType === 'repair' ? 'Repair' : 'Replacement'}`}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 bg-white p-4 rounded shadow">
          <div>
            <label className="block font-medium text-sm mb-1">Unit Being Returned *</label>
            <UnitPicker
              statusFilter="sold"
              selected={returnUnit}
              onSelect={setReturnUnit}
              onClear={() => setReturnUnit(null)}
              placeholder="Search sold units by asset number or serial..."
              browsable
            />
          </div>
          <div>
            <label className="block font-medium text-sm mb-1">Reason *</label>
            <select value={returnReason} onChange={(e) => setReturnReason(e.target.value)} className="border p-2 w-full rounded">
              {RETURN_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-medium text-sm mb-1">Notes</label>
            <textarea value={returnNotes} onChange={(e) => setReturnNotes(e.target.value)} rows={2} className="border p-2 w-full rounded" />
          </div>
          <div className="flex justify-end">
            <button onClick={handleSubmitReturn} disabled={submitting} className="bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-50">
              {submitting ? 'Saving...' : 'Record Return'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ServicePage() {
  return (
    <RequirePageAccess pageKey="new_entry">
      <Suspense fallback={<div className="p-4">Loading...</div>}>
        <ServicePageInner />
      </Suspense>
    </RequirePageAccess>
  )
}

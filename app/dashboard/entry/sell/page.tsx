'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { SearchableCustomerSelect } from '@/components/SearchableCustomerSelect'
import QuickAddCustomerDialog from '@/components/QuickAddCustomerDialog'
import { SearchableSelect } from '@/components/SearchableSelect'
import { useCustomOptions } from '@/lib/useCustomOptions'
import { FixSkuDialog } from '@/components/FixSkuDialog'
import RequirePageAccess from '@/components/RequirePageAccess'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { ReviewSummaryDialog } from '@/components/ReviewSummaryDialog'
import { buildConfigSummary, ConfigSummaryTemplate } from '@/lib/sku-config-summary'

interface StockUnit {
  id: string
  asset_number: string | null
  serial_number: string | null
  sku_code: string
  description: string
  category?: string | null
  specifications?: Record<string, any> | null
  status: string
}

interface Accessory {
  id: string
  accessory_name: string
  quantity: number
  selling_price: number | null
}

const PAYMENT_ACCOUNTS = ['Digitalbluez', 'Techtenth', 'Cash']

// Accessories are sku_master rows filtered to the non-serialized categories (see
// docs/decisions.md, 2026-07-23) -- map the raw SKU shape into this page's existing
// Accessory shape so the rest of the component doesn't need to change.
const ACCESSORY_CATEGORIES = 'RAM,SSD,CPU,GPU,KBD,MOUSE,ACC,ADP'
function mapSkuToAccessory(s: any): Accessory {
  return {
    id: s.id,
    accessory_name: s.sku_description || s.model_name || s.full_sku_code,
    quantity: s.quantity_in_stock,
    selling_price: s.selling_price_default,
  }
}

function unitLabel(u: StockUnit) {
  return u.asset_number || (u.serial_number ? `SN: ${u.serial_number}` : 'no tag yet')
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function SellPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const prefillAssetId = searchParams.get('asset_id')
  const prefillAccessoryId = searchParams.get('accessory_id')
  // Prefill from converting one line of a quotation/proforma (see
  // /dashboard/quotations) -- customer + price carried over, owner still
  // picks the specific physical unit (refurb units are qty-1/unique, so a
  // quote can never lock a specific serial number ahead of time).
  const prefillCustomerId = searchParams.get('customer_id')
  const sourceDocumentItemId = searchParams.get('source_document_item_id')
  const prefillRate = searchParams.get('prefill_rate')
  const prefillGstRate = searchParams.get('prefill_gst_rate')
  const skuSearch = searchParams.get('sku_search')

  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [showReview, setShowReview] = useState(false)

  const [mode, setMode] = useState<'unit' | 'accessory'>(prefillAccessoryId ? 'accessory' : 'unit')

  // Unit mode
  const [unitSearch, setUnitSearch] = useState('')
  const [units, setUnits] = useState<StockUnit[]>([])
  const [selectedUnit, setSelectedUnit] = useState<StockUnit | null>(null)
  const [loadingUnits, setLoadingUnits] = useState(false)
  const [bundled, setBundled] = useState<{ accessory_id: string; accessory_name: string; quantity: number; price: number }[]>([])
  const [showChangeSku, setShowChangeSku] = useState(false)
  const [templates, setTemplates] = useState<ConfigSummaryTemplate[]>([])

  useEffect(() => {
    apiFetch('/api/sku-category-templates').then(res => res.json()).then((data) => {
      setTemplates(Array.isArray(data) ? data : [])
    })
  }, [])

  const unitConfigSummary = (u: StockUnit) => buildConfigSummary(u.category, u.specifications, templates) || u.description

  // Accessory mode
  const [selectedAccessory, setSelectedAccessory] = useState<Accessory | null>(null)
  const [accessoryQty, setAccessoryQty] = useState<number>(1)
  const [browsableAccessories, setBrowsableAccessories] = useState<Accessory[]>([])

  // Shared accessory search (used by both bundle-picker and accessory-mode)
  const [accessorySearch, setAccessorySearch] = useState('')
  const [accessoryOptions, setAccessoryOptions] = useState<Accessory[]>([])

  const [customerId, setCustomerId] = useState<string | null>(null)
  const [customerData, setCustomerData] = useState<any>(null)
  const [customerRefreshKey, setCustomerRefreshKey] = useState(0)

  const [salePrice, setSalePrice] = useState<number>(0)
  const [gstPercent, setGstPercent] = useState<number>(18)
  const [saleType, setSaleType] = useState<'GST' | 'Cash'>('GST')
  const [priceMode, setPriceMode] = useState<'pre_gst' | 'post_gst'>('pre_gst')

  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'partial' | 'pending'>('paid')
  const [amountPaid, setAmountPaid] = useState<number>(0)
  const [paymentAccount, setPaymentAccount] = useState('Digitalbluez')
  const [saleDate, setSaleDate] = useState(today())

  const { values: staffNames } = useCustomOptions('staff_names')
  const [soldBy, setSoldBy] = useState('')

  // Browsable list of all sellable accessories, shown up-front in accessory mode
  // instead of requiring the employee to type before seeing anything.
  useEffect(() => {
    if (mode !== 'accessory') return
    apiFetch(`/api/sku-master?category=${ACCESSORY_CATEGORIES}`).then(res => res.json()).then((data) => {
      setBrowsableAccessories(Array.isArray(data) ? data.map(mapSkuToAccessory) : [])
    })
  }, [mode])

  const fetchUnitById = async (id: string) => {
    const res = await apiFetch(`/api/stock?id=${id}`)
    const data = await res.json()
    if (Array.isArray(data) && data[0]) {
      setSelectedUnit(data[0])
    }
  }

  // Prefill from Current/Live Stock's "Sell" link.
  useEffect(() => {
    if (!prefillAssetId) return
    setMode('unit')
    fetchUnitById(prefillAssetId)
  }, [prefillAssetId])

  // Prefill from Accessories page's "Sell" link.
  useEffect(() => {
    if (!prefillAccessoryId) return
    apiFetch(`/api/sku-master?id=${prefillAccessoryId}`).then(res => res.json()).then((data) => {
      if (Array.isArray(data) && data[0]) {
        setMode('accessory')
        setSelectedAccessory(mapSkuToAccessory(data[0]))
      }
    })
  }, [prefillAccessoryId])

  // Prefill from converting a quotation/proforma line.
  useEffect(() => {
    if (prefillCustomerId) setCustomerId(prefillCustomerId)
    if (skuSearch) { setMode('unit'); setUnitSearch(skuSearch) }
    if (prefillRate) { setSalePrice(Number(prefillRate)); setPriceMode('pre_gst') }
    if (prefillGstRate) { setGstPercent(Number(prefillGstRate)); setSaleType(Number(prefillGstRate) > 0 ? 'GST' : 'Cash') }
  }, [prefillCustomerId, skuSearch, prefillRate, prefillGstRate])

  useEffect(() => {
    if (mode !== 'unit') return
    if (!unitSearch.trim()) { setUnits([]); return }
    const timer = setTimeout(async () => {
      setLoadingUnits(true)
      const res = await apiFetch(`/api/stock?status=ready_for_sale,qc_passed&source=employee_intake&search=${encodeURIComponent(unitSearch)}`)
      const data = await res.json()
      setUnits(Array.isArray(data) ? data : [])
      setLoadingUnits(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [unitSearch, mode])

  useEffect(() => {
    if (!accessorySearch.trim()) { setAccessoryOptions([]); return }
    const timer = setTimeout(async () => {
      const res = await apiFetch(`/api/sku-master?category=${ACCESSORY_CATEGORIES}&search=${encodeURIComponent(accessorySearch)}`)
      const data = await res.json()
      setAccessoryOptions(Array.isArray(data) ? data.map(mapSkuToAccessory) : [])
    }, 300)
    return () => clearTimeout(timer)
  }, [accessorySearch])

  const bundledAddOnsTotal = bundled.reduce((sum, b) => sum + (b.price || 0) * b.quantity, 0)
  const unitBaseGstPrice = priceMode === 'pre_gst' ? salePrice : salePrice / (1 + gstPercent / 100)
  const baseGstPrice = unitBaseGstPrice + bundledAddOnsTotal
  const gstAmount = saleType === 'GST' ? Math.round(baseGstPrice * gstPercent * 100) / 10000 : 0
  const total = saleType === 'GST' ? baseGstPrice + gstAmount : baseGstPrice
  const balanceDue = total - (paymentStatus === 'paid' ? total : amountPaid)

  // Switching modes converts the number in the box so the total the customer pays
  // stays the same -- never just relabels a stale number under the new meaning.
  const handlePriceModeChange = (newMode: 'pre_gst' | 'post_gst') => {
    if (saleType === 'GST' && salePrice > 0 && newMode !== priceMode) {
      if (newMode === 'post_gst') {
        setSalePrice(Math.round(salePrice * (1 + gstPercent / 100) * 100) / 100)
      } else {
        setSalePrice(Math.round((salePrice / (1 + gstPercent / 100)) * 100) / 100)
      }
    }
    setPriceMode(newMode)
  }

  const resetForm = () => {
    setSelectedUnit(null); setUnitSearch(''); setUnits([]); setBundled([])
    setSelectedAccessory(null); setAccessoryQty(1)
    setAccessorySearch(''); setAccessoryOptions([])
    setCustomerId(null); setCustomerData(null)
    setSalePrice(0); setGstPercent(18); setSaleType('GST'); setPriceMode('pre_gst')
    setPaymentStatus('paid'); setAmountPaid(0); setPaymentAccount('Digitalbluez'); setSoldBy('')
    setSaleDate(today())
  }

  const addBundledAccessory = (a: Accessory) => {
    if (bundled.some(b => b.accessory_id === a.id)) return
    setBundled(prev => [...prev, { accessory_id: a.id, accessory_name: a.accessory_name, quantity: 1, price: 0 }])
    setAccessorySearch(''); setAccessoryOptions([])
  }

  const openReview = () => {
    setError('')
    if (mode === 'unit' && !selectedUnit) { setError('Select a unit to sell.'); return }
    if (mode === 'accessory' && !selectedAccessory) { setError('Select an accessory to sell.'); return }
    if (!customerId) { setError('Select or add a customer.'); return }
    if (!salePrice || salePrice <= 0) { setError('Enter a valid selling price.'); return }
    setShowReview(true)
  }

  const { run: handleSubmit, pending: submitting } = useAsyncAction(async () => {
    setError('')
    if (mode === 'unit' && !selectedUnit) { setError('Select a unit to sell.'); return }
    if (mode === 'accessory' && !selectedAccessory) { setError('Select an accessory to sell.'); return }
    if (!customerId) { setError('Select or add a customer.'); return }
    if (!salePrice || salePrice <= 0) { setError('Enter a valid selling price.'); return }

    try {
      const payload: any = {
        customer_id: customerId,
        sale_base_price: baseGstPrice,
        gst_percentage: saleType === 'GST' ? gstPercent : 0,
        sale_type: saleType,
        sale_date: saleDate,
        payment_status: paymentStatus,
        amount_paid: paymentStatus === 'partial' ? amountPaid : undefined,
        payment_account: paymentAccount,
        sold_by: soldBy || undefined,
        source_document_item_id: sourceDocumentItemId || undefined,
      }
      if (mode === 'unit') {
        payload.asset_ledger_id = selectedUnit!.id
        if (bundled.length > 0) {
          payload.bundled_accessories = bundled.map(b => ({ accessory_id: b.accessory_id, quantity: b.quantity, unit_price: b.price || 0 }))
        }
      } else {
        payload.accessory_id = selectedAccessory!.id
        payload.accessory_quantity = accessoryQty
      }

      const res = await apiFetch('/api/sales-entry', { method: 'POST', body: JSON.stringify(payload) })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to record sale.')
      }
      setDone(true)
      resetForm()
      router.replace('/dashboard/entry/sell')
    } catch (err: any) {
      setError(err.message)
    }
  })

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <button onClick={() => router.push('/dashboard/entry')} className="text-sm text-gray-600 hover:text-gray-900 mb-2">
        ← Back
      </button>
      <h1 className="text-2xl font-bold mb-1">Sell</h1>
      <p className="text-sm text-gray-500 mb-4">
        This unit/accessory leaves stock immediately. The GST invoice is generated separately by the owner.
      </p>

      {sourceDocumentItemId && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded p-3 mb-4 text-sm">
          Converting one line from a quotation/proforma — customer and price carried over. Pick the specific unit to sell below.
        </div>
      )}
      {done && (
        <div className="bg-green-50 border border-green-200 text-green-800 rounded p-3 mb-4 flex justify-between items-center">
          <span>Sale recorded — stock updated. Invoice will be generated later.</span>
          <button onClick={() => setDone(false)} className="text-sm underline">Record another</button>
        </div>
      )}
      {error && <div className="text-red-600 mb-4">{error}</div>}

      <div className="flex mb-4 border rounded overflow-hidden w-fit">
        <button
          onClick={() => setMode('unit')}
          className={`px-4 py-2 text-sm font-medium ${mode === 'unit' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}
        >
          Laptop / Desktop / Monitor
        </button>
        <button
          onClick={() => setMode('accessory')}
          className={`px-4 py-2 text-sm font-medium ${mode === 'accessory' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}
        >
          Accessory Only
        </button>
      </div>

      <div className="space-y-4 bg-white p-4 rounded shadow">
        {mode === 'unit' ? (
          <div className="relative">
            <label className="block font-medium text-sm mb-1">Unit *</label>
            {selectedUnit ? (
              <div className="border p-2 rounded flex justify-between items-center bg-blue-50">
                <div>
                  <div className="font-medium">{unitLabel(selectedUnit)}</div>
                  <div className="text-xs text-gray-600">{selectedUnit.sku_code} — {unitConfigSummary(selectedUnit)}</div>
                  <button type="button" onClick={() => setShowChangeSku(true)} className="text-blue-600 underline text-xs mt-1">
                    Wrong or upgraded spec? Change SKU
                  </button>
                </div>
                <button onClick={() => setSelectedUnit(null)} className="text-red-500 text-sm">✕ Change</button>
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-500 mb-1">
                  Search here, or go to <a href="/dashboard/live-stock" className="underline">Live Stock</a> and click "Sell" on a unit.
                </p>
                <input
                  value={unitSearch}
                  onChange={(e) => setUnitSearch(e.target.value)}
                  placeholder="Search by asset number, serial, or model..."
                  className="border p-2 w-full rounded"
                />
                {loadingUnits && <div className="text-xs text-gray-400 mt-1">Searching...</div>}
                {units.length > 0 && (
                  <ul className="border rounded mt-1 max-h-48 overflow-y-auto">
                    {units.map(u => (
                      <li
                        key={u.id}
                        onClick={() => { setSelectedUnit(u); setUnitSearch(''); setUnits([]) }}
                        className="p-2 hover:bg-gray-100 cursor-pointer border-b last:border-b-0"
                      >
                        <div className="font-medium">{unitLabel(u)}</div>
                        <div className="text-xs text-gray-600">{u.sku_code} — {unitConfigSummary(u)}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="relative">
            <label className="block font-medium text-sm mb-1">Accessory *</label>
            {selectedAccessory ? (
              <div className="border p-2 rounded flex justify-between items-center bg-blue-50">
                <div>
                  <div className="font-medium">{selectedAccessory.accessory_name}</div>
                  <div className="text-xs text-gray-600">{selectedAccessory.quantity} in stock</div>
                </div>
                <button onClick={() => setSelectedAccessory(null)} className="text-red-500 text-sm">✕ Change</button>
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-500 mb-1">
                  Search here, or browse the full list below (also on the <a href="/dashboard/accessories" className="underline">Accessories</a> page).
                </p>
                <input
                  value={accessorySearch}
                  onChange={(e) => setAccessorySearch(e.target.value)}
                  placeholder="Search accessory (mouse, bag, keyboard...)"
                  className="border p-2 w-full rounded"
                />
                {accessoryOptions.length > 0 && (
                  <ul className="border rounded mt-1 max-h-48 overflow-y-auto">
                    {accessoryOptions.map(a => (
                      <li
                        key={a.id}
                        onClick={() => { setSelectedAccessory(a); setAccessorySearch(''); setAccessoryOptions([]) }}
                        className="p-2 hover:bg-gray-100 cursor-pointer border-b last:border-b-0"
                      >
                        <div className="font-medium">{a.accessory_name}</div>
                        <div className="text-xs text-gray-600">{a.quantity} in stock</div>
                      </li>
                    ))}
                  </ul>
                )}
                {!accessorySearch.trim() && browsableAccessories.length > 0 && (
                  <ul className="border rounded mt-2 max-h-64 overflow-y-auto">
                    {browsableAccessories.map(a => (
                      <li
                        key={a.id}
                        onClick={() => setSelectedAccessory(a)}
                        className="p-2 hover:bg-gray-100 cursor-pointer border-b last:border-b-0 flex justify-between"
                      >
                        <span className="font-medium">{a.accessory_name}</span>
                        <span className="text-xs text-gray-500">{a.quantity} in stock</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {selectedAccessory && (
              <div className="mt-2">
                <label className="block font-medium text-sm mb-1">Quantity</label>
                <input type="number" min={1} max={selectedAccessory.quantity} value={accessoryQty} onChange={(e) => setAccessoryQty(Number(e.target.value))} className="border p-2 w-32 rounded" />
              </div>
            )}
          </div>
        )}

        {mode === 'unit' && selectedUnit && (
          <div>
            <label className="block font-medium text-sm mb-1">Bundled Accessories (free by default -- set a price if the customer is paying extra, e.g. RAM upgrade, mouse)</label>
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
                    {a.accessory_name} <span className="text-xs text-gray-500">({a.quantity} in stock)</span>
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
                      title="Quantity"
                    />
                    <input
                      type="number"
                      min={0}
                      value={b.price || ''}
                      onChange={(e) => setBundled(prev => prev.map((p, i) => i === idx ? { ...p, price: Number(e.target.value) } : p))}
                      placeholder="₹0 (free)"
                      className="w-20 border rounded text-center"
                      title="Extra charge per unit"
                    />
                    <button onClick={() => setBundled(prev => prev.filter((_, i) => i !== idx))} className="text-red-500">✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <label className="block font-medium text-sm mb-1">Customer *</label>
          <div className="flex gap-2 items-start">
            <div className="flex-1">
              <SearchableCustomerSelect
                key={customerRefreshKey}
                value={customerId}
                onChange={setCustomerId}
                onCustomerData={setCustomerData}
              />
            </div>
            <QuickAddCustomerDialog onAdd={(created) => {
              if (created?.id) {
                setCustomerId(created.id)
                setCustomerData(created)
                setCustomerRefreshKey(k => k + 1)
              }
            }} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block font-medium text-sm mb-1">Sale Type</label>
            <select value={saleType} onChange={(e) => setSaleType(e.target.value as 'GST' | 'Cash')} className="border p-2 w-full rounded">
              <option value="GST">GST</option>
              <option value="Cash">Cash</option>
            </select>
          </div>
          <div>
            <label className="block font-medium text-sm mb-1">
              Selling Price {saleType === 'GST' ? (priceMode === 'pre_gst' ? '(Pre-GST) ' : '(GST-Inclusive) ') : ''}(₹) *
            </label>
            <input type="number" value={salePrice || ''} onChange={(e) => setSalePrice(Number(e.target.value))} className="border p-2 w-full rounded" />
          </div>
          {saleType === 'GST' && (
            <div>
              <label className="block font-medium text-sm mb-1">GST %</label>
              <input type="number" value={gstPercent} onChange={(e) => setGstPercent(Number(e.target.value))} className="border p-2 w-full rounded" />
            </div>
          )}
        </div>

        {saleType === 'GST' && (
          <div>
            <label className="block font-medium text-sm mb-1">Price entered is</label>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1">
                <input type="radio" checked={priceMode === 'pre_gst'} onChange={() => handlePriceModeChange('pre_gst')} />
                Before GST
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={priceMode === 'post_gst'} onChange={() => handlePriceModeChange('post_gst')} />
                After GST (Inclusive)
              </label>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block font-medium text-sm mb-1">Sale Date</label>
            <input
              type="date"
              value={saleDate}
              max={today()}
              onChange={(e) => setSaleDate(e.target.value)}
              className="border p-2 w-full rounded"
            />
            <p className="text-xs text-gray-400 mt-1">Backdate if this sale actually happened earlier.</p>
          </div>
          <div>
            <label className="block font-medium text-sm mb-1">Payment</label>
            <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value as any)} className="border p-2 w-full rounded">
              <option value="paid">Paid in full</option>
              <option value="partial">Partial</option>
              <option value="pending">Payment Pending</option>
            </select>
          </div>
          {paymentStatus === 'partial' && (
            <div>
              <label className="block font-medium text-sm mb-1">Amount Paid (₹)</label>
              <input type="number" value={amountPaid} onChange={(e) => setAmountPaid(Number(e.target.value))} className="border p-2 w-full rounded" />
            </div>
          )}
          <div>
            <label className="block font-medium text-sm mb-1">Received Into</label>
            <select value={paymentAccount} onChange={(e) => setPaymentAccount(e.target.value)} className="border p-2 w-full rounded">
              {PAYMENT_ACCOUNTS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-medium text-sm mb-1">Sold By</label>
            <SearchableSelect options={staffNames} value={soldBy} onChange={setSoldBy} placeholder="Myself / select..." />
          </div>
        </div>

        <div className="text-right text-sm space-y-1">
          {bundledAddOnsTotal > 0 && <p>Add-ons: ₹{bundledAddOnsTotal.toFixed(2)}</p>}
          {saleType === 'GST' && priceMode === 'post_gst' && <p>Pre-GST: ₹{baseGstPrice.toFixed(2)}</p>}
          {saleType === 'GST' && <p>GST: ₹{gstAmount.toFixed(2)}</p>}
          <p className="font-bold text-base">Total: ₹{total.toFixed(2)}</p>
          {paymentStatus !== 'paid' && <p className="text-amber-700">Balance due: ₹{balanceDue.toFixed(2)}</p>}
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => openReview()}
            disabled={submitting}
            className="bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-50"
          >
            {submitting && <Loader2 className="inline size-4 animate-spin mr-1" />}
            {submitting ? 'Saving...' : 'Review & Record Sale'}
          </button>
        </div>
      </div>

      {showChangeSku && selectedUnit && (
        <FixSkuDialog
          assetId={selectedUnit.id}
          onClose={() => setShowChangeSku(false)}
          onReassigned={() => fetchUnitById(selectedUnit.id)}
        />
      )}

      {showReview && (
        <ReviewSummaryDialog
          title="Review Sale"
          confirming={submitting}
          onBack={() => setShowReview(false)}
          onConfirm={async () => { await handleSubmit(); setShowReview(false) }}
          rows={[
            { label: 'Item', value: mode === 'unit'
              ? (selectedUnit ? `${unitLabel(selectedUnit)} — ${selectedUnit.sku_code}` : '')
              : (selectedAccessory ? `${selectedAccessory.accessory_name} × ${accessoryQty}` : '') },
            { label: 'Customer', value: customerData?.customer_name || '' },
            { label: 'Sale Type', value: saleType },
            { label: 'Selling Price', value: `₹${salePrice.toFixed(2)}` },
            ...(bundled.length > 0 ? [{ label: 'Bundled Accessories', value: bundled.map(b => `${b.accessory_name} ×${b.quantity}${b.price ? ` (+₹${b.price})` : ''}`).join(', ') }] : []),
            { label: 'Total', value: `₹${total.toFixed(2)}` },
            { label: 'Payment', value: paymentStatus === 'partial' ? `Partial — ₹${amountPaid.toFixed(2)} paid` : paymentStatus },
            { label: 'Received Into', value: paymentAccount },
            { label: 'Sold By', value: soldBy },
            { label: 'Sale Date', value: saleDate },
          ]}
        />
      )}
    </div>
  )
}

export default function SellPage() {
  return (
    <RequirePageAccess pageKey="new_entry">
      <Suspense fallback={<div className="p-4">Loading...</div>}>
        <SellPageInner />
      </Suspense>
    </RequirePageAccess>
  )
}

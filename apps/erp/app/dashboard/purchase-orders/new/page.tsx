'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import RequireOwner from '@/components/RequireOwner'
import { SkuFormModal } from '@/components/SkuFormModal'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { computeFromUnitPrice, computeFromLineTotal } from '@/lib/po-gst-calc'

interface Vendor {
  id: string
  company_name: string
}

interface CategoryTemplate {
  category: string
  display_name: string
  field_schema: any
  sku_code_format?: string
}

interface SKU {
  id: string
  full_sku_code: string
  sku_description: string
  category: string
  brand: string
  model_name: string
  specifications: Record<string, any>
  base_cost: number | null
  hsn_code?: string | null
}

interface LineItem {
  sku_id: string
  sku_full_code: string
  description: string
  specs: Record<string, any>
  quantity: number
  unit_price: number
  line_total_before_gst: number
  gst_percentage: number
  gst_amount: number
  line_total: number
  hsn_code: string
}

function NewPurchaseOrderPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)

  // Header state
  const [vendorId, setVendorId] = useState('')
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10))
  const [purchaseType, setPurchaseType] = useState('GST')
  const [purchasedByType, setPurchasedByType] = useState('Digitalbluez')
  const [expectedDelivery, setExpectedDelivery] = useState('')
  const [remarks, setRemarks] = useState('')

  // Vendors & SKUs
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [skuSearch, setSkuSearch] = useState('')
  const [skuOptions, setSkuOptions] = useState<SKU[]>([])
  const [showSkuDropdown, setShowSkuDropdown] = useState(false)
  const [skuTemplates, setSkuTemplates] = useState<CategoryTemplate[]>([])
  const [showCreateSku, setShowCreateSku] = useState(false)

  // Line items
  const [items, setItems] = useState<LineItem[]>([])
  const [selectedSku, setSelectedSku] = useState<SKU | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [unitPrice, setUnitPrice] = useState<number>(0)
  const [gstPercent, setGstPercent] = useState(18)
  const [lineTotalInput, setLineTotalInput] = useState<number>(0)
  const [hsnCode, setHsnCode] = useState('')

  // Submit
  const [error, setError] = useState('')

  // Load vendors
  useEffect(() => {
    apiFetch('/api/vendors').then(res => res.json()).then(setVendors)
  }, [])

  // Load SKU category templates (needed for the inline "create new SKU" modal)
  useEffect(() => {
    apiFetch('/api/sku-category-templates').then(res => res.json()).then(setSkuTemplates)
  }, [])

  // Debounced SKU search
  useEffect(() => {
    if (!skuSearch.trim()) {
      setSkuOptions([])
      return
    }
    const timer = setTimeout(() => {
      apiFetch(`/api/sku-master?search=${encodeURIComponent(skuSearch)}`)
        .then(res => res.json())
        .then(setSkuOptions)
    }, 300)
    return () => clearTimeout(timer)
  }, [skuSearch])

  // When SKU selected
  useEffect(() => {
    if (selectedSku) {
      const baseCost = selectedSku.base_cost ?? 0
      setUnitPrice(baseCost)
      setQuantity(1)
      setGstPercent(18)
      setHsnCode(selectedSku.hsn_code || '')
      setLineTotalInput(computeFromUnitPrice(baseCost, 1, 18).lineTotal)
    }
  }, [selectedSku])

  // Forward calc: unit price/quantity/GST% -> line total. This is the only path
  // quantity changes ever take -- increasing quantity must always scale the total
  // up from the current unit price, never back-solve a smaller unit price from a
  // stale total (that was the bug: a prior reverse-calc could silently shrink the
  // unit price when quantity changed after the user had last edited Line Total).
  const recalcLineTotal = (newUnitPrice: number, newQuantity: number, newGstPercent: number) => {
    setLineTotalInput(computeFromUnitPrice(newUnitPrice, newQuantity, newGstPercent).lineTotal)
  }

  const handleQuantityChange = (newQty: number) => {
    setQuantity(newQty)
    recalcLineTotal(unitPrice, newQty, gstPercent)
  }

  const handleUnitPriceChange = (newUnitPrice: number) => {
    setUnitPrice(newUnitPrice)
    recalcLineTotal(newUnitPrice, quantity, gstPercent)
  }

  const handleGstPercentChange = (newGstPercent: number) => {
    setGstPercent(newGstPercent)
    recalcLineTotal(unitPrice, quantity, newGstPercent)
  }

  // Reverse calc: only a direct edit of the Line Total field itself back-solves
  // unit price -- quantity/unit-price/GST% edits never trigger this.
  const handleLineTotalChange = (newLineTotal: number) => {
    setLineTotalInput(newLineTotal)
    setUnitPrice(computeFromLineTotal(newLineTotal, quantity, gstPercent).unitPrice)
  }

  const addItem = () => {
    if (!selectedSku || quantity <= 0 || unitPrice <= 0) return
    const { lineTotalBeforeGst, gstAmount, lineTotal } = computeFromUnitPrice(unitPrice, quantity, gstPercent)
    const newItem: LineItem = {
      sku_id: selectedSku.id,
      sku_full_code: selectedSku.full_sku_code,
      description: selectedSku.sku_description,
      specs: selectedSku.specifications || {},
      quantity,
      unit_price: unitPrice,
      line_total_before_gst: lineTotalBeforeGst,
      gst_percentage: gstPercent,
      gst_amount: gstAmount,
      line_total: lineTotal,
      hsn_code: hsnCode,
    }
    setItems(prev => [...prev, newItem])
    // Reset selection
    setSelectedSku(null)
    setSkuSearch('')
    setQuantity(1)
    setUnitPrice(0)
    setGstPercent(18)
    setLineTotalInput(0)
    setHsnCode('')
  }

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  // PO totals
  const poTotals = useMemo(() => {
    const totalBeforeGst = items.reduce((sum, item) => sum + item.line_total_before_gst, 0)
    const totalGst = items.reduce((sum, item) => sum + item.gst_amount, 0)
    const grandTotal = items.reduce((sum, item) => sum + item.line_total, 0)
    return { totalBeforeGst, totalGst, grandTotal }
  }, [items])

  const { run: handleSubmit, pending: submitting } = useAsyncAction(async () => {
    setError('')
    const payload = {
      vendor_id: vendorId,
      po_date: poDate,
      purchase_type: purchaseType,
      purchased_by_type: purchasedByType,
      expected_delivery_date: expectedDelivery || null,
      remarks,
      items: items.map(item => ({
        sku_id: item.sku_id,
        quantity: item.quantity,
        base_price: item.unit_price,
        gst_percentage: item.gst_percentage,
        hsn_code: item.hsn_code,
      })),
    }
    const res = await apiFetch('/api/purchase-orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      const data = await res.json()
      router.push(`/dashboard/purchase-orders/${data.po_id}`)
    } else {
      const err = await res.json().catch(() => ({}))
      setError(err.error || 'Failed to create PO')
    }
  })

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <button onClick={() => router.push('/dashboard/purchase-orders')} className="text-sm text-gray-600 hover:text-gray-900 mb-2">
        ← Back to Purchase Orders
      </button>
      <h1 className="text-2xl font-bold mb-4">New Purchase Order</h1>
      <div className="flex mb-6">
        {[1, 2, 3].map(s => (
          <div key={s} className={`flex-1 text-center py-2 ${step === s ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>
            Step {s}: {s === 1 ? 'Header' : s === 2 ? 'Items' : 'Review'}
          </div>
        ))}
      </div>
      {error && <div className="text-red-600 mb-4">{error}</div>}

      {/* Step 1: Header (unchanged) */}
      {step === 1 && (
        <div>
          <div className="mb-4">
            <label className="block font-medium">Vendor</label>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="border p-2 w-full rounded">
              <option value="">Select vendor...</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.company_name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block font-medium">PO Date</label>
              <input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} className="border p-2 w-full rounded" />
            </div>
            <div>
              <label className="block font-medium">Expected Delivery</label>
              <input type="date" value={expectedDelivery} onChange={(e) => setExpectedDelivery(e.target.value)} className="border p-2 w-full rounded" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block font-medium">Purchase Type</label>
              <select value={purchaseType} onChange={(e) => setPurchaseType(e.target.value)} className="border p-2 w-full rounded">
                <option value="GST">GST</option>
                <option value="Cash">Cash</option>
              </select>
            </div>
            <div>
              <label className="block font-medium">Purchased By</label>
              <select value={purchasedByType} onChange={(e) => setPurchasedByType(e.target.value)} className="border p-2 w-full rounded">
                <option value="Digitalbluez">Digitalbluez</option>
                <option value="Techtenth">Techtenth</option>
                <option value="Cash">Cash</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
          <div className="mb-4">
            <label className="block font-medium">Remarks</label>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} className="border p-2 w-full rounded" />
          </div>
          <div className="flex justify-end">
            <button onClick={() => setStep(2)} disabled={!vendorId || !poDate} className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50">
              Next: Add Items
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Add Items */}
      {step === 2 && (
        <div>
          <h2 className="text-lg font-semibold mb-2">Add Line Items</h2>
          <div className="mb-4 relative">
            <label className="block font-medium">Search SKU</label>
            <input
              type="text"
              value={skuSearch}
              onChange={(e) => { setSkuSearch(e.target.value); setShowSkuDropdown(true); }}
              onFocus={() => setShowSkuDropdown(true)}
              className="border p-2 w-full rounded"
              placeholder="Type to search SKU..."
            />
            {showSkuDropdown && skuOptions.length > 0 && (
              <ul className="absolute z-10 bg-white border w-full max-h-40 overflow-y-auto">
                {skuOptions.map(sku => (
                  <li
                    key={sku.id}
                    className="p-2 hover:bg-gray-100 cursor-pointer"
                    onClick={() => {
                      setSelectedSku(sku)
                      setSkuSearch(sku.full_sku_code)
                      setShowSkuDropdown(false)
                    }}
                  >
                    <div className="font-medium">{sku.full_sku_code}</div>
                    <div className="text-sm text-gray-600">{sku.sku_description}</div>
                    <div className="text-xs text-gray-400">
                      {[sku.brand, sku.model_name, sku.hsn_code && `HSN: ${sku.hsn_code}`, ...Object.values(sku.specifications || {}).filter(v => v)]
                        .filter(Boolean).join(' · ')}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {showSkuDropdown && skuSearch.trim() && skuOptions.length === 0 && (
              <div className="absolute z-10 bg-white border w-full p-3 text-sm">
                No matching SKU found.{' '}
                <button
                  type="button"
                  onClick={() => setShowCreateSku(true)}
                  className="text-blue-600 underline"
                >
                  + Create new SKU
                </button>
              </div>
            )}
          </div>

          {selectedSku && (
            <div className="border p-4 rounded mb-4 bg-gray-50">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-bold">{selectedSku.full_sku_code}</h3>
                  <p className="text-gray-700">{selectedSku.sku_description}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    {selectedSku.brand && <p><span className="text-gray-500">Brand:</span> {selectedSku.brand}</p>}
                    {selectedSku.model_name && <p><span className="text-gray-500">Model:</span> {selectedSku.model_name}</p>}
                    {Object.entries(selectedSku.specifications || {}).map(([key, val]) => (
                      val !== null && val !== '' && (
                        <p key={key}><span className="text-gray-500">{key}:</span> {String(val)}</p>
                      )
                    ))}
                    {selectedSku.hsn_code && <p><span className="text-gray-500">HSN:</span> {selectedSku.hsn_code}</p>}
                  </div>
                </div>
                <button onClick={() => { setSelectedSku(null); setSkuSearch(''); }} className="text-red-500 text-sm">✕ Clear</button>
              </div>

              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium">Quantity</label>
                  <input type="number" min={1} value={quantity} onChange={(e) => handleQuantityChange(Number(e.target.value))} className="border p-2 w-full rounded" />
                </div>
                <div>
                  <label className="block text-sm font-medium">Unit Price (before GST) (₹)</label>
                  <input type="number" value={unitPrice} onChange={(e) => handleUnitPriceChange(Number(e.target.value))} className="border p-2 w-full rounded" />
                </div>
                <div>
                  <label className="block text-sm font-medium">GST %</label>
                  <input type="number" value={gstPercent} onChange={(e) => handleGstPercentChange(Number(e.target.value))} className="border p-2 w-full rounded" />
                </div>
                <div>
                  <label className="block text-sm font-medium">Line Total (incl. GST) (₹)</label>
                  <input type="number" value={lineTotalInput} onChange={(e) => handleLineTotalChange(Number(e.target.value))} className="border p-2 w-full rounded" />
                </div>
                <div className="col-span-2 md:col-span-4">
                  <label className="block text-sm font-medium">HSN Code</label>
                  <input type="text" value={hsnCode} onChange={(e) => setHsnCode(e.target.value)} className="border p-2 w-full rounded" placeholder="Auto‑filled from SKU" />
                </div>
              </div>
              <button onClick={addItem} className="mt-3 bg-green-600 text-white px-4 py-2 rounded">Add Item</button>
            </div>
          )}

          {items.length > 0 && (
            <div className="mt-6">
              <h3 className="font-semibold mb-2">Added Items</h3>
              <table className="min-w-full border text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border p-2 text-left">SKU</th>
                    <th className="border p-2 text-left">Specs</th>
                    <th className="border p-2 text-left">HSN</th>
                    <th className="border p-2 text-right">Qty</th>
                    <th className="border p-2 text-right">Unit Price</th>
                    <th className="border p-2 text-right">GST%</th>
                    <th className="border p-2 text-right">Line Total</th>
                    <th className="border p-2 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    // Build a compact specs summary
                    const specsSummary = [
                      item.specs?.brand,
                      item.specs?.model,
                      ...Object.entries(item.specs || {})
                        .filter(([key, val]) => val !== null && val !== '' && key !== 'brand' && key !== 'model')
                        .map(([key, val]) => `${key}: ${val}`)
                    ].filter(Boolean).join(', ') || '—'

                    return (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="border p-2">
                          <div className="font-medium">{item.sku_full_code}</div>
                          <div className="text-xs text-gray-500">{item.description}</div>
                        </td>
                        <td className="border p-2 text-xs text-gray-600">{specsSummary}</td>
                        <td className="border p-2 text-xs">{item.hsn_code || '—'}</td>
                        <td className="border p-2 text-right">{item.quantity}</td>
                        <td className="border p-2 text-right">₹{item.unit_price.toFixed(2)}</td>
                        <td className="border p-2 text-right">{item.gst_percentage}%</td>
                        <td className="border p-2 text-right">₹{item.line_total.toFixed(2)}</td>
                        <td className="border p-2 text-center">
                          <button onClick={() => removeItem(idx)} className="text-red-500">✕</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="text-right mt-2 space-y-1 text-sm">
                <p>Total (before GST): ₹{poTotals.totalBeforeGst.toFixed(2)}</p>
                <p>Total GST: ₹{poTotals.totalGst.toFixed(2)}</p>
                <p className="font-bold text-base">Grand Total: ₹{poTotals.grandTotal.toFixed(2)}</p>
              </div>
            </div>
          )}

          <div className="flex justify-between mt-6">
            <button onClick={() => setStep(1)} className="bg-gray-200 px-4 py-2 rounded">Back</button>
            <button onClick={() => setStep(3)} disabled={items.length === 0} className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50">
              Review Order
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Review */}
      {step === 3 && (
        <div>
          <h2 className="text-lg font-semibold mb-2">Review Order</h2>
          <div className="border p-4 mb-4 rounded bg-white">
            <p><strong>Vendor:</strong> {vendors.find(v => v.id === vendorId)?.company_name || 'N/A'}</p>
            <p><strong>Date:</strong> {poDate}</p>
            <p><strong>Expected Delivery:</strong> {expectedDelivery || 'N/A'}</p>
            <p><strong>Type:</strong> {purchaseType} / {purchasedByType}</p>
          </div>

          <h3 className="font-semibold mb-2">Items ({items.length})</h3>
          <table className="min-w-full border mb-4 text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="border p-2 text-left">SKU</th>
                <th className="border p-2 text-left">Specs</th>
                <th className="border p-2 text-left">HSN</th>
                <th className="border p-2 text-right">Qty</th>
                <th className="border p-2 text-right">Unit Price</th>
                <th className="border p-2 text-right">GST</th>
                <th className="border p-2 text-right">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const specsSummary = [
                  item.specs?.brand,
                  item.specs?.model,
                  ...Object.entries(item.specs || {})
                    .filter(([key, val]) => val !== null && val !== '' && key !== 'brand' && key !== 'model')
                    .map(([key, val]) => `${key}: ${val}`)
                ].filter(Boolean).join(', ') || '—'

                return (
                  <tr key={idx}>
                    <td className="border p-2">
                      <div className="font-medium">{item.sku_full_code}</div>
                      <div className="text-xs text-gray-500">{item.description}</div>
                    </td>
                    <td className="border p-2 text-xs text-gray-600">{specsSummary}</td>
                    <td className="border p-2 text-xs">{item.hsn_code || '—'}</td>
                    <td className="border p-2 text-right">{item.quantity}</td>
                    <td className="border p-2 text-right">₹{item.unit_price.toFixed(2)}</td>
                    <td className="border p-2 text-right">{item.gst_percentage}%</td>
                    <td className="border p-2 text-right">₹{item.line_total.toFixed(2)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div className="text-right font-bold text-lg">
            Grand Total: ₹{poTotals.grandTotal.toFixed(2)}
          </div>

          <div className="flex justify-between mt-4">
            <button onClick={() => setStep(2)} className="bg-gray-200 px-4 py-2 rounded">Back</button>
            <button onClick={() => handleSubmit()} disabled={submitting} className="bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-50 inline-flex items-center gap-1.5">
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting ? 'Creating...' : 'Create Purchase Order'}
            </button>
          </div>
        </div>
      )}

      {showCreateSku && (
        <SkuFormModal
          templates={skuTemplates}
          existingSku={null}
          onClose={() => setShowCreateSku(false)}
          onSaved={(sku) => {
            setSelectedSku(sku)
            setSkuSearch(sku.full_sku_code)
            setShowCreateSku(false)
            setShowSkuDropdown(false)
          }}
        />
      )}
    </div>
  )
}

export default function NewPurchaseOrderPageGuarded() {
  return (
    <RequireOwner>
      <NewPurchaseOrderPage />
    </RequireOwner>
  )
}
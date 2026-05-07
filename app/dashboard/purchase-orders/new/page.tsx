'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'

interface Vendor {
  id: string
  company_name: string
}

interface SKU {
  id: string
  full_sku_code: string
  sku_description: string
  category: string
}

interface LineItem {
  sku_id: string
  sku_full_code: string
  description: string
  quantity: number
  base_price: number
  gst_percentage: number
}

export default function NewPurchaseOrderPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)

  // Header state
  const [vendorId, setVendorId] = useState('')
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10))
  const [purchaseType, setPurchaseType] = useState('GST')
  const [purchasedByType, setPurchasedByType] = useState('Digitalbluez')
  const [expectedDelivery, setExpectedDelivery] = useState('')
  const [remarks, setRemarks] = useState('')

  // Vendors list
  const [vendors, setVendors] = useState<Vendor[]>([])
  // SKUs for search
  const [skuSearch, setSkuSearch] = useState('')
  const [skuOptions, setSkuOptions] = useState<SKU[]>([])
  const [showSkuDropdown, setShowSkuDropdown] = useState(false)

  // Line items
  const [items, setItems] = useState<LineItem[]>([])
  const [selectedSku, setSelectedSku] = useState<SKU | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [basePrice, setBasePrice] = useState(0)
  const [gstPercent, setGstPercent] = useState(18)

  // Loading and error
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch('/api/vendors').then(res => res.json()).then(setVendors)
  }, [])

  // Search SKU with debounce
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

  const addItem = () => {
    if (!selectedSku || quantity <= 0 || basePrice <= 0) return
    setItems(prev => [...prev, {
      sku_id: selectedSku.id,
      sku_full_code: selectedSku.full_sku_code,
      description: selectedSku.sku_description,
      quantity,
      base_price: basePrice,
      gst_percentage: gstPercent,
    }])
    setSelectedSku(null)
    setSkuSearch('')
    setQuantity(1)
    setBasePrice(0)
    setGstPercent(18)
  }

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  const calculateTotals = () => {
    let subtotal = 0
    let gstTotal = 0
    items.forEach(item => {
      const line = item.quantity * item.base_price
      const gst = line * item.gst_percentage / 100
      subtotal += line
      gstTotal += gst
    })
    return { subtotal, gstTotal, grandTotal: subtotal + gstTotal }
  }

  const handleSubmit = async () => {
    setSubmitting(true)
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
        base_price: item.base_price,
        gst_percentage: item.gst_percentage,
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
    setSubmitting(false)
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">New Purchase Order</h1>

      {/* Step indicator */}
      <div className="flex mb-6">
        {[1, 2, 3].map(s => (
          <div key={s} className={`flex-1 text-center py-2 ${step === s ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>
            Step {s}: {s === 1 ? 'Header' : s === 2 ? 'Items' : 'Review'}
          </div>
        ))}
      </div>

      {error && <div className="text-red-600 mb-4">{error}</div>}

      {/* Step 1: Header */}
      {step === 1 && (
        <div>
          <div className="mb-4">
            <label className="block">Vendor</label>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="border p-2 w-full rounded">
              <option value="">Select vendor...</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.company_name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block">PO Date</label>
              <input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} className="border p-2 w-full rounded" />
            </div>
            <div>
              <label className="block">Expected Delivery</label>
              <input type="date" value={expectedDelivery} onChange={(e) => setExpectedDelivery(e.target.value)} className="border p-2 w-full rounded" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block">Purchase Type</label>
              <select value={purchaseType} onChange={(e) => setPurchaseType(e.target.value)} className="border p-2 w-full rounded">
                <option value="GST">GST</option>
                <option value="Cash">Cash</option>
              </select>
            </div>
            <div>
              <label className="block">Purchased By</label>
              <select value={purchasedByType} onChange={(e) => setPurchasedByType(e.target.value)} className="border p-2 w-full rounded">
                <option value="Digitalbluez">Digitalbluez</option>
                <option value="Techtenth">Techtenth</option>
                <option value="Cash">Cash</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
          <div className="mb-4">
            <label className="block">Remarks</label>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} className="border p-2 w-full rounded" />
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => setStep(2)}
              disabled={!vendorId || !poDate}
              className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
            >
              Next: Add Items
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Add Items */}
      {step === 2 && (
        <div>
          <h2 className="text-lg font-semibold mb-2">Add Line Items</h2>

          {/* SKU search */}
          <div className="mb-4 relative">
            <label className="block">Search SKU</label>
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
                    {sku.full_sku_code} - {sku.sku_description}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selectedSku && (
            <div className="border p-3 mb-4 rounded">
              <p className="font-medium">{selectedSku.full_sku_code}</p>
              <p className="text-sm text-gray-600">{selectedSku.sku_description}</p>
              <div className="grid grid-cols-3 gap-4 mt-2">
                <div>
                  <label className="block">Quantity</label>
                  <input type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className="border p-1 w-full rounded" min="1" />
                </div>
                <div>
                  <label className="block">Unit Price (₹)</label>
                  <input type="number" value={basePrice} onChange={(e) => setBasePrice(Number(e.target.value))} className="border p-1 w-full rounded" />
                </div>
                <div>
                  <label className="block">GST %</label>
                  <input type="number" value={gstPercent} onChange={(e) => setGstPercent(Number(e.target.value))} className="border p-1 w-full rounded" />
                </div>
              </div>
              <button onClick={addItem} className="mt-2 bg-green-600 text-white px-3 py-1 rounded">Add Item</button>
            </div>
          )}

          {/* Items list */}
          <div className="mb-4">
            {items.length > 0 && (
              <table className="min-w-full border">
                <thead>
                  <tr>
                    <th className="border p-1">SKU</th>
                    <th className="border p-1">Qty</th>
                    <th className="border p-1">Price</th>
                    <th className="border p-1">GST</th>
                    <th className="border p-1">Total</th>
                    <th className="border p-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="border p-1">{item.sku_full_code}</td>
                      <td className="border p-1">{item.quantity}</td>
                      <td className="border p-1">₹{item.base_price}</td>
                      <td className="border p-1">{item.gst_percentage}%</td>
                      <td className="border p-1">₹{(item.quantity * item.base_price).toFixed(2)}</td>
                      <td className="border p-1">
                        <button onClick={() => removeItem(idx)} className="text-red-600">X</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="bg-gray-200 px-4 py-2 rounded">Back</button>
            <button onClick={() => setStep(3)} disabled={items.length === 0} className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50">
              Review Order
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Review and submit */}
      {step === 3 && (
        <div>
          <h2 className="text-lg font-semibold mb-2">Review Order</h2>
          <div className="border p-4 mb-4 rounded">
            <p><strong>Vendor:</strong> {vendors.find(v => v.id === vendorId)?.company_name || 'N/A'}</p>
            <p><strong>Date:</strong> {poDate}</p>
            <p><strong>Expected Delivery:</strong> {expectedDelivery || 'N/A'}</p>
            <p><strong>Type:</strong> {purchaseType} / {purchasedByType}</p>
          </div>

          <h3 className="font-semibold mb-2">Items ({items.length})</h3>
          <table className="min-w-full border mb-4">
            <thead>
              <tr>
                <th className="border p-1">SKU</th>
                <th className="border p-1">Qty</th>
                <th className="border p-1">Unit Price</th>
                <th className="border p-1">GST</th>
                <th className="border p-1">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={idx}>
                  <td className="border p-1">{item.sku_full_code}</td>
                  <td className="border p-1">{item.quantity}</td>
                  <td className="border p-1">₹{item.base_price}</td>
                  <td className="border p-1">{item.gst_percentage}%</td>
                  <td className="border p-1">₹{(item.quantity * item.base_price * (1 + item.gst_percentage/100)).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="text-right font-bold text-lg">
            Grand Total: ₹{calculateTotals().grandTotal.toFixed(2)}
          </div>

          <div className="flex justify-between mt-4">
            <button onClick={() => setStep(2)} className="bg-gray-200 px-4 py-2 rounded">Back</button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create Purchase Order'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import RequirePageAccess from '@/components/RequirePageAccess'
import { SearchableCustomerSelect } from '@/components/SearchableCustomerSelect'
import { useAsyncAction } from '@/lib/useAsyncAction'

interface BusinessProfile {
  key: string
  legal_name: string
  is_gst_registered: boolean
}

interface LineItem {
  description: string
  hsn_code: string
  quantity: number
  rate: number
  gst_rate: number
}

function emptyItem(): LineItem {
  return { description: '', hsn_code: '', quantity: 1, rate: 0, gst_rate: 18 }
}

// Backfills an invoice already issued by Zoho (or another prior system) with its
// real number preserved verbatim -- a direct insert via POST /api/invoices/import
// that never touches the live atomic-numbering counter (invoice_sequences), so it
// can never collide with or skip ahead of the ERP's own forward-going series.
function ImportInvoicePage() {
  const router = useRouter()
  const [entities, setEntities] = useState<BusinessProfile[]>([])
  const [entityKey, setEntityKey] = useState('digitalbluez')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [customerGst, setCustomerGst] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<LineItem[]>([emptyItem()])
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    apiFetch('/api/business-profiles').then(res => res.json()).then((data) => {
      setEntities(Array.isArray(data) ? data : [])
    })
  }, [])

  const selectedEntity = entities.find(e => e.key === entityKey)

  const updateItem = (idx: number, patch: Partial<LineItem>) => {
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  const subtotal = items.reduce((sum, it) => sum + it.quantity * it.rate, 0)
  const totalGst = selectedEntity?.is_gst_registered
    ? items.reduce((sum, it) => sum + (it.quantity * it.rate * it.gst_rate) / 100, 0)
    : 0
  const grandTotal = subtotal + totalGst

  const { run: handleSubmit, pending: submitting } = useAsyncAction(async () => {
    setError('')
    if (!invoiceNumber.trim()) { setError('Invoice number is required.'); return }
    if (!invoiceDate) { setError('Invoice date is required.'); return }
    if (!customerName.trim()) { setError('Customer name is required.'); return }
    if (items.some(it => !it.description.trim())) { setError('Every line item needs a description.'); return }

    const res = await apiFetch('/api/invoices/import', {
      method: 'POST',
      body: JSON.stringify({
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        entity_key: entityKey,
        customer_id: customerId,
        customer_name: customerName,
        customer_gst: customerGst || null,
        customer_address: customerAddress || null,
        customer_phone: customerPhone || null,
        customer_email: customerEmail || null,
        notes: notes || null,
        items,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      setError(err.error || 'Failed to import invoice.')
      return
    }
    const data = await res.json()
    setDone(`Invoice ${data.invoice_number} imported.`)
  })

  if (done) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <div className="bg-green-50 border border-green-200 text-green-800 rounded p-4 mb-4">{done}</div>
        <div className="flex gap-2">
          <Button onClick={() => router.push('/dashboard/invoices')}>Back to Invoices</Button>
          <Button variant="outline" onClick={() => window.location.reload()}>Import Another</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <button onClick={() => router.push('/dashboard/invoices')} className="text-sm text-gray-500 mb-2">&larr; Back</button>
      <h1 className="text-2xl font-bold mb-1">Import Historical Invoice</h1>
      <p className="text-sm text-gray-500 mb-4">
        Record an invoice already issued by Zoho (or another prior system) with its real number preserved exactly.
        This does not mint a new number -- it will never collide with or affect this system's own invoice series.
      </p>
      {error && <div className="text-red-600 mb-4">{error}</div>}

      <div className="space-y-4 bg-white p-4 rounded shadow">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label>Entity *</Label>
            <select value={entityKey} onChange={(e) => setEntityKey(e.target.value)} className="border p-2 w-full rounded mt-1">
              {entities.map(e => <option key={e.key} value={e.key}>{e.legal_name || e.key}</option>)}
            </select>
          </div>
          <div>
            <Label>Invoice Number *</Label>
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="e.g. DBI2026/27-00650" className="mt-1" />
          </div>
          <div>
            <Label>Invoice Date *</Label>
            <Input type="date" value={invoiceDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setInvoiceDate(e.target.value)} className="mt-1" />
          </div>
        </div>

        <div>
          <Label>Customer</Label>
          <div className="mt-1">
            <SearchableCustomerSelect
              value={customerId}
              onChange={setCustomerId}
              onCustomerData={(c) => {
                if (!c) return
                setCustomerName(c.customer_name)
                setCustomerGst(c.gst_number || '')
                setCustomerAddress(c.address || '')
                setCustomerPhone(c.phone || '')
                setCustomerEmail(c.email || '')
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Customer Name *</Label>
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Customer GSTIN</Label>
            <Input value={customerGst} onChange={(e) => setCustomerGst(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Email</Label>
            <Input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} className="mt-1" />
          </div>
          <div className="col-span-2">
            <Label>Address</Label>
            <Input value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} className="mt-1" />
          </div>
        </div>

        <div>
          <Label>Line Items</Label>
          <div className="border rounded mt-1">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="p-2 text-left">Description</th>
                  <th className="p-2 text-left w-24">HSN</th>
                  <th className="p-2 text-left w-20">Qty</th>
                  <th className="p-2 text-left w-24">Rate</th>
                  {selectedEntity?.is_gst_registered && <th className="p-2 text-left w-20">GST %</th>}
                  <th className="p-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="p-1"><Input value={item.description} onChange={(e) => updateItem(idx, { description: e.target.value })} /></td>
                    <td className="p-1"><Input value={item.hsn_code} onChange={(e) => updateItem(idx, { hsn_code: e.target.value })} /></td>
                    <td className="p-1"><Input type="number" value={item.quantity} onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })} /></td>
                    <td className="p-1"><Input type="number" value={item.rate} onChange={(e) => updateItem(idx, { rate: Number(e.target.value) })} /></td>
                    {selectedEntity?.is_gst_registered && (
                      <td className="p-1"><Input type="number" value={item.gst_rate} onChange={(e) => updateItem(idx, { gst_rate: Number(e.target.value) })} /></td>
                    )}
                    <td className="p-1 text-center">
                      {items.length > 1 && (
                        <button onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))} className="text-red-500">✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={() => setItems(prev => [...prev, emptyItem()])} className="text-blue-600 underline text-sm mt-2">
            + Add line
          </button>
        </div>

        <div className="text-right text-sm space-y-1">
          <div>Subtotal: ₹{subtotal.toFixed(2)}</div>
          {selectedEntity?.is_gst_registered && <div>GST: ₹{totalGst.toFixed(2)}</div>}
          <div className="font-bold text-lg">Grand Total: ₹{grandTotal.toFixed(2)}</div>
        </div>

        <div>
          <Label>Notes</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
        </div>

        <div className="flex justify-end">
          <Button onClick={() => handleSubmit()} disabled={submitting} className="inline-flex items-center gap-1.5">
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {submitting ? 'Importing...' : 'Import Invoice'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function ImportInvoicePageGuarded() {
  return (
    <RequirePageAccess pageKey="invoices">
      <ImportInvoicePage />
    </RequirePageAccess>
  )
}

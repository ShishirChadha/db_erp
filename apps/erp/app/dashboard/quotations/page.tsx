'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import RequirePageAccess from '@/components/RequirePageAccess'
import { SearchableCustomerSelect } from '@/components/SearchableCustomerSelect'
import AddCustomerDialog from '@/components/AddCustomerDialog'
import { useAsyncAction } from '@/lib/useAsyncAction'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Pagination } from '@/components/Pagination'
import { StatusBadge } from '@/components/StatusBadge'
import { SALES_DOCUMENT_STATUS_TONES, toneFor } from '@/lib/status-styles'

const PAGE_SIZE = 25

type DocType = 'quotation' | 'proforma'

interface DocSummary {
  id: string
  doc_type: DocType
  document_number: string
  document_date: string
  valid_until: string | null
  entity_key: string
  customer_name: string | null
  grand_total: number
  status: string
  sales_document_items: { id: string; converted: boolean }[]
}

interface LineItem {
  item_type: 'sku' | 'accessory' | 'custom'
  sku_id?: string
  accessory_id?: string
  description: string
  hsn_code?: string
  quantity: number
  rate: number
  gst_rate: number
}

const ENTITY_LABELS: Record<string, string> = { digitalbluez: 'Digitalbluez', techtenth: 'Techtenth', cash: 'Cash' }

function today() {
  return new Date().toISOString().slice(0, 10)
}

// ---------- Create dialog ----------
function CreateDocumentDialog({ docType, onCreated }: { docType: DocType; onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [entityKey, setEntityKey] = useState('digitalbluez')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [validUntil, setValidUntil] = useState('')
  const [notes, setNotes] = useState('')
  const [terms, setTerms] = useState('')
  const [items, setItems] = useState<LineItem[]>([])
  const [skuSearch, setSkuSearch] = useState('')
  const [skuResults, setSkuResults] = useState<any[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!skuSearch.trim()) { setSkuResults([]); return }
    const timer = setTimeout(async () => {
      const res = await apiFetch(`/api/sku-master?search=${encodeURIComponent(skuSearch)}`)
      const data = await res.json()
      setSkuResults(Array.isArray(data) ? data.slice(0, 15) : [])
    }, 300)
    return () => clearTimeout(timer)
  }, [skuSearch])

  const addSkuLine = (sku: any) => {
    setItems((prev) => [...prev, {
      item_type: 'sku',
      sku_id: sku.id,
      description: sku.sku_description || sku.full_sku_code,
      hsn_code: sku.hsn_code || '',
      quantity: 1,
      rate: sku.selling_price_default || 0,
      gst_rate: 18,
    }])
    setSkuSearch(''); setSkuResults([])
  }

  const addCustomLine = () => {
    setItems((prev) => [...prev, { item_type: 'custom', description: '', quantity: 1, rate: 0, gst_rate: 18 }])
  }

  const updateItem = (idx: number, field: keyof LineItem, value: any) => {
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it))
  }

  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx))

  const subtotal = items.reduce((sum, it) => sum + it.quantity * it.rate, 0)
  const estGst = items.reduce((sum, it) => sum + (it.quantity * it.rate * it.gst_rate) / 100, 0)

  const reset = () => {
    setEntityKey('digitalbluez'); setCustomerId(null); setValidUntil(''); setNotes(''); setTerms(''); setItems([])
    setSkuSearch(''); setSkuResults([]); setError('')
  }

  const { run: handleSave, pending: saving } = useAsyncAction(async () => {
    setError('')
    if (!customerId) { setError('Select a customer.'); return }
    if (items.length === 0) { setError('Add at least one line item.'); return }
    if (items.some((it) => !it.description.trim())) { setError('Every line needs a description.'); return }

    const res = await apiFetch('/api/sales-documents', {
      method: 'POST',
      body: JSON.stringify({
        doc_type: docType,
        entity_key: entityKey,
        customer_id: customerId,
        valid_until: docType === 'quotation' && validUntil ? validUntil : undefined,
        notes: notes || undefined,
        terms_conditions: terms || undefined,
        items,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(data.error || 'Failed to create.'); return }
    setOpen(false)
    reset()
    onCreated()
  })

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset() }}>
      <Button onClick={() => setOpen(true)}>New {docType === 'quotation' ? 'Quotation' : 'Proforma Invoice'}</Button>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New {docType === 'quotation' ? 'Quotation' : 'Proforma Invoice'}</DialogTitle></DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Entity</label>
              <select value={entityKey} onChange={(e) => setEntityKey(e.target.value)} className="border p-2 w-full rounded">
                {Object.entries(ENTITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            {docType === 'quotation' && (
              <div>
                <label className="block text-sm font-medium mb-1">Valid Until</label>
                <input type="date" min={today()} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="border p-2 w-full rounded" />
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Customer</label>
            <div className="flex gap-2 items-start">
              <div className="flex-1">
                <SearchableCustomerSelect value={customerId} onChange={setCustomerId} onCustomerData={() => {}} />
              </div>
              <AddCustomerDialog onAdd={(created) => created && setCustomerId(created.id)} />
            </div>
          </div>

          <div className="border rounded p-3 space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium">Line Items</label>
              <button type="button" onClick={addCustomLine} className="text-xs text-blue-600 underline">+ Custom line</button>
            </div>
            <div className="relative">
              <input
                value={skuSearch}
                onChange={(e) => setSkuSearch(e.target.value)}
                placeholder="Search SKU by model/code to add a line..."
                className="border p-2 w-full rounded text-sm"
              />
              {skuResults.length > 0 && (
                <ul className="border rounded mt-1 max-h-40 overflow-y-auto absolute bg-white w-full z-10 shadow">
                  {skuResults.map((sku) => (
                    <li key={sku.id} onClick={() => addSkuLine(sku)} className="p-2 hover:bg-gray-100 cursor-pointer border-b last:border-b-0 text-sm">
                      <div className="font-medium">{sku.full_sku_code}</div>
                      <div className="text-xs text-gray-500">{sku.sku_description} — {sku.quantity_in_stock} in stock</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {items.length > 0 && (
              <table className="w-full text-xs mt-2">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="pb-1">Description</th>
                    <th className="pb-1 w-16">Qty</th>
                    <th className="pb-1 w-24">Rate</th>
                    <th className="pb-1 w-16">GST%</th>
                    <th className="pb-1 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="py-1 pr-2">
                        <input value={it.description} onChange={(e) => updateItem(idx, 'description', e.target.value)} className="border p-1 w-full rounded" placeholder="Description" />
                      </td>
                      <td className="py-1 pr-2"><input type="number" value={it.quantity} onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))} className="border p-1 w-full rounded" /></td>
                      <td className="py-1 pr-2"><input type="number" value={it.rate} onChange={(e) => updateItem(idx, 'rate', Number(e.target.value))} className="border p-1 w-full rounded" /></td>
                      <td className="py-1 pr-2"><input type="number" value={it.gst_rate} onChange={(e) => updateItem(idx, 'gst_rate', Number(e.target.value))} className="border p-1 w-full rounded" /></td>
                      <td className="py-1"><button onClick={() => removeItem(idx)} className="text-red-500">✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="text-right text-sm pt-2 border-t">
              <p>Subtotal: ₹{subtotal.toFixed(2)}</p>
              <p>Est. GST: ₹{estGst.toFixed(2)}</p>
              <p className="font-bold">Total: ₹{(subtotal + estGst).toFixed(2)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="border p-2 w-full rounded text-sm" rows={2} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Terms & Conditions</label>
              <textarea value={terms} onChange={(e) => setTerms(e.target.value)} className="border p-2 w-full rounded text-sm" rows={2} />
            </div>
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => handleSave()} loading={saving}>Create</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Detail / convert dialog ----------
function ViewDocumentDialog({ docId, onClose, onChanged }: { docId: string; onClose: () => void; onChanged: () => void }) {
  const [doc, setDoc] = useState<any>(null)

  const fetchDoc = useCallback(async () => {
    const res = await apiFetch(`/api/sales-documents/${docId}`)
    if (res.ok) setDoc(await res.json())
  }, [docId])

  useEffect(() => { fetchDoc() }, [fetchDoc])

  const { run: changeStatus, pending: changingStatus } = useAsyncAction(async (status: string) => {
    await apiFetch(`/api/sales-documents/${docId}`, { method: 'PATCH', body: JSON.stringify({ status }) })
    await fetchDoc()
    onChanged()
  })

  const { run: downloadPdf, pending: downloading } = useAsyncAction(async () => {
    const res = await apiFetch(`/api/sales-documents/${docId}/pdf`)
    if (!res.ok) return
    const blob = await res.blob()
    window.open(URL.createObjectURL(blob), '_blank')
  })

  const { run: emailDoc, pending: emailing } = useAsyncAction(async () => {
    const to = window.prompt('Send to which email address?', doc.customer_email || '')
    if (!to) return
    const res = await apiFetch(`/api/sales-documents/${docId}/email`, { method: 'POST', body: JSON.stringify({ to }) })
    const data = await res.json().catch(() => ({}))
    alert(res.ok ? `Sent to ${data.sent_to}.` : (data.error || 'Failed to send email.'))
  })

  const busy = changingStatus || downloading || emailing

  const convertLine = (item: any) => {
    const params = new URLSearchParams({
      customer_id: doc.customer_id,
      source_document_item_id: item.id,
      prefill_rate: String(item.rate),
      prefill_gst_rate: String(item.gst_rate || 0),
    })
    if (item.sku_id && item.description) params.set('sku_search', item.description.split(' ')[0])
    window.open(`/dashboard/entry/sell?${params.toString()}`, '_blank')
  }

  if (!doc) return null

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{doc.document_number} — {doc.customer_name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center text-sm">
            <StatusBadge tone={toneFor(SALES_DOCUMENT_STATUS_TONES, doc.status)}>{doc.status}</StatusBadge>
            {doc.status === 'draft' && <button onClick={() => changeStatus('sent')} disabled={busy} className="text-blue-600 underline text-xs inline-flex items-center gap-1">{changingStatus && <Loader2 className="size-3 animate-spin" />}Mark Sent</button>}
            {['draft', 'sent'].includes(doc.status) && <button onClick={() => changeStatus('accepted')} disabled={busy} className="text-green-600 underline text-xs inline-flex items-center gap-1">{changingStatus && <Loader2 className="size-3 animate-spin" />}Mark Accepted</button>}
            {['draft', 'sent'].includes(doc.status) && <button onClick={() => changeStatus('rejected')} disabled={busy} className="text-red-600 underline text-xs inline-flex items-center gap-1">{changingStatus && <Loader2 className="size-3 animate-spin" />}Mark Rejected</button>}
            {doc.status !== 'void' && <button onClick={() => changeStatus('void')} disabled={busy} className="text-gray-500 underline text-xs inline-flex items-center gap-1">{changingStatus && <Loader2 className="size-3 animate-spin" />}Void</button>}
            <button onClick={() => downloadPdf()} disabled={busy} className="text-gray-700 underline text-xs ml-auto inline-flex items-center gap-1">{downloading && <Loader2 className="size-3 animate-spin" />}Download PDF</button>
            <button onClick={() => emailDoc()} disabled={busy} className="text-gray-700 underline text-xs inline-flex items-center gap-1">{emailing && <Loader2 className="size-3 animate-spin" />}Email</button>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="py-1">Description</th>
                <th className="py-1">Qty</th>
                <th className="py-1">Rate</th>
                <th className="py-1">Amount</th>
                <th className="py-1"></th>
              </tr>
            </thead>
            <tbody>
              {doc.items.map((item: any) => (
                <tr key={item.id} className="border-b">
                  <td className="py-1.5">{item.description}</td>
                  <td className="py-1.5">{item.quantity}</td>
                  <td className="py-1.5">₹{Number(item.rate).toFixed(2)}</td>
                  <td className="py-1.5">₹{Number(item.amount).toFixed(2)}</td>
                  <td className="py-1.5">
                    {item.converted ? (
                      <span className="text-green-600 text-xs">✓ Converted</span>
                    ) : (
                      <button onClick={() => convertLine(item)} className="text-amber-700 underline text-xs">Convert →</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="text-right text-sm">
            <p>Subtotal: ₹{Number(doc.subtotal).toFixed(2)}</p>
            <p>Est. GST: ₹{Number(doc.total_gst).toFixed(2)}</p>
            <p className="font-bold">Total: ₹{Number(doc.grand_total).toFixed(2)}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Main page ----------
function QuotationsPage() {
  const [docType, setDocType] = useState<DocType>('quotation')
  const [docs, setDocs] = useState<DocSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const fetchDocs = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch(`/api/sales-documents?doc_type=${docType}&page=${page}&limit=${PAGE_SIZE}`)
    if (res.ok) {
      const json = await res.json()
      setDocs(json.data || [])
      setTotal(json.total || 0)
    } else {
      setDocs([])
    }
    setLoading(false)
  }, [docType, page])

  useEffect(() => { fetchDocs() }, [fetchDocs])

  // Switching between Quotations/Proforma tabs invalidates the current page's meaning.
  useEffect(() => { setPage(1) }, [docType])

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Quotations & Proforma Invoices</h1>
      <p className="text-sm text-gray-500 mb-4">
        Non-committal price offers and pre-sale documents. Converting a line hands off to the normal Sell flow — a real sale and (later) a real GST invoice are always created there, never here.
      </p>

      <div className="flex justify-between items-center mb-4">
        <div className="flex border rounded overflow-hidden w-fit">
          <button onClick={() => setDocType('quotation')} className={`px-4 py-2 text-sm font-medium ${docType === 'quotation' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>Quotations</button>
          <button onClick={() => setDocType('proforma')} className={`px-4 py-2 text-sm font-medium ${docType === 'proforma' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>Proforma Invoices</button>
        </div>
        <CreateDocumentDialog docType={docType} onCreated={fetchDocs} />
      </div>

      {loading ? <div>Loading...</div> : (
        <div className="overflow-x-auto">
          <table className="min-w-full border text-sm">
            <thead>
              <tr>
                <th className="border p-2 w-10 text-right">#</th>
                <th className="border p-2">Date</th>
                <th className="border p-2">Number</th>
                <th className="border p-2">Customer</th>
                <th className="border p-2">Entity</th>
                <th className="border p-2 text-right">Total</th>
                <th className="border p-2">Status</th>
                <th className="border p-2 text-center">Conversion</th>
                <th className="border p-2"></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d, idx) => {
                const total = d.sales_document_items.length
                const converted = d.sales_document_items.filter((i) => i.converted).length
                return (
                  <tr key={d.id}>
                    <td className="border p-2 text-right tabular-nums text-gray-400">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                    <td className="border p-2">{d.document_date}</td>
                    <td className="border p-2 font-mono text-xs">{d.document_number}</td>
                    <td className="border p-2">{d.customer_name}</td>
                    <td className="border p-2">{ENTITY_LABELS[d.entity_key]}</td>
                    <td className="border p-2 text-right tabular-nums">₹{Number(d.grand_total).toFixed(2)}</td>
                    <td className="border p-2"><StatusBadge tone={toneFor(SALES_DOCUMENT_STATUS_TONES, d.status)}>{d.status}</StatusBadge></td>
                    <td className="border p-2 text-center tabular-nums">{converted}/{total}</td>
                    <td className="border p-2"><button onClick={() => setViewingId(d.id)} className="text-blue-600 underline text-xs">View</button></td>
                  </tr>
                )
              })}
              {docs.length === 0 && (
                <tr><td colSpan={9} className="border p-4 text-center text-gray-400">No {docType}s yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />

      {viewingId && (
        <ViewDocumentDialog docId={viewingId} onClose={() => setViewingId(null)} onChanged={fetchDocs} />
      )}
    </div>
  )
}

export default function QuotationsPageGuarded() {
  return (
    <RequirePageAccess pageKey="quotations">
      <QuotationsPage />
    </RequirePageAccess>
  )
}

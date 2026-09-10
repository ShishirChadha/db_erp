'use client'

import { useState, useEffect } from 'react'
import { apiFetch } from '@/lib/api-client'
import { SearchableCustomerSelect } from '@/components/SearchableCustomerSelect'
import AddCustomerDialog from '@/components/AddCustomerDialog'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export type SalesDocType = 'quotation' | 'proforma'

export interface SalesDocLineItem {
  item_type: 'sku' | 'accessory' | 'custom'
  sku_id?: string
  accessory_id?: string
  description: string
  hsn_code?: string
  quantity: number
  rate: number
  gst_rate: number
}

export const ENTITY_LABELS: Record<string, string> = { digitalbluez: 'Digitalbluez', techtenth: 'Techtenth', cash: 'Cash' }

// ---------- Shared entry-form fields (Entity/Valid Until/Customer/Line Items/Notes/Terms) ----------
// Used identically by "New", "Edit", and anywhere else a quotation/proforma is entered so
// editing looks and behaves like the same entry form the document was originally created
// with, not a stripped-down variant.
export function DocumentFormFields({
  docType, entityKey, setEntityKey, customerId, setCustomerId, validUntil, setValidUntil,
  notes, setNotes, terms, setTerms, items, setItems,
}: {
  docType: SalesDocType
  entityKey: string; setEntityKey: (v: string) => void
  customerId: string | null; setCustomerId: (v: string | null) => void
  validUntil: string; setValidUntil: (v: string) => void
  notes: string; setNotes: (v: string) => void
  terms: string; setTerms: (v: string) => void
  items: SalesDocLineItem[]; setItems: React.Dispatch<React.SetStateAction<SalesDocLineItem[]>>
}) {
  const [skuSearch, setSkuSearch] = useState('')
  const [skuResults, setSkuResults] = useState<any[]>([])

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
  const addCustomLine = () => setItems((prev) => [...prev, { item_type: 'custom', description: '', quantity: 1, rate: 0, gst_rate: 18 }])
  const updateItem = (idx: number, field: keyof SalesDocLineItem, value: any) => setItems((prev) => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it))
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx))

  const subtotal = items.reduce((sum, it) => sum + it.quantity * it.rate, 0)
  const estGst = items.reduce((sum, it) => sum + (it.quantity * it.rate * it.gst_rate) / 100, 0)

  return (
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
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="border p-2 w-full rounded" />
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
          <button type="button" onClick={addCustomLine} className="text-xs text-primary underline">+ Custom line</button>
        </div>
        <div className="relative">
          <input
            value={skuSearch}
            onChange={(e) => setSkuSearch(e.target.value)}
            placeholder="Search SKU by model/code to add a line..."
            className="border p-2 w-full rounded text-sm"
          />
          {skuResults.length > 0 && (
            <ul className="border rounded mt-1 max-h-40 overflow-y-auto absolute bg-card w-full z-10 shadow">
              {skuResults.map((sku) => (
                <li key={sku.id} onClick={() => addSkuLine(sku)} className="p-2 hover:bg-muted cursor-pointer border-b last:border-b-0 text-sm">
                  <div className="font-medium">{sku.full_sku_code}</div>
                  <div className="text-xs text-muted-foreground">{sku.sku_description} — {sku.quantity_in_stock} in stock</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <table className="w-full text-xs mt-2">
            <thead>
              <tr className="text-left text-muted-foreground">
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
                  <td className="py-1"><button onClick={() => removeItem(idx)} className="text-destructive">✕</button></td>
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
    </div>
  )
}

// ---------- Edit dialog: the same entry form, prefilled, saved via PATCH ----------
// Only reachable while the document is still draft/sent with nothing converted yet --
// the PATCH route enforces this itself; the caller just doesn't offer the button otherwise.
export function EditSalesDocumentDialog({ doc, onClose, onSaved }: { doc: any; onClose: () => void; onSaved: () => void }) {
  const [entityKey, setEntityKey] = useState(doc.entity_key)
  const [customerId, setCustomerId] = useState<string | null>(doc.customer_id)
  const [validUntil, setValidUntil] = useState(doc.valid_until || '')
  const [notes, setNotes] = useState(doc.notes || '')
  const [terms, setTerms] = useState(doc.terms_conditions || '')
  const [items, setItems] = useState<SalesDocLineItem[]>(doc.items.map((i: any) => ({
    item_type: i.item_type,
    sku_id: i.sku_id || undefined,
    accessory_id: i.accessory_id || undefined,
    description: i.description,
    hsn_code: i.hsn_code || undefined,
    quantity: Number(i.quantity),
    rate: Number(i.rate),
    gst_rate: Number(i.gst_rate) || 0,
  })))
  const [error, setError] = useState('')

  const { run: handleSave, pending: saving } = useAsyncAction(async () => {
    setError('')
    if (!customerId) { setError('Select a customer.'); return }
    if (items.length === 0) { setError('Add at least one line item.'); return }
    if (items.some((it) => !it.description.trim())) { setError('Every line needs a description.'); return }

    const res = await apiFetch(`/api/sales-documents/${doc.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        entity_key: entityKey,
        customer_id: customerId,
        valid_until: doc.doc_type === 'quotation' ? (validUntil || null) : undefined,
        notes: notes || null,
        terms_conditions: terms || null,
        items,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(data.error || 'Failed to save changes.'); return }
    onSaved()
  })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit {doc.document_number}</DialogTitle></DialogHeader>

        <DocumentFormFields
          docType={doc.doc_type}
          entityKey={entityKey} setEntityKey={setEntityKey}
          customerId={customerId} setCustomerId={setCustomerId}
          validUntil={validUntil} setValidUntil={setValidUntil}
          notes={notes} setNotes={setNotes}
          terms={terms} setTerms={setTerms}
          items={items} setItems={setItems}
        />

        {error && <p className="text-destructive text-sm mt-2">{error}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => handleSave()} loading={saving}>Save Changes</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

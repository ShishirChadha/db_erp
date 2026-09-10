'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'
import RequirePageAccess from '@/components/RequirePageAccess'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Pagination } from '@/components/Pagination'
import { StatusBadge } from '@/components/StatusBadge'
import { SALES_DOCUMENT_STATUS_TONES, toneFor } from '@/lib/status-styles'
import { DocumentFormFields, ENTITY_LABELS, SalesDocType, SalesDocLineItem } from '@/components/SalesDocumentForm'

const PAGE_SIZE = 25

interface DocSummary {
  id: string
  doc_type: SalesDocType
  document_number: string
  document_date: string
  valid_until: string | null
  entity_key: string
  customer_name: string | null
  grand_total: number
  status: string
  sales_document_items: { id: string; converted: boolean }[]
}

// ---------- Create dialog ----------
function CreateDocumentDialog({ docType, onCreated }: { docType: SalesDocType; onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [entityKey, setEntityKey] = useState('digitalbluez')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [validUntil, setValidUntil] = useState('')
  const [notes, setNotes] = useState('')
  const [terms, setTerms] = useState('')
  const [items, setItems] = useState<SalesDocLineItem[]>([])
  const [error, setError] = useState('')

  const reset = () => {
    setEntityKey('digitalbluez'); setCustomerId(null); setValidUntil(''); setNotes(''); setTerms(''); setItems([])
    setError('')
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

        <DocumentFormFields
          docType={docType}
          entityKey={entityKey} setEntityKey={setEntityKey}
          customerId={customerId} setCustomerId={setCustomerId}
          validUntil={validUntil} setValidUntil={setValidUntil}
          notes={notes} setNotes={setNotes}
          terms={terms} setTerms={setTerms}
          items={items} setItems={setItems}
        />

        {error && <p className="text-destructive text-sm mt-2">{error}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => handleSave()} loading={saving}>Create</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Main page ----------
function QuotationsPage() {
  const router = useRouter()
  const [docType, setDocType] = useState<SalesDocType>('quotation')
  const [docs, setDocs] = useState<DocSummary[]>([])
  const [loading, setLoading] = useState(true)
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
      <p className="text-sm text-muted-foreground mb-4">
        Non-committal price offers and pre-sale documents. Converting a line hands off to the normal Sell flow — a real sale and (later) a real GST invoice are always created there, never here.
      </p>

      <div className="flex justify-between items-center mb-4">
        <div className="flex border rounded overflow-hidden w-fit">
          <button onClick={() => setDocType('quotation')} className={`px-4 py-2 text-sm font-medium ${docType === 'quotation' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'}`}>Quotations</button>
          <button onClick={() => setDocType('proforma')} className={`px-4 py-2 text-sm font-medium ${docType === 'proforma' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'}`}>Proforma Invoices</button>
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
              </tr>
            </thead>
            <tbody>
              {docs.map((d, idx) => {
                const total = d.sales_document_items.length
                const converted = d.sales_document_items.filter((i) => i.converted).length
                return (
                  <tr key={d.id} onClick={() => router.push(`/dashboard/quotations/${d.id}`)} className="cursor-pointer hover:bg-muted">
                    <td className="border p-2 text-right tabular-nums text-muted-foreground">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                    <td className="border p-2">{d.document_date}</td>
                    <td className="border p-2 font-mono text-xs">{d.document_number}</td>
                    <td className="border p-2">{d.customer_name}</td>
                    <td className="border p-2">{ENTITY_LABELS[d.entity_key]}</td>
                    <td className="border p-2 text-right tabular-nums">₹{Number(d.grand_total).toFixed(2)}</td>
                    <td className="border p-2"><StatusBadge tone={toneFor(SALES_DOCUMENT_STATUS_TONES, d.status)}>{d.status}</StatusBadge></td>
                    <td className="border p-2 text-center tabular-nums">{converted}/{total}</td>
                  </tr>
                )
              })}
              {docs.length === 0 && (
                <tr><td colSpan={8} className="border p-4 text-center text-muted-foreground">No {docType}s yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
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

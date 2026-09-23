'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useIsDesktopViewport } from '@/lib/useIsDesktopViewport'
import RequirePageAccess from '@/components/RequirePageAccess'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Pagination } from '@/components/Pagination'
import { StatusBadge } from '@/components/StatusBadge'
import { SALES_DOCUMENT_STATUS_TONES, toneFor } from '@/lib/status-styles'
import { DocumentFormFields, ENTITY_LABELS, SalesDocType, SalesDocLineItem } from '@/components/SalesDocumentForm'
import { cn } from '@/lib/utils'

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

// One field in the detail pane's label/value grid -- matches Sales Ledger's Field
// helper so this pane reads consistently with the reference master-detail page.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5 border-b border-border grid grid-cols-3 gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2">{children}</span>
    </div>
  )
}

// Right-pane detail view -- a summary of the document (customer, entity, dates,
// total, conversion progress) with a link through to the full record page for
// everything interactive (status transitions, PDF, email, edit, line items) --
// that page already owns those actions and isn't worth duplicating here.
function DocDetailPane({ doc, docType, onBack }: { doc: DocSummary; docType: SalesDocType; onBack: () => void }) {
  const totalItems = doc.sales_document_items.length
  const convertedItems = doc.sales_document_items.filter((i) => i.converted).length

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
        <div className="min-w-0">
          <button type="button" onClick={onBack} className="md:hidden mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowLeft className="size-4" /> Back to list
          </button>
          <h2 className="text-lg font-semibold text-foreground truncate">{doc.customer_name || '—'}</h2>
          <p className="text-sm text-muted-foreground mt-0.5 font-mono">{doc.document_number}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span className="text-xl font-semibold tabular-nums text-foreground">₹{Number(doc.grand_total).toFixed(2)}</span>
          <StatusBadge tone={toneFor(SALES_DOCUMENT_STATUS_TONES, doc.status)}>{doc.status}</StatusBadge>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <Field label="Date">{doc.document_date}</Field>
        {docType === 'quotation' && <Field label="Valid Until">{doc.valid_until || '—'}</Field>}
        <Field label="Entity">{ENTITY_LABELS[doc.entity_key]}</Field>
        <Field label="Conversion">{convertedItems}/{totalItems} line{totalItems === 1 ? '' : 's'} converted to a sale</Field>
        <div className="pt-4">
          <Link href={`/dashboard/quotations/${doc.id}`} className="text-primary underline text-sm">
            Open full document →
          </Link>
        </div>
      </div>
    </div>
  )
}

// Left-pane list block -- customer, doc number, date, and status, matching the
// Sales Ledger list row's shape (primary identity + amount up top, date + status below).
function DocListItem({ doc, active, onOpen }: { doc: DocSummary; active: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'w-full text-left px-3 py-2.5 border-b border-border flex flex-col gap-0.5 transition-colors',
        active ? 'bg-primary/10' : 'hover:bg-muted'
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-sm text-foreground truncate">{doc.customer_name || '—'}</span>
        <span className="text-sm font-medium tabular-nums whitespace-nowrap text-foreground">₹{Number(doc.grand_total).toFixed(2)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-muted-foreground font-mono truncate">{doc.document_number}</p>
        <span className="text-xs text-muted-foreground whitespace-nowrap">{doc.document_date}</span>
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        <StatusBadge tone={toneFor(SALES_DOCUMENT_STATUS_TONES, doc.status)}>{doc.status}</StatusBadge>
      </div>
    </button>
  )
}

// ---------- Main page ----------
function QuotationsPage() {
  const [docType, setDocType] = useState<SalesDocType>('quotation')
  const [docs, setDocs] = useState<DocSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [activeDocId, setActiveDocId] = useState<string | null>(null)
  const isDesktop = useIsDesktopViewport()

  const fetchDocs = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch(`/api/sales-documents?doc_type=${docType}&page=${page}&limit=${PAGE_SIZE}`)
    if (res.ok) {
      const json = await res.json()
      const data: DocSummary[] = json.data || []
      setDocs(data)
      setTotal(json.total || 0)
      // Auto-select the first row, but don't yank focus away from whatever's
      // already open if it's still present in the refetched page.
      setActiveDocId((prev) => (prev && data.some((d) => d.id === prev)) ? prev : (isDesktop ? (data[0]?.id ?? null) : null))
    } else {
      setDocs([])
      setActiveDocId(null)
    }
    setLoading(false)
  }, [docType, page])

  useEffect(() => { fetchDocs() }, [fetchDocs])

  // Switching between Quotations/Proforma tabs invalidates the current page's meaning.
  useEffect(() => { setPage(1) }, [docType])

  const activeDoc = useMemo(() => docs.find((d) => d.id === activeDocId) ?? null, [docs, activeDocId])

  return (
    <div className="p-4 flex flex-col h-full">
      <h1 className="text-2xl font-bold mb-1">Quotations & Proforma Invoices</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Non-committal price offers and pre-sale documents. Converting a line hands off to the normal Sell flow — a real sale and (later) a real GST invoice are always created there, never here.
      </p>

      <div className="flex justify-between items-center mb-2">
        <div className="flex border rounded overflow-hidden w-fit">
          <button onClick={() => setDocType('quotation')} className={`px-4 py-2 text-sm font-medium ${docType === 'quotation' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'}`}>Quotations</button>
          <button onClick={() => setDocType('proforma')} className={`px-4 py-2 text-sm font-medium ${docType === 'proforma' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'}`}>Proforma Invoices</button>
        </div>
        <CreateDocumentDialog docType={docType} onCreated={fetchDocs} />
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : (
        <div className="flex-1 min-h-[320px] border rounded overflow-hidden flex">
          {/* List pane -- hidden on mobile once a document is open, matching Sales Ledger. */}
          <div className={cn('w-full md:w-[300px] lg:w-[360px] md:flex-shrink-0 border-r border-border flex flex-col', activeDoc && 'hidden md:flex')}>
            <div className="flex-1 overflow-y-auto">
              {docs.map((d) => (
                <DocListItem
                  key={d.id}
                  doc={d}
                  active={d.id === activeDocId}
                  onOpen={() => setActiveDocId(d.id)}
                />
              ))}
              {docs.length === 0 && (
                <p className="p-4 text-center text-sm text-muted-foreground">No {docType}s yet.</p>
              )}
            </div>
            <div className="border-t border-border p-2">
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
            </div>
          </div>

          {/* Detail pane -- full width on mobile (replaces the list), flex-1 at md+. */}
          <div className={cn('flex-1 min-w-0', !activeDoc && 'hidden md:flex md:items-center md:justify-center')}>
            {activeDoc ? (
              <DocDetailPane doc={activeDoc} docType={docType} onBack={() => setActiveDocId(null)} />
            ) : (
              <p className="text-sm text-muted-foreground">Select a document to view details.</p>
            )}
          </div>
        </div>
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

'use client'

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react'
import { ArrowLeft } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useIsDesktopViewport } from '@/lib/useIsDesktopViewport'
import { useResizablePaneWidth } from '@/lib/useResizablePaneWidth'
import { useUrlState } from '@/lib/useUrlState'
import { useListPageSize } from '@/lib/useListPageSize'
import RequirePageAccess from '@/components/RequirePageAccess'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Pagination } from '@/components/Pagination'
import { StatusBadge } from '@/components/StatusBadge'
import { SALES_DOCUMENT_STATUS_TONES, toneFor } from '@/lib/status-styles'
import { SalesDocumentEditorDialog, SalesDocType, DOC_LABELS } from '@/components/SalesDocumentForm'
import { ViewSalesDocumentPage } from './[id]/page'
import { cn } from '@/lib/utils'

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

// Right-pane detail view -- the full document (customer, line items with
// per-line convert-to-sale, totals, notes/terms, and its own Edit/Mark Sent/
// Accept/Reject/Void/Preview/Download/Email/Print toolbar) embedded inline via
// its own `embedded` mode instead of behind a link-out, matching how Invoices'
// list page embeds ViewInvoicePage -- everything is readable/actionable
// without leaving this pane. `key={docId}` forces a clean remount per
// selection, and `onUpdated` keeps the list pane's own status badge in sync
// after a status change or edit.
function DocDetailPane({ docId, onBack, onUpdated, onCloned }: { docId: string; onBack: () => void; onUpdated: () => void; onCloned: (newId: string) => void }) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 pb-0">
        <button type="button" onClick={onBack} className="md:hidden mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="size-4" /> Back to list
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 pt-2">
        <ViewSalesDocumentPage key={docId} docId={docId} embedded onUpdated={onUpdated} onCloned={onCloned} />
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

const DOC_TYPE_STORAGE_KEY = 'quotations-doc-type'

// ---------- Main page ----------
function QuotationsPage() {
  // Persisted so the Quotations/Proforma tab survives a round trip through the
  // full document page -- that page's Back button remounts this one (Next.js
  // doesn't preserve component state across App Router navigation), so without
  // this it always reset to the Quotations tab even when you'd opened a
  // Proforma Invoice.
  const [docType, setDocType] = useState<SalesDocType>(() => {
    if (typeof window === 'undefined') return 'quotation'
    try {
      const stored = window.localStorage.getItem(DOC_TYPE_STORAGE_KEY)
      return stored === 'proforma' ? 'proforma' : 'quotation'
    } catch {
      return 'quotation'
    }
  })
  const selectDocType = (t: SalesDocType) => {
    setDocType(t)
    try { window.localStorage.setItem(DOC_TYPE_STORAGE_KEY, t) } catch { /* ignore */ }
  }
  const [docs, setDocs] = useState<DocSummary[]>([])
  const [loading, setLoading] = useState(true)
  // Filters/search/page are URL-synced via useUrlState (lib/useUrlState.ts) so
  // browser Back undoes one filter change at a time, same fix as Sales Ledger.
  const [pageStr, setPageUrl] = useUrlState('page', '1')
  const page = Number(pageStr) || 1
  const setPage = useCallback((n: number) => setPageUrl(String(n), 'push'), [setPageUrl])
  const [total, setTotal] = useState(0)
  const PAGE_SIZE = useListPageSize()
  const [activeDocId, setActiveDocId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const isDesktop = useIsDesktopViewport()
  const { width: listPaneWidth, handleMouseDown: handlePaneResize } = useResizablePaneWidth('quotations-list-pane-width')

  const [statusFilter, setStatusFilterUrl] = useUrlState('status', '')
  const setStatusFilter = useCallback((v: string) => setStatusFilterUrl(v, 'push'), [setStatusFilterUrl])
  const [dateFrom, setDateFromUrl] = useUrlState('date_from', '')
  const setDateFrom = useCallback((v: string) => setDateFromUrl(v, 'push'), [setDateFromUrl])
  const [dateTo, setDateToUrl] = useUrlState('date_to', '')
  const setDateTo = useCallback((v: string) => setDateToUrl(v, 'push'), [setDateToUrl])
  // searchInput updates on every keystroke; search catches up 300ms after typing
  // stops and is what actually drives fetchDocs -- same debounce pattern as
  // StockView/Sales Ledger/Purchase Orders.
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearchUrl] = useUrlState('q', '', { debounceMs: 300 })
  const setSearch = useCallback((v: string) => setSearchUrl(v, 'push'), [setSearchUrl])
  useEffect(() => {
    setSearchUrl(searchInput, 'replace')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])
  useEffect(() => { setSearchInput(search) }, [search])

  const fetchDocs = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('doc_type', docType)
    params.set('page', String(page))
    params.set('limit', String(PAGE_SIZE))
    if (statusFilter) params.set('status', statusFilter)
    if (dateFrom) params.set('date_from', dateFrom)
    if (dateTo) params.set('date_to', dateTo)
    if (search) params.set('search', search)
    const res = await apiFetch(`/api/sales-documents?${params.toString()}`)
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
  }, [docType, page, PAGE_SIZE, statusFilter, dateFrom, dateTo, search])

  useEffect(() => { fetchDocs() }, [fetchDocs])

  // Switching tabs or any filter invalidates the current page's meaning --
  // reset to page 1 silently (via `replace`) so the reset never becomes its
  // own Back-undoable step. Guarded by a ref so a freshly loaded/refreshed
  // URL with filters + page>1 already set doesn't get page stomped on mount.
  const filterKey = JSON.stringify([docType, statusFilter, dateFrom, dateTo, search])
  const prevFilterKeyRef = useRef(filterKey)
  useEffect(() => {
    if (filterKey !== prevFilterKeyRef.current) {
      prevFilterKeyRef.current = filterKey
      setPageUrl('1', 'replace')
    }
  }, [filterKey, setPageUrl])

  const activeDoc = useMemo(() => docs.find((d) => d.id === activeDocId) ?? null, [docs, activeDocId])

  return (
    <div className="p-4 flex flex-col h-full">
      {/* Title/tab-switcher/create-button merged onto one compact row (matching
          Stock's toolbar) -- the explanatory copy that used to sit on its own line
          moves into the title's tooltip instead, same technique StockView uses for
          its own subtitle prop. */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <h1
            className="text-xl font-bold shrink-0"
            title="Non-committal price offers and pre-sale documents. Converting a line hands off to the normal Sell flow — a real sale and (later) a real GST invoice are always created there, never here."
          >
            Quotations &amp; Proforma Invoices
          </h1>
          <div className="flex border rounded overflow-hidden shrink-0 w-fit">
            <button onClick={() => selectDocType('quotation')} className={`px-3 py-1.5 text-xs font-medium ${docType === 'quotation' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'}`}>Quotations</button>
            <button onClick={() => selectDocType('proforma')} className={`px-3 py-1.5 text-xs font-medium ${docType === 'proforma' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'}`}>Proforma Invoices</button>
          </div>
        </div>
        <Button onClick={() => setCreating(true)}>New {DOC_LABELS[docType]}</Button>
      </div>
      {creating && (
        <SalesDocumentEditorDialog
          mode="create"
          docType={docType}
          onClose={() => setCreating(false)}
          onSaved={(newId) => { setCreating(false); setActiveDocId(newId); fetchDocs() }}
        />
      )}

      <div className="flex flex-wrap gap-2 mb-2 items-center">
        <Select value={statusFilter || 'all'} onValueChange={(v) => setStatusFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-auto"><SelectValue placeholder="All Statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="void">Void</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-auto" title="From date" />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-auto" title="To date" />
        <Input
          type="text"
          placeholder="Search client, document #, item, or amount..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-64"
        />
        {(statusFilter || dateFrom || dateTo || search || searchInput) && (
          <button
            onClick={() => { setStatusFilter(''); setDateFrom(''); setDateTo(''); setSearch(''); setSearchInput('') }}
            className="text-sm text-muted-foreground underline self-center"
          >
            Clear filters
          </button>
        )}
      </div>

      {loading && docs.length === 0 ? (
        <div>Loading...</div>
      ) : (
        <div className={cn(
          "flex-1 min-h-[1100px] md:min-h-[500px] lg:min-h-[320px] border rounded overflow-visible lg:overflow-hidden flex",
          loading && "opacity-60"
        )}>
          {/* List pane -- hidden on mobile once a document is open, matching Sales Ledger. */}
          <div
            className={cn('w-full md:flex-shrink-0 border-r border-border flex flex-col', activeDoc && 'hidden md:flex')}
            style={isDesktop ? { width: listPaneWidth } : undefined}
          >
            <div className="flex-1 overflow-visible lg:overflow-y-auto">
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

{isDesktop && (
  <div
    onMouseDown={handlePaneResize}
    className="hidden md:block w-1.5 shrink-0 cursor-col-resize hover:bg-primary/20 active:bg-primary/30"
    title="Drag to resize"
  />
)}

          {/* Detail pane -- full width on mobile (replaces the list), flex-1 at md+. */}
          <div className={cn('flex-1 min-w-0', !activeDoc && 'hidden md:flex md:items-center md:justify-center')}>
            {activeDoc ? (
              <DocDetailPane
                docId={activeDoc.id}
                onBack={() => setActiveDocId(null)}
                onUpdated={fetchDocs}
                onCloned={(newId) => { setActiveDocId(newId); fetchDocs() }}
              />
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
      <Suspense>
        <QuotationsPage />
      </Suspense>
    </RequirePageAccess>
  )
}

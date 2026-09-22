'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Loader2, AlertTriangle, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api-client'
import { SkuFormModal } from '@/components/SkuFormModal'
import { MergeSkuDialog } from '@/components/MergeSkuDialog'
import { SkuWebPublishDialog } from '@/components/SkuWebPublishDialog'
import RequirePageAccess from '@/components/RequirePageAccess'
import { useRole } from '@/lib/auth/useRole'
import { buildConfigSummary, buildConfigDiff } from '@/lib/sku-config-summary'
import { Pagination } from '@/components/Pagination'
import { ErrorBanner } from '@/components/ErrorBanner'
import { StatCardsRow, StatCard } from '@/components/StatCardsRow'
import { StatusBadge } from '@/components/StatusBadge'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 25

type FilterTab = 'all' | 'published' | 'unpublished' | 'out_of_stock' | 'low_stock' | 'discontinued' | 'archived'

interface SkuCounts {
  all: number
  published: number
  unpublished: number
  out_of_stock: number
  low_stock: number
  discontinued: number
  archived: number
}

interface DuplicateCluster {
  category: string
  brand: string
  skus: { id: string; full_sku_code: string; base_sku_code: string; category: string; brand: string; model_name: string; specifications: any; quantity_in_stock: number | null }[]
}

interface SKU {
  id: string
  full_sku_code: string
  base_sku_code: string
  variant_number: number
  category: string
  item_type: string
  brand: string
  model_name: string
  specifications: any
  sku_description: string
  base_cost: number | null
  selling_price_default: number | null
  quantity_in_stock: number
  reorder_level: number
  hsn_code?: string | null
  is_published?: boolean | null
  status?: string
  sold_count?: number
}

interface CategoryTemplate {
  category: string
  display_name: string
  field_schema: any
  sku_code_format?: string
}

type SortField = 'full_sku_code' | 'sku_description' | 'category' | 'quantity_in_stock' | 'sold_count'
type SortOrder = 'asc' | 'desc'

// One field in the detail pane's label/value grid -- keeps every row's spacing
// and label styling consistent without repeating the wrapper markup (matches
// Customers/Vendors' Field helper).
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5 border-b border-border grid grid-cols-3 gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2">{children}</span>
    </div>
  )
}

// Left-pane list row -- the scannable subset of the old table's columns: code,
// a description snippet, category, and stock qty, plus the website status
// badge. Sold count and HSN are less useful at a glance and live in the
// detail pane instead.
function SkuListItem({ sku, summary, active, onOpen }: {
  sku: SKU
  summary: string
  active: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "w-full text-left px-3 py-2.5 border-b border-border flex items-start gap-2.5 transition-colors",
        active ? "bg-primary/10" : "hover:bg-muted"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-sm text-foreground truncate">{sku.full_sku_code}</span>
          <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">Qty {sku.quantity_in_stock ?? 0}</span>
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{summary}</p>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <StatusBadge tone="neutral">{sku.category}</StatusBadge>
          <StatusBadge tone={sku.is_published ? 'success' : 'neutral'}>
            {sku.is_published ? 'Published' : 'Unpublished'}
          </StatusBadge>
        </div>
      </div>
    </button>
  )
}

// Right-pane detail view -- every column the old wide table showed for one SKU
// (code, description, HSN, category, stock, sold, website status) plus a few
// extra fields already present on the fetched record (brand/model/status/
// pricing) laid out as a single record. Actions (Edit/Pricing/Website/Delete)
// are the exact same handlers the old table's Actions column called.
function SkuDetailPane({ sku, summary, isOwner, hasWebsiteAccess, deleting, onEdit, onWebsite, onDelete, onBack }: {
  sku: SKU
  summary: string
  isOwner: boolean
  hasWebsiteAccess: boolean
  deleting: boolean
  onEdit: () => void
  onWebsite: () => void
  onDelete: () => void
  onBack: () => void
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
        <div className="min-w-0">
          <button type="button" onClick={onBack} className="md:hidden mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowLeft className="size-4" /> Back to list
          </button>
          <h2 className="text-lg font-semibold text-foreground truncate">{sku.full_sku_code}</h2>
          <p className="text-sm text-muted-foreground mt-0.5 truncate">{summary}</p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <StatusBadge tone="neutral">{sku.category}</StatusBadge>
            <StatusBadge tone={sku.is_published ? 'success' : 'neutral'}>
              {sku.is_published ? 'Published' : 'Unpublished'}
            </StatusBadge>
            {sku.status && sku.status !== 'active' && (
              <StatusBadge tone={sku.status === 'discontinued' ? 'warning' : 'neutral'}>{sku.status}</StatusBadge>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <button onClick={onEdit} disabled={deleting} className="text-primary underline text-sm disabled:opacity-50">Edit</button>
          {isOwner && (
            <Link href={`/dashboard/pricing?sku_id=${sku.id}`} className="text-purple underline text-sm">Pricing</Link>
          )}
          {hasWebsiteAccess && (
            <button onClick={onWebsite} disabled={deleting} className="text-success underline text-sm disabled:opacity-50">Website</button>
          )}
          <button onClick={onDelete} disabled={deleting} className="text-destructive underline text-sm disabled:opacity-50 inline-flex items-center gap-1">
            {deleting && <Loader2 className="size-3 animate-spin" />}
            Delete
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <Field label="Description">{summary}</Field>
        <Field label="HSN Code">{sku.hsn_code || '—'}</Field>
        <Field label="Category">{sku.category}</Field>
        <Field label="Brand / Model">{[sku.brand, sku.model_name].filter(Boolean).join(' ') || '—'}</Field>
        <Field label="Base SKU / Variant">{sku.base_sku_code ? `${sku.base_sku_code}${sku.variant_number ? ` / v${sku.variant_number}` : ''}` : '—'}</Field>
        <Field label="Stock">{sku.quantity_in_stock ?? 0}</Field>
        <Field label="Reorder Level">{sku.reorder_level ?? '—'}</Field>
        <Field label="Sold">{sku.sold_count ?? 0}</Field>
        {sku.base_cost != null && <Field label="Base Cost">₹{sku.base_cost}</Field>}
        {sku.selling_price_default != null && <Field label="Default Selling Price">₹{sku.selling_price_default}</Field>}
        <Field label="Website">
          <StatusBadge tone={sku.is_published ? 'success' : 'neutral'}>
            {sku.is_published ? 'Published' : 'Unpublished'}
          </StatusBadge>
        </Field>
        <Field label="Status">{sku.status || 'active'}</Field>
      </div>
    </div>
  )
}

function SkuMasterPage() {
  const { isOwner, hasPageAccess } = useRole()
  const [skus, setSkus] = useState<SKU[]>([])
  const [templates, setTemplates] = useState<CategoryTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSku, setEditingSku] = useState<SKU | null>(null)
  const searchParams = useSearchParams()
  const [search, setSearch] = useState(searchParams.get('search') || '')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [sortField, setSortField] = useState<SortField>('full_sku_code')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [counts, setCounts] = useState<SkuCounts | null>(null)
  // Which SKU is open in the right-hand detail pane.
  const [activeSkuId, setActiveSkuId] = useState<string | null>(null)

  const [duplicateClusters, setDuplicateClusters] = useState<DuplicateCluster[]>([])
  const [showDuplicates, setShowDuplicates] = useState(false)
  const [mergeCluster, setMergeCluster] = useState<DuplicateCluster | null>(null)
  const [webPublishSku, setWebPublishSku] = useState<SKU | null>(null)

  const fetchDuplicateCandidates = useCallback(async () => {
    if (!isOwner) return
    try {
      const res = await apiFetch('/api/sku-master/duplicate-candidates')
      if (!res.ok) return
      setDuplicateClusters(await res.json())
    } catch {
      // Non-critical -- the banner just stays empty if this fails.
    }
  }, [isOwner])

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await apiFetch('/api/sku-category-templates')
      if (!res.ok) throw new Error('Failed to load templates')
      const data = await res.json()
      setTemplates(data)
    } catch (err: any) {
      console.error(err)
      setError(err.message)
    }
  }, [])

  // Tabs beyond category/search: Published/Unpublished narrow by website state,
  // Out of Stock/Low Stock by quantity vs reorder level, Discontinued/Archived by
  // the base status column (the default list only ever shows 'active'). Mutually
  // exclusive -- clicking one replaces the others, same as Live Stock's top-level
  // tab bar (not layered sub-filters within a tab).
  const tabToParams = (tab: FilterTab): Record<string, string> => {
    switch (tab) {
      case 'published': return { is_published: 'true' }
      case 'unpublished': return { is_published: 'false' }
      case 'out_of_stock': return { stock_filter: 'out_of_stock' }
      case 'low_stock': return { stock_filter: 'low_stock' }
      case 'discontinued': return { status: 'discontinued' }
      case 'archived': return { status: 'archived' }
      default: return {}
    }
  }

  const fetchSkus = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (search) params.append('search', search)
      if (categoryFilter) params.append('category', categoryFilter)
      Object.entries(tabToParams(filterTab)).forEach(([k, v]) => params.set(k, v))
      params.set('page', String(page))
      params.set('limit', String(PAGE_SIZE))
      const res = await apiFetch(`/api/sku-master?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch SKUs')
      const json = await res.json()
      const rows: SKU[] = json.data || []
      setSkus(rows)
      setTotal(json.total || 0)
      // Auto-open the first row on load/refetch, but don't yank focus away
      // from whatever's already open if it's still in the refetched data.
      setActiveSkuId((prev) => (prev && rows.some((s) => s.id === prev)) ? prev : (rows[0]?.id ?? null))
    } catch (err: any) {
      console.error(err)
      setError(err.message)
    }
  }, [search, categoryFilter, filterTab, page])

  const fetchCounts = useCallback(async () => {
    try {
      const params = new URLSearchParams({ counts: 'true' })
      if (search) params.append('search', search)
      if (categoryFilter) params.append('category', categoryFilter)
      const res = await apiFetch(`/api/sku-master?${params.toString()}`)
      if (!res.ok) return
      setCounts(await res.json())
    } catch {
      // Non-critical -- tabs just show without counts if this fails.
    }
  }, [search, categoryFilter])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  useEffect(() => {
    fetchSkus().finally(() => setLoading(false))
  }, [fetchSkus])

  useEffect(() => {
    fetchCounts()
  }, [fetchCounts])

  useEffect(() => {
    fetchDuplicateCandidates()
  }, [fetchDuplicateCandidates])

  // Any filter change invalidates the current page's meaning -- reset to page 1.
  useEffect(() => { setPage(1) }, [search, categoryFilter, filterTab])

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  const displayedSkus = useMemo(() => {
    const sorted = [...skus].sort((a, b) => {
      const av = a[sortField]
      const bv = b[sortField]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return av - bv
      return String(av).localeCompare(String(bv))
    })
    return sortOrder === 'asc' ? sorted : sorted.reverse()
  }, [skus, sortField, sortOrder])

  const sortIndicator = (field: SortField) => (sortField === field ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : '')

  const handleCreate = () => {
    if (templates.length === 0) {
      alert('No categories available. Seed the database first.')
      return
    }
    setEditingSku(null)
    setModalOpen(true)
  }

  const handleEdit = (sku: SKU) => {
    setEditingSku(sku)
    setModalOpen(true)
  }

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const handleDelete = async (sku: SKU) => {
    if (deletingId) return
    // Known up front from sold_count -- skip the round trip and give a specific
    // reason instead of a generic confirm the delete would just fail anyway
    // (asset_ledger/sales FKs are RESTRICT, so this always 409s server-side too).
    if ((sku.sold_count ?? 0) > 0) {
      toast.error(`Can't delete ${sku.full_sku_code}: ${sku.sold_count} sold unit(s) are tagged to it. Use Merge instead if this is a duplicate.`)
      return
    }
    if (!confirm(`Permanently delete ${sku.full_sku_code}? This action cannot be undone.`)) return
    setDeletingId(sku.id)
    try {
      const res = await apiFetch(`/api/sku-master/${sku.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || 'Delete failed')
        return
      }
      toast.success(`Deleted ${sku.full_sku_code}`)
      fetchSkus()
      fetchCounts()
    } finally {
      setDeletingId(null)
    }
  }

  const statCards: StatCard[] = counts ? [
    { label: 'All', value: counts.all, onClick: () => setFilterTab('all'), active: filterTab === 'all' },
    { label: 'Published', value: counts.published, onClick: () => setFilterTab('published'), active: filterTab === 'published' },
    { label: 'Unpublished', value: counts.unpublished, onClick: () => setFilterTab('unpublished'), active: filterTab === 'unpublished' },
    { label: 'Out of Stock', value: counts.out_of_stock, onClick: () => setFilterTab('out_of_stock'), active: filterTab === 'out_of_stock' },
    { label: 'Low Stock', value: counts.low_stock, onClick: () => setFilterTab('low_stock'), active: filterTab === 'low_stock' },
    { label: 'Discontinued', value: counts.discontinued, onClick: () => setFilterTab('discontinued'), active: filterTab === 'discontinued' },
    { label: 'Archived', value: counts.archived, onClick: () => setFilterTab('archived'), active: filterTab === 'archived' },
  ] : []

  const activeSku = useMemo(() => displayedSkus.find((s) => s.id === activeSkuId) ?? null, [displayedSkus, activeSkuId])
  const hasWebsiteAccess = isOwner || hasPageAccess('website')

  const summaryFor = (sku: SKU) => buildConfigSummary(sku.category, sku.specifications, templates) || sku.sku_description

  if (loading) return <div className="p-4">Loading…</div>

  return (
    <div className="p-4 flex flex-col" style={{ height: "calc(100vh - 2rem)" }}>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">SKU Master</h1>
        <button onClick={handleCreate} className="bg-primary text-primary-foreground px-4 py-2 rounded">
          + New SKU
        </button>
      </div>

      {error && <div className="mb-4"><ErrorBanner message={error} onRetry={() => fetchSkus()} /></div>}

      {counts && <StatCardsRow cards={statCards} />}

      {duplicateClusters.length > 0 && (
        <div className="mb-4 border border-warning/20 bg-warning/15 rounded-md">
          <button
            type="button"
            onClick={() => setShowDuplicates((v) => !v)}
            className="w-full flex items-center gap-2 p-3 text-left text-sm font-medium text-warning"
          >
            <AlertTriangle className="size-4 shrink-0" />
            {duplicateClusters.length} possible duplicate group{duplicateClusters.length !== 1 ? 's' : ''} found
            <span className="ml-auto text-xs underline">{showDuplicates ? 'Hide' : 'Review'}</span>
          </button>
          {showDuplicates && (
            <div className="border-t border-warning/20 divide-y divide-warning/20">
              {duplicateClusters.map((cluster, idx) => (
                <div key={idx} className="p-3 flex flex-wrap items-center gap-3 text-sm">
                  <div className="flex-1 min-w-0">
                    {cluster.skus.map((s) => {
                      const configDiff = buildConfigDiff(s.category, s.specifications, templates)
                      return (
                        <div key={s.id} className="text-muted-foreground">
                          {s.full_sku_code} -- {s.brand} {s.model_name} ({s.quantity_in_stock ?? 0} in stock)
                          {configDiff && <span className="font-medium"> -- {configDiff}</span>}
                        </div>
                      )
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => setMergeCluster(cluster)}
                    className="px-3 py-1.5 border border-warning/20 rounded text-warning hover:bg-warning/15 shrink-0"
                  >
                    Merge...
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-4 mb-4 items-end">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Category</label>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="border p-2 rounded">
            <option value="">All Categories</option>
            {templates.map((t) => (
              <option key={t.category} value={t.category}>{t.display_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Search</label>
          <input
            type="text"
            placeholder="Search code or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border p-2 rounded"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Sort</label>
          <div className="flex gap-1">
            {(['full_sku_code', 'sku_description', 'category', 'quantity_in_stock', 'sold_count'] as SortField[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => toggleSort(f)}
                className={cn(
                  "px-2 py-2 border rounded text-xs whitespace-nowrap",
                  sortField === f ? "bg-primary/10 border-primary/30 text-primary" : "text-muted-foreground"
                )}
              >
                {{ full_sku_code: 'Code', sku_description: 'Description', category: 'Category', quantity_in_stock: 'Stock', sold_count: 'Sold' }[f]}
                {sortIndicator(f)}
              </button>
            ))}
          </div>
        </div>
        {(categoryFilter || search || filterTab !== 'all') && (
          <button
            onClick={() => { setCategoryFilter(''); setSearch(''); setFilterTab('all') }}
            className="text-sm text-muted-foreground underline"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 border rounded overflow-hidden flex">
        {/* List pane -- hidden on mobile once a SKU is open, matching an email
            client's drill-in navigation; always visible at md+. */}
        <div className={cn("w-full md:w-[360px] md:flex-shrink-0 border-r border-border flex flex-col", activeSku && "hidden md:flex")}>
          <div className="flex-1 overflow-y-auto">
            {displayedSkus.map((sku) => (
              <SkuListItem
                key={sku.id}
                sku={sku}
                summary={summaryFor(sku)}
                active={sku.id === activeSkuId}
                onOpen={() => setActiveSkuId(sku.id)}
              />
            ))}
            {displayedSkus.length === 0 && (
              <p className="p-4 text-center text-sm text-muted-foreground">No SKUs found.</p>
            )}
          </div>
          <div className="border-t border-border p-2">
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </div>
        </div>

        {/* Detail pane -- full width on mobile (replaces the list), flex-1 at md+. */}
        <div className={cn("flex-1 min-w-0", !activeSku && "hidden md:flex md:items-center md:justify-center")}>
          {activeSku ? (
            <SkuDetailPane
              sku={activeSku}
              summary={summaryFor(activeSku)}
              isOwner={isOwner}
              hasWebsiteAccess={hasWebsiteAccess}
              deleting={deletingId === activeSku.id}
              onEdit={() => handleEdit(activeSku)}
              onWebsite={() => setWebPublishSku(activeSku)}
              onDelete={() => handleDelete(activeSku)}
              onBack={() => setActiveSkuId(null)}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Select a SKU to view details.</p>
          )}
        </div>
      </div>

      {modalOpen && (
        <SkuFormModal
          templates={templates}
          existingSku={editingSku}
          onClose={() => setModalOpen(false)}
          onSaved={() => { fetchSkus(); fetchCounts() }}
        />
      )}

      {mergeCluster && (
        <MergeSkuDialog
          candidates={mergeCluster.skus}
          templates={templates}
          onClose={() => setMergeCluster(null)}
          onMerged={() => {
            toast.success('SKUs merged')
            fetchSkus()
            fetchCounts()
            fetchDuplicateCandidates()
          }}
        />
      )}

      {webPublishSku && (
        <SkuWebPublishDialog
          sku={webPublishSku}
          templates={templates}
          onClose={() => setWebPublishSku(null)}
          onSaved={() => { fetchSkus(); fetchCounts() }}
        />
      )}
    </div>
  )
}

export default function SkuMasterPageGuarded() {
  return (
    <RequirePageAccess pageKey="sku_master">
      <SkuMasterPage />
    </RequirePageAccess>
  )
}

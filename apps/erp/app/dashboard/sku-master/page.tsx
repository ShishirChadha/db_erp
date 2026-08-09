'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Loader2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api-client'
import { SkuFormModal } from '@/components/SkuFormModal'
import { MergeSkuDialog } from '@/components/MergeSkuDialog'
import { SkuWebPublishDialog } from '@/components/SkuWebPublishDialog'
import RequirePageAccess from '@/components/RequirePageAccess'
import { useRole } from '@/lib/auth/useRole'
import { buildConfigSummary } from '@/lib/sku-config-summary'
import { Pagination } from '@/components/Pagination'
import { EmptyTableRow } from '@/components/EmptyTableRow'
import { ErrorBanner } from '@/components/ErrorBanner'
import { StatCardsRow, StatCard } from '@/components/StatCardsRow'
import { StatusBadge } from '@/components/StatusBadge'

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
  skus: { id: string; full_sku_code: string; category: string; brand: string; model_name: string; quantity_in_stock: number | null }[]
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
}

interface CategoryTemplate {
  category: string
  display_name: string
  field_schema: any
  sku_code_format?: string
}

type SortField = 'full_sku_code' | 'sku_description' | 'category' | 'quantity_in_stock'
type SortOrder = 'asc' | 'desc'

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
      setSkus(json.data || [])
      setTotal(json.total || 0)
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
    if (!confirm(`Permanently delete ${sku.full_sku_code}? This action cannot be undone.`)) return
    setDeletingId(sku.id)
    try {
      await apiFetch(`/api/sku-master/${sku.id}`, { method: 'DELETE' })
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

  if (loading) return <div className="p-4">Loading…</div>

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">SKU Master</h1>
        <button onClick={handleCreate} className="bg-blue-600 text-white px-4 py-2 rounded">
          + New SKU
        </button>
      </div>

      {error && <div className="mb-4"><ErrorBanner message={error} onRetry={() => fetchSkus()} /></div>}

      {counts && <StatCardsRow cards={statCards} />}

      {duplicateClusters.length > 0 && (
        <div className="mb-4 border border-amber-300 bg-amber-50 rounded-md">
          <button
            type="button"
            onClick={() => setShowDuplicates((v) => !v)}
            className="w-full flex items-center gap-2 p-3 text-left text-sm font-medium text-amber-800"
          >
            <AlertTriangle className="size-4 shrink-0" />
            {duplicateClusters.length} possible duplicate group{duplicateClusters.length !== 1 ? 's' : ''} found
            <span className="ml-auto text-xs underline">{showDuplicates ? 'Hide' : 'Review'}</span>
          </button>
          {showDuplicates && (
            <div className="border-t border-amber-300 divide-y divide-amber-200">
              {duplicateClusters.map((cluster, idx) => (
                <div key={idx} className="p-3 flex flex-wrap items-center gap-3 text-sm">
                  <div className="flex-1 min-w-0">
                    {cluster.skus.map((s) => (
                      <div key={s.id} className="text-gray-700">
                        {s.full_sku_code} -- {s.brand} {s.model_name} ({s.quantity_in_stock ?? 0} in stock)
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setMergeCluster(cluster)}
                    className="px-3 py-1.5 border border-amber-400 rounded text-amber-800 hover:bg-amber-100 shrink-0"
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
          <label className="block text-xs text-gray-500 mb-1">Category</label>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="border p-2 rounded">
            <option value="">All Categories</option>
            {templates.map((t) => (
              <option key={t.category} value={t.category}>{t.display_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Search</label>
          <input
            type="text"
            placeholder="Search code or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border p-2 rounded"
          />
        </div>
        {(categoryFilter || search || filterTab !== 'all') && (
          <button
            onClick={() => { setCategoryFilter(''); setSearch(''); setFilterTab('all') }}
            className="text-sm text-gray-500 underline"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-full text-sm">
          <thead>
            <tr>
              <th className="p-2 w-10 text-right">#</th>
              <th className="p-2 cursor-pointer select-none" onClick={() => toggleSort('full_sku_code')}>
                SKU Code{sortIndicator('full_sku_code')}
              </th>
              <th className="p-2 cursor-pointer select-none" onClick={() => toggleSort('sku_description')}>
                Description{sortIndicator('sku_description')}
              </th>
              <th className="p-2">HSN</th>
              <th className="p-2 cursor-pointer select-none" onClick={() => toggleSort('category')}>
                Category{sortIndicator('category')}
              </th>
              <th className="p-2 text-right cursor-pointer select-none" onClick={() => toggleSort('quantity_in_stock')}>
                Stock{sortIndicator('quantity_in_stock')}
              </th>
              <th className="p-2">Website</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {displayedSkus.length === 0 && <EmptyTableRow colSpan={8} message="No SKUs found." />}
            {displayedSkus.map((sku, idx) => (
              <tr key={sku.id}>
                <td className="p-2 text-right tabular-nums text-gray-400">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                <td className="p-2">{sku.full_sku_code}</td>
                <td className="p-2">{buildConfigSummary(sku.category, sku.specifications, templates) || sku.sku_description}</td>
                <td className="p-2">{sku.hsn_code || '—'}</td>
                <td className="p-2">{sku.category}</td>
                <td className="p-2 text-right tabular-nums">{sku.quantity_in_stock ?? '0'}</td>
                <td className="p-2">
                  <StatusBadge tone={sku.is_published ? 'success' : 'neutral'}>
                    {sku.is_published ? 'Published' : 'Unpublished'}
                  </StatusBadge>
                </td>
                <td className="p-2 space-x-2">
                  <button onClick={() => handleEdit(sku)} disabled={deletingId === sku.id} className="text-blue-600 underline disabled:opacity-50">Edit</button>
                  {isOwner && (
                    <Link href={`/dashboard/pricing?sku_id=${sku.id}`} className="text-purple-600 underline">Pricing</Link>
                  )}
                  {(isOwner || hasPageAccess('website')) && (
                    <button onClick={() => setWebPublishSku(sku)} className="text-emerald-600 underline">Website</button>
                  )}
                  <button onClick={() => handleDelete(sku)} disabled={deletingId === sku.id} className="text-red-600 underline disabled:opacity-50 inline-flex items-center gap-1">
                    {deletingId === sku.id && <Loader2 className="size-3 animate-spin" />}
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />

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
'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useRole } from '@/lib/auth/useRole'
import { FixSkuDialog } from '@/components/FixSkuDialog'
import { StatCardsRow } from '@/components/StatCardsRow'
import { Checkbox } from '@/components/ui/checkbox'
import { Pagination } from '@/components/Pagination'
import { StatusBadge } from '@/components/StatusBadge'
import { ASSET_STATUS_TONES, toneFor } from '@/lib/status-styles'
import { EmptyTableRow } from '@/components/EmptyTableRow'
import { ReasonConfirmDialog } from '@/components/ReasonConfirmDialog'
import { ColumnToggle } from '@/components/ColumnToggle'
import { AddPaymentDialog } from '@/components/AddPaymentDialog'
import { EditSaleDialog } from '@/components/EditSaleDialog'
import { buildConfigSummary, ConfigSummaryTemplate } from '@/lib/sku-config-summary'

interface AssetRow {
  id: string
  asset_number: string | null
  serial_number: string | null
  status: string
  qc_grade: string | null
  qc_status: string
  sold_at: string | null
  created_at?: string | null
  po_id: string | null
  sku_id?: string
  sku_code: string
  description: string
  category?: string | null
  specifications?: Record<string, any> | null
  under_repair_job_number?: string | null
  unit_price?: number
  gst_percentage?: number
  po_number?: string
  po_date?: string
  vendor_name?: string
  purchased_by_type?: string
  customer_name?: string
  sale_id?: string
  sale_total?: number
  invoice_finalized?: boolean
  invoice_number?: string
  payment_status?: string
  amount_paid?: number
  bundled_accessories_display?: { name: string; quantity: number }[]
}

interface Vendor {
  id: string
  company_name: string
}

// Standalone accessory sale (sales.accessory_id set, no asset_ledger row -- accessories
// are fungible sku_master rows, never per-unit tracked). Entirely different shape from
// AssetRow: no serial/asset number, no QC/warranty/PO fields.
interface SoldAccessoryRow {
  id: string
  sale_date: string
  customer_name: string | null
  full_sku_code: string
  sku_description: string | null
  accessory_quantity: number
  sale_total: number
  payment_status: string
  amount_paid: number
  payment_account: string | null
  sold_by: string | null
  finalized: boolean
  invoice_number: string | null
}

// Current (in-stock) accessories -- also no asset_ledger row, quantity-only.
interface AccessoryStockRow {
  id: string
  full_sku_code: string
  sku_description: string | null
  category: string
  brand: string | null
  model_name: string | null
  quantity_in_stock: number
  selling_price_default: number | null
  base_cost?: number
  needs_po_qty?: number
  last_vendor?: string | null
  last_entry_vendor?: string | null
  last_entry_price?: number | null
  last_entry_date?: string | null
}

const CURRENT_STATUSES = ['draft', 'reserved', 'received', 'in_stock', 'qc_pending', 'qc_passed', 'ready_for_sale', 'faulty', 'rma_sent', 'rma_returned']

const MONTH_OPTIONS = [
  { value: '1', label: 'January' }, { value: '2', label: 'February' }, { value: '3', label: 'March' },
  { value: '4', label: 'April' }, { value: '5', label: 'May' }, { value: '6', label: 'June' },
  { value: '7', label: 'July' }, { value: '8', label: 'August' }, { value: '9', label: 'September' },
  { value: '10', label: 'October' }, { value: '11', label: 'November' }, { value: '12', label: 'December' },
]

type Tab = 'current' | 'sold' | 'accessories' | 'sold_accessories'
type SortField = 'asset_number' | 'status' | 'sold_at' | 'created_at'
type SortOrder = 'asc' | 'desc'

// "Last entry on top" by default -- most-recently-added unit for Current, most-
// recently-sold for Sold. Server-driven (see /api/stock's opt-in sort/order params).
// Sold Accessories has no client-side sort control (its own route always orders by
// sale_date desc), so it's deliberately not a key here.
const TAB_DEFAULT_SORT: Record<'current' | 'sold', { field: SortField; order: SortOrder }> = {
  current: { field: 'created_at', order: 'desc' },
  sold: { field: 'sold_at', order: 'desc' },
}

const OPTIONAL_COLUMNS = [
  { key: 'entryDate', label: 'Entry Date' },
  { key: 'purchaseDate', label: 'Purchase Date' },
  { key: 'soldDate', label: 'Sold Date' },
  { key: 'sku', label: 'SKU' },
  { key: 'grade', label: 'Grade' },
  { key: 'po', label: 'PO' },
  { key: 'vendorCost', label: 'Vendor / Cost' },
  { key: 'customer', label: 'Customer' },
  { key: 'saleTotal', label: 'Sale Total' },
  { key: 'bundle', label: 'Bundle' },
  { key: 'invoice', label: 'Invoice' },
] as const
type ColumnKey = typeof OPTIONAL_COLUMNS[number]['key']

function identifier(asset: AssetRow) {
  return asset.asset_number || (asset.serial_number ? `SN: ${asset.serial_number}` : '— no tag yet —')
}

// Shared table/logic behind both the employee-facing Live Stock view (source=
// employee_intake only) and the main-ERP Stock view (everything else) -- the two are
// kept deliberately non-overlapping so reconciliation work on one never touches the
// other, until they're explicitly connected later.
export default function StockView({
  title,
  subtitle,
  sourceMode,
  pageKey,
  showServiceActions = false,
}: {
  title: string
  subtitle: string
  sourceMode: 'employee_intake' | 'exclude_employee_intake'
  pageKey: 'live_stock' | 'stock'
  showServiceActions?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { isOwner, canEditPage } = useRole()
  // "Fix SKU" is the one action here that's already open to any authenticated staff at
  // the API level (app/api/asset-ledger/[id]/reassign-sku has no owner-gating) -- gate it
  // by this page's edit grant instead of isOwner. Cost/vendor/PO visibility and
  // destructive/financial actions (delete, PO creation, invoice generation) stay
  // isOwner-only below, untouched.
  const canEdit = isOwner || canEditPage(pageKey)
  // Restores whichever tab was active before navigating away (Sell/Service/Intake's
  // Back button lands on `${pathname}?tab=<tab>` -- see returnToPath below), instead of
  // always defaulting back to Current.
  const initialTab = useMemo<Tab>(() => {
    const t = searchParams.get('tab')
    return t === 'sold' || t === 'accessories' || t === 'sold_accessories' ? t : 'current'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [tab, setTab] = useState<Tab>(initialTab)
  const returnToPath = `${pathname}?tab=${tab}`
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [soldAccessories, setSoldAccessories] = useState<SoldAccessoryRow[]>([])
  const [accessoryStock, setAccessoryStock] = useState<AccessoryStockRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [monthFilter, setMonthFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear()
    return Array.from({ length: 8 }, (_, i) => currentYear - i)
  }, [])
  const [sortField, setSortField] = useState<SortField>(TAB_DEFAULT_SORT[initialTab === 'sold' ? 'sold' : 'current'].field)
  const [sortOrder, setSortOrder] = useState<SortOrder>(TAB_DEFAULT_SORT[initialTab === 'sold' ? 'sold' : 'current'].order)

  // Switches tab and resets sort to that tab's own default in one state update, so the
  // very next fetch (triggered once, by the resulting single re-render) already uses the
  // right sort -- doing this as two separate effects previously caused an extra fetch
  // with the OLD tab's sort field firing a split second before the corrected one landed,
  // which could show briefly (or, under an unlucky response race, lastingly) wrong.
  const changeTab = (next: Tab) => {
    setTab(next)
    if (next === 'current' || next === 'sold') {
      setSortField(TAB_DEFAULT_SORT[next].field)
      setSortOrder(TAB_DEFAULT_SORT[next].order)
    }
  }

  const columnsStorageKey = `stock-columns:${sourceMode}`
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnKey, boolean>>(() => {
    if (typeof window === 'undefined') return Object.fromEntries(OPTIONAL_COLUMNS.map(c => [c.key, true])) as Record<ColumnKey, boolean>
    try {
      const stored = window.localStorage.getItem(`stock-columns:${sourceMode}`)
      if (stored) return { ...Object.fromEntries(OPTIONAL_COLUMNS.map(c => [c.key, true])), ...JSON.parse(stored) }
    } catch { /* ignore malformed localStorage value */ }
    return Object.fromEntries(OPTIONAL_COLUMNS.map(c => [c.key, true])) as Record<ColumnKey, boolean>
  })
  useEffect(() => {
    window.localStorage.setItem(columnsStorageKey, JSON.stringify(visibleColumns))
  }, [visibleColumns, columnsStorageKey])

  // Keyed by asset id, valued with the full row -- not just a Set<string> of ids --
  // so a selection made on one tab (e.g. Current Stock) survives switching to another
  // (e.g. Sold Stock) and building one combined PO across both. `assets` state gets
  // wholesale replaced on every tab/filter/page fetch, so the id alone wouldn't be
  // enough to recover a since-scrolled-off row's sku_code/cost fields for the form.
  const [selected, setSelected] = useState<Map<string, AssetRow>>(new Map())
  const [showPoForm, setShowPoForm] = useState(false)
  const [fixSkuAssetId, setFixSkuAssetId] = useState<string | null>(null)
  const [editSaleId, setEditSaleId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ConfigSummaryTemplate[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const PAGE_SIZE = 20

  useEffect(() => {
    apiFetch('/api/sku-category-templates').then(res => res.json()).then((data) => {
      setTemplates(Array.isArray(data) ? data : [])
    })
  }, [])

  // Owner-only discrepancy counts, independent of the active tab.
  const [missingPoCount, setMissingPoCount] = useState(0)
  const [missingInvoiceCount, setMissingInvoiceCount] = useState(0)
  // Summary counts shown as clickable stat cards -- independent of the active tab/filter
  // so they always reflect the whole picture, not just what's currently displayed.
  const [statCounts, setStatCounts] = useState({ totalCurrent: 0, readyForSale: 0, qcPending: 0, totalSold: 0 })

  const sourceParam = sourceMode === 'employee_intake' ? 'source=employee_intake' : 'exclude_source=employee_intake'

  const fetchAssets = useCallback(async () => {
    if (tab === 'sold_accessories' || tab === 'accessories') return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams(sourceParam)
      if (tab === 'sold') {
        params.append('status', 'sold')
      } else {
        params.append('status', statusFilter || CURRENT_STATUSES.join(','))
      }
      if (searchTerm) params.append('search', searchTerm)
      if (yearFilter) {
        params.set('year', yearFilter)
        if (monthFilter) params.set('month', monthFilter)
        params.set('date_field', tab === 'sold' ? 'sold_at' : 'created_at')
      }
      params.set('sort', sortField)
      params.set('order', sortOrder)
      params.set('page', String(page))
      params.set('limit', String(PAGE_SIZE))

      const res = await apiFetch(`/api/stock?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch assets')
      const json = await res.json()
      setAssets(json.data || [])
      setTotal(json.total || 0)
      // Selection is deliberately NOT cleared here -- it must survive tab/filter/page
      // changes so a cross-tab (current + sold) selection can be built up and submitted
      // as one PO. It's only cleared explicitly: on successful PO creation, or when the
      // owner unchecks a row/hits "select all" again.
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [tab, statusFilter, searchTerm, monthFilter, yearFilter, sourceParam, sortField, sortOrder, page])

  useEffect(() => { fetchAssets() }, [fetchAssets])

  const fetchSoldAccessories = useCallback(async () => {
    if (tab !== 'sold_accessories') return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (searchTerm) params.append('search', searchTerm)
      if (yearFilter) {
        params.set('year', yearFilter)
        if (monthFilter) params.set('month', monthFilter)
      }
      params.set('page', String(page))
      params.set('limit', String(PAGE_SIZE))

      const res = await apiFetch(`/api/stock/sold-accessories?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch sold accessories')
      const json = await res.json()
      setSoldAccessories(json.data || [])
      setTotal(json.total || 0)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [tab, searchTerm, monthFilter, yearFilter, page])

  useEffect(() => { fetchSoldAccessories() }, [fetchSoldAccessories])

  const fetchAccessoryStock = useCallback(async () => {
    if (tab !== 'accessories') return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (searchTerm) params.append('search', searchTerm)
      params.set('page', String(page))
      params.set('limit', String(PAGE_SIZE))

      const res = await apiFetch(`/api/stock/accessories?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch accessories')
      const json = await res.json()
      setAccessoryStock(json.data || [])
      setTotal(json.total || 0)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [tab, searchTerm, page])

  useEffect(() => { fetchAccessoryStock() }, [fetchAccessoryStock])

  // Any filter/tab change invalidates the current page's meaning -- reset to page 1.
  useEffect(() => { setPage(1) }, [tab, statusFilter, searchTerm, monthFilter, yearFilter, sourceParam])

  const fetchCounts = useCallback(async () => {
    const [currentRes, soldRes] = await Promise.all([
      apiFetch(`/api/stock?${sourceParam}&status=${CURRENT_STATUSES.join(',')}`),
      apiFetch(`/api/stock?${sourceParam}&status=sold`),
    ])
    const currentData = currentRes.ok ? await currentRes.json() : []
    const soldData = soldRes.ok ? await soldRes.json() : []
    setStatCounts({
      totalCurrent: currentData.length,
      readyForSale: currentData.filter((a: AssetRow) => a.status === 'ready_for_sale').length,
      qcPending: currentData.filter((a: AssetRow) => a.status === 'qc_pending').length,
      totalSold: soldData.length,
    })
    if (isOwner) {
      setMissingPoCount(currentData.filter((a: AssetRow) => !a.po_id).length)
      setMissingInvoiceCount(soldData.filter((a: AssetRow) => !a.invoice_finalized).length)
    }
  }, [isOwner, sourceParam])

  useEffect(() => { fetchCounts() }, [fetchCounts])

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))
    else { setSortField(field); setSortOrder('asc') }
  }

  // Sorting is server-driven (see fetchAssets' sort/order params) so it stays correct
  // across pages -- `assets` already arrives in the right order.
  const displayedAssets = assets

  const sortIndicator = (field: SortField) => (sortField === field ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : '')

  // Selectable rows on the CURRENTLY VISIBLE page/tab only -- selections made on other
  // tabs/pages aren't reflected here, which is exactly what "select all" and the header
  // checkbox's tri-state need to stay scoped to what's on screen right now.
  const selectableIds = useMemo(
    () => displayedAssets.filter(a => !a.po_id).map(a => a.id),
    [displayedAssets]
  )
  const visibleSelectedCount = useMemo(
    () => selectableIds.filter(id => selected.has(id)).length,
    [selectableIds, selected]
  )

  const toggleSelectAll = () => {
    setSelected(prev => {
      const next = new Map(prev)
      if (visibleSelectedCount === selectableIds.length) {
        for (const id of selectableIds) next.delete(id)
      } else {
        for (const asset of displayedAssets) {
          if (!asset.po_id) next.set(asset.id, asset)
        }
      }
      return next
    })
  }
  const toggleSelectOne = (asset: AssetRow) => {
    setSelected(prev => {
      const next = new Map(prev)
      if (next.has(asset.id)) next.delete(asset.id); else next.set(asset.id, asset)
      return next
    })
  }

  const [pendingRowKey, setPendingRowKey] = useState<string | null>(null)
  const [forceDeleteAsset, setForceDeleteAsset] = useState<{ id: string; label: string } | null>(null)
  const [forceDeleteErr, setForceDeleteErr] = useState('')
  const [addPaymentAsset, setAddPaymentAsset] = useState<{ saleId: string; balanceDue: number } | null>(null)

  const generateInvoice = async (saleAssetId: string) => {
    if (pendingRowKey) return
    setPendingRowKey(`${saleAssetId}:invoice`)
    try {
      // Look up the sale by asset_ledger_id via the sales queue, then finalize it.
      const res = await apiFetch(`/api/sales-entry`)
      const pending = res.ok ? await res.json() : []
      const sale = pending.find((s: any) => s.asset_number === displayedAssets.find(a => a.id === saleAssetId)?.asset_number)
      if (!sale) { alert('Could not find the pending sale for this unit.'); return }
      const finRes = await apiFetch(`/api/sales/${sale.id}/finalize`, { method: 'POST', body: '{}' })
      if (!finRes.ok) {
        const err = await finRes.json().catch(() => ({}))
        // During the Zoho transition this entity records external numbers, not
        // generated ones -- that's done from the Sales Ledger.
        if (err.error_code === 'external_invoicing') {
          alert(`${err.error}\n\nDo this from the Sales page (Record Zoho Invoice #).`)
        } else {
          alert(err.error || 'Failed to generate invoice.')
        }
        return
      }
      fetchAssets()
      fetchCounts()
    } finally {
      setPendingRowKey(null)
    }
  }

  const deleteAsset = async (asset: { id: string }, label: string) => {
    if (pendingRowKey) return
    if (!confirm(`Delete asset ${label}? This cannot be undone.`)) return
    setPendingRowKey(`${asset.id}:delete`)
    try {
      const res = await apiFetch(`/api/asset-ledger/${asset.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Delete failed')
        return
      }
      fetchAssets()
      fetchCounts()
    } finally {
      setPendingRowKey(null)
    }
  }

  const handleForceDelete = async (reason: string) => {
    if (!forceDeleteAsset) return
    setForceDeleteErr('')
    const res = await apiFetch(`/api/asset-ledger/${forceDeleteAsset.id}/force-delete`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      setForceDeleteErr(err.error || 'Failed to delete.')
      throw new Error(err.error || 'Failed to delete.')
    }
    setForceDeleteAsset(null)
    fetchAssets()
    fetchCounts()
  }

  if (error) return <div className="p-4 text-red-600">Error: {error}</div>

  return (
    <div className="p-4">
      <div className="flex justify-between items-start gap-4 mb-1">
        <h1 className="text-2xl font-bold">{title}</h1>
        {tab === 'accessories' ? (
          <Link
            href="/dashboard/accessories"
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium shrink-0"
          >
            Manage Accessories →
          </Link>
        ) : (
          <Link
            href={`${tab !== 'current' ? '/dashboard/entry/sell' : '/dashboard/entry/intake'}?return_to=${encodeURIComponent(returnToPath)}`}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium shrink-0"
          >
            + {tab !== 'current' ? 'New Sale' : 'New Stock Intake'}
          </Link>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-4">{subtitle}</p>

      <div className="flex mb-4 border rounded overflow-hidden w-fit">
        <button onClick={() => changeTab('current')} className={`px-4 py-2 text-sm font-medium ${tab === 'current' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>
          Current Stock
        </button>
        <button onClick={() => changeTab('sold')} className={`px-4 py-2 text-sm font-medium ${tab === 'sold' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>
          Sold Stock
        </button>
        <button onClick={() => changeTab('accessories')} className={`px-4 py-2 text-sm font-medium ${tab === 'accessories' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>
          Accessories
        </button>
        <button onClick={() => changeTab('sold_accessories')} className={`px-4 py-2 text-sm font-medium ${tab === 'sold_accessories' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>
          Sold Accessories
        </button>
      </div>

      <StatCardsRow
        cards={[
          {
            label: 'Total Current Stock',
            value: statCounts.totalCurrent,
            active: tab === 'current' && !statusFilter,
            onClick: () => { changeTab('current'); setStatusFilter('') },
          },
          {
            label: 'Ready for Sale',
            value: statCounts.readyForSale,
            active: tab === 'current' && statusFilter === 'ready_for_sale',
            onClick: () => { changeTab('current'); setStatusFilter('ready_for_sale') },
          },
          {
            label: 'QC Pending',
            value: statCounts.qcPending,
            active: tab === 'current' && statusFilter === 'qc_pending',
            onClick: () => { changeTab('current'); setStatusFilter('qc_pending') },
          },
          {
            label: 'Sold',
            value: statCounts.totalSold,
            active: tab === 'sold',
            onClick: () => changeTab('sold'),
          },
          ...(isOwner ? [
            { label: 'Missing PO', value: missingPoCount },
            { label: 'Missing Invoice', value: missingInvoiceCount },
          ] : []),
        ]}
      />

      <div className="flex gap-4 mb-4 flex-wrap">
        {tab === 'current' && (
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border p-2 rounded">
            <option value="">All Current Statuses</option>
            <option value="qc_pending">QC Pending</option>
            <option value="qc_passed">QC Passed</option>
            <option value="ready_for_sale">Ready for Sale</option>
            <option value="faulty">Faulty</option>
          </select>
        )}
        <input
          type="text"
          placeholder={
            tab === 'sold_accessories' ? 'Search item, customer, or invoice...' :
            tab === 'accessories' ? 'Search accessories...' :
            'Search asset, serial, SKU, or spec (e.g. 16GB, i5)...'
          }
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="border p-2 rounded"
        />
        {(tab === 'current' || tab === 'sold' || tab === 'sold_accessories') && (
          <>
            <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="border p-2 rounded">
              <option value="">All Months</option>
              {MONTH_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="border p-2 rounded">
              <option value="">All Years</option>
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </>
        )}
        {(statusFilter || searchTerm || monthFilter || yearFilter) && (
          <button onClick={() => { setStatusFilter(''); setSearchTerm(''); setMonthFilter(''); setYearFilter('') }} className="text-sm text-gray-500 underline self-center">
            Clear filters
          </button>
        )}
        {isOwner && (tab === 'current' || tab === 'sold') && selected.size > 0 && (
          <>
            <button onClick={() => setShowPoForm(true)} className="bg-blue-600 text-white px-4 py-2 rounded text-sm">
              Create PO from Selected ({selected.size})
            </button>
            {/* Selection now persists across tab/filter/page changes (so a Current +
                Sold combo can be built into one PO) -- give an explicit way to reset it
                rather than relying on the old implicit "any fetch clears it" behavior. */}
            <button onClick={() => setSelected(new Map())} className="text-sm text-gray-500 underline self-center">
              Clear selection
            </button>
          </>
        )}
        {tab !== 'sold_accessories' && tab !== 'accessories' && (
          <div className="hidden md:block ml-auto">
            <ColumnToggle columns={OPTIONAL_COLUMNS} visible={visibleColumns} onChange={setVisibleColumns} />
          </div>
        )}
      </div>

      {showPoForm && (
        <CreatePoForm
          assetIds={[...selected.keys()]}
          assets={[...selected.values()]}
          onClose={() => setShowPoForm(false)}
          onDone={() => { setShowPoForm(false); setSelected(new Map()); fetchAssets(); fetchCounts() }}
        />
      )}

      {fixSkuAssetId && (
        <FixSkuDialog
          assetId={fixSkuAssetId}
          onClose={() => setFixSkuAssetId(null)}
          onReassigned={() => { fetchAssets(); fetchCounts() }}
        />
      )}

      {forceDeleteAsset && (
        <ReasonConfirmDialog
          open
          onOpenChange={(o) => !o && setForceDeleteAsset(null)}
          title={`Delete ${forceDeleteAsset.label}?`}
          description="Permanently deletes this unit. Only allowed when it has no active sale, PO, or repair job attached -- if it does, resolve that first."
          confirmLabel="Delete"
          error={forceDeleteErr}
          onConfirm={handleForceDelete}
        />
      )}

      {addPaymentAsset && (
        <AddPaymentDialog
          saleId={addPaymentAsset.saleId}
          balanceDue={addPaymentAsset.balanceDue}
          onClose={() => setAddPaymentAsset(null)}
          onSaved={() => { fetchAssets(); fetchCounts() }}
        />
      )}

      {editSaleId && (
        <EditSaleDialog
          saleId={editSaleId}
          onClose={() => setEditSaleId(null)}
          onSaved={() => { fetchSoldAccessories(); fetchCounts() }}
        />
      )}

      {loading ? (
        <div>Loading {tab === 'sold_accessories' ? 'sales' : tab === 'accessories' ? 'accessories' : 'assets'}…</div>
      ) : tab === 'accessories' ? (
        <div className="hidden md:block overflow-x-auto">
          <table className="min-w-full border text-sm">
            <thead>
              <tr>
                <th className="border p-2 w-10 text-right">#</th>
                <th className="border p-2">Name</th>
                <th className="border p-2">Category</th>
                <th className="border p-2">Brand</th>
                <th className="border p-2 text-right">In Stock</th>
                <th className="border p-2 text-right">Selling Price</th>
                <th className="border p-2" title="Vendor/price optionally logged by whoever received the stock -- visible to everyone.">Last Purchase</th>
                {isOwner && <th className="border p-2 text-right">Cost</th>}
                {isOwner && <th className="border p-2">Last Vendor (PO)</th>}
                {isOwner && <th className="border p-2">Awaiting PO</th>}
                <th className="border p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accessoryStock.length === 0 && <EmptyTableRow colSpan={isOwner ? 11 : 8} message="No accessories in stock." />}
              {accessoryStock.map((sku, idx) => (
                <tr key={sku.id}>
                  <td className="border p-2 text-right tabular-nums text-gray-400">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                  <td className="border p-2">
                    <Link href={`/dashboard/accessories/${sku.id}`} className="text-blue-600 underline">
                      {sku.sku_description || sku.model_name || sku.full_sku_code}
                    </Link>
                  </td>
                  <td className="border p-2">{sku.category}</td>
                  <td className="border p-2">{sku.brand || '—'}</td>
                  <td className="border p-2 text-right tabular-nums">{sku.quantity_in_stock}</td>
                  <td className="border p-2 text-right tabular-nums">{sku.selling_price_default ? `₹${sku.selling_price_default.toFixed(2)}` : '—'}</td>
                  <td className="border p-2 text-xs">
                    {sku.last_entry_vendor ? (
                      <>
                        {sku.last_entry_vendor}
                        {sku.last_entry_price != null && <span className="text-gray-500"> @ ₹{sku.last_entry_price.toFixed(2)}</span>}
                        {sku.last_entry_date && <div className="text-gray-400">{sku.last_entry_date.slice(0, 10)}</div>}
                      </>
                    ) : '—'}
                  </td>
                  {isOwner && <td className="border p-2 text-right tabular-nums">{sku.base_cost != null ? `₹${sku.base_cost.toFixed(2)}` : '—'}</td>}
                  {isOwner && <td className="border p-2">{sku.last_vendor || '—'}</td>}
                  {isOwner && (
                    <td className="border p-2 text-center">
                      {sku.needs_po_qty ? <span className="text-amber-600">{sku.needs_po_qty} received, no PO</span> : <span className="text-green-600">✓</span>}
                    </td>
                  )}
                  <td className="border p-2">
                    <button onClick={() => router.push(`/dashboard/entry/sell?accessory_id=${sku.id}&return_to=${encodeURIComponent(returnToPath)}`)} className="text-green-700 underline text-xs">
                      Sell
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === 'sold_accessories' ? (
        <div className="hidden md:block overflow-x-auto">
          <table className="min-w-full border text-sm">
            <thead>
              <tr>
                <th className="border p-2 w-10 text-right">#</th>
                <th className="border p-2">Date</th>
                <th className="border p-2">Item</th>
                <th className="border p-2 text-right">Qty</th>
                <th className="border p-2 text-right">Sale Total</th>
                <th className="border p-2">Payment</th>
                <th className="border p-2 text-right">Amount Paid</th>
                <th className="border p-2">Received Into</th>
                <th className="border p-2">Customer</th>
                <th className="border p-2">Sold By</th>
                <th className="border p-2">Invoice</th>
                {canEdit && <th className="border p-2">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {soldAccessories.length === 0 && <EmptyTableRow colSpan={12} message="No accessory sales found." />}
              {soldAccessories.map((sale, idx) => (
                <tr key={sale.id}>
                  <td className="border p-2 text-right tabular-nums text-gray-400">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                  <td className="border p-2">{sale.sale_date?.slice(0, 10)}</td>
                  <td className="border p-2">
                    {sale.sku_description || sale.full_sku_code}
                    {sale.sku_description && sale.full_sku_code && (
                      <span className="text-gray-400"> · {sale.full_sku_code}</span>
                    )}
                  </td>
                  <td className="border p-2 text-right tabular-nums">{sale.accessory_quantity}</td>
                  <td className="border p-2 text-right tabular-nums">₹{sale.sale_total?.toFixed(2)}</td>
                  <td className="border p-2 capitalize">{sale.payment_status}</td>
                  <td className="border p-2 text-right tabular-nums">₹{sale.amount_paid?.toFixed(2)}</td>
                  <td className="border p-2">{sale.payment_account || '—'}</td>
                  <td className="border p-2">{sale.customer_name || '—'}</td>
                  <td className="border p-2">{sale.sold_by || '—'}</td>
                  <td className="border p-2">
                    {sale.finalized ? <span className="text-green-600">✓ {sale.invoice_number}</span> : '—'}
                  </td>
                  {canEdit && (
                    <td className="border p-2">
                      <button onClick={() => setEditSaleId(sale.id)} className="text-blue-600 underline text-xs">Edit</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="hidden md:block overflow-x-auto">
          <table className="min-w-full border text-sm">
            <thead>
              <tr>
                {isOwner && (tab === 'current' || tab === 'sold') && (
                  <th className="border p-2 w-8 text-center">
                    <Checkbox
                      checked={
                        selectableIds.length === 0
                          ? false
                          : visibleSelectedCount === selectableIds.length
                          ? true
                          : visibleSelectedCount > 0
                          ? 'indeterminate'
                          : false
                      }
                      onCheckedChange={toggleSelectAll}
                    />
                  </th>
                )}
                <th className="border p-2 w-10 text-right">#</th>
                <th className="border p-2 cursor-pointer select-none" onClick={() => toggleSort('asset_number')}>
                  Asset / Serial{sortIndicator('asset_number')}
                </th>
                {visibleColumns.entryDate && <th className="border p-2">Entry Date</th>}
                {visibleColumns.purchaseDate && <th className="border p-2">Purchase Date</th>}
                {tab === 'sold' && visibleColumns.soldDate && <th className="border p-2 cursor-pointer select-none" onClick={() => toggleSort('sold_at')}>Sold{sortIndicator('sold_at')}</th>}
                {visibleColumns.sku && <th className="border p-2">SKU</th>}
                <th className="border p-2">Description</th>
                <th className="border p-2 cursor-pointer select-none" onClick={() => toggleSort('status')}>
                  Status{sortIndicator('status')}
                </th>
                {visibleColumns.grade && <th className="border p-2">Grade</th>}
                {isOwner && tab === 'current' && visibleColumns.po && <th className="border p-2">PO</th>}
                {isOwner && tab === 'current' && visibleColumns.vendorCost && <th className="border p-2">Vendor / Cost</th>}
                {tab === 'sold' && visibleColumns.customer && <th className="border p-2">Customer</th>}
                {tab === 'sold' && visibleColumns.saleTotal && <th className="border p-2">Sale Total</th>}
                {tab === 'sold' && visibleColumns.bundle && <th className="border p-2">Bundle</th>}
                {tab === 'sold' && <th className="border p-2">Payment</th>}
                {isOwner && tab === 'sold' && visibleColumns.invoice && <th className="border p-2">Invoice</th>}
                {canEdit && <th className="border p-2">Fix SKU</th>}
                {(tab === 'current' || tab === 'sold') && <th className="border p-2">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {displayedAssets.length === 0 && <EmptyTableRow colSpan={20} message="No assets found." />}
              {displayedAssets.map((asset, idx) => (
                <tr key={asset.id}>
                  {isOwner && (tab === 'current' || tab === 'sold') && (
                    <td className="border p-2 w-8 text-center">
                      {!asset.po_id && (
                        <Checkbox checked={selected.has(asset.id)} onCheckedChange={() => toggleSelectOne(asset)} />
                      )}
                    </td>
                  )}
                  <td className="border p-2 text-right tabular-nums text-gray-400">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                  <td className="border p-2">
                    <Link href={`/dashboard/stock/${asset.id}?return_to=${encodeURIComponent(returnToPath)}`} className="text-blue-600 underline">
                      {identifier(asset)}
                    </Link>
                    {asset.under_repair_job_number && (
                      <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-xs whitespace-nowrap" title={`Repair job ${asset.under_repair_job_number}`}>
                        Under Repair
                      </span>
                    )}
                  </td>
                  {visibleColumns.entryDate && <td className="border p-2">{asset.created_at?.slice(0, 10) || '—'}</td>}
                  {visibleColumns.purchaseDate && <td className="border p-2">{asset.po_date?.slice(0, 10) || '—'}</td>}
                  {tab === 'sold' && visibleColumns.soldDate && <td className="border p-2">{asset.sold_at?.slice(0, 10)}</td>}
                  {visibleColumns.sku && <td className="border p-2">{asset.sku_code}</td>}
                  <td className="border p-2">
                    {buildConfigSummary(asset.category, asset.specifications, templates) || asset.description}
                    {asset.asset_number && asset.serial_number && (
                      <span className="text-gray-400"> · SN: {asset.serial_number}</span>
                    )}
                  </td>
                  <td className="border p-2"><StatusBadge tone={toneFor(ASSET_STATUS_TONES, asset.status)}>{asset.status.replace(/_/g, ' ')}</StatusBadge></td>
                  {visibleColumns.grade && <td className="border p-2">{asset.qc_grade || '—'}</td>}
                  {isOwner && tab === 'current' && visibleColumns.po && (
                    <td className="border p-2 text-center">
                      {asset.po_id ? <span className="text-green-600">✓ {asset.po_number}</span> : <span className="text-amber-600">✗ missing</span>}
                    </td>
                  )}
                  {isOwner && tab === 'current' && visibleColumns.vendorCost && (
                    <td className="border p-2 text-right tabular-nums">
                      {asset.vendor_name ? `${asset.vendor_name} · ₹${asset.unit_price?.toFixed(2)}` : '—'}
                    </td>
                  )}
                  {tab === 'sold' && visibleColumns.customer && <td className="border p-2">{asset.customer_name || '—'}</td>}
                  {tab === 'sold' && visibleColumns.saleTotal && <td className="border p-2 text-right tabular-nums">₹{asset.sale_total?.toFixed(2)}</td>}
                  {tab === 'sold' && visibleColumns.bundle && (
                    <td className="border p-2">
                      {asset.bundled_accessories_display && asset.bundled_accessories_display.length > 0
                        ? asset.bundled_accessories_display.map((b, i) => (
                            <span key={i} className="block">{b.name}{b.quantity > 1 ? ` ×${b.quantity}` : ''}</span>
                          ))
                        : '—'}
                    </td>
                  )}
                  {tab === 'sold' && (
                    <td className="border p-2">
                      <div className="capitalize">{asset.payment_status || '—'}</div>
                      {typeof asset.amount_paid === 'number' && (
                        <div className="text-xs text-gray-500 tabular-nums">₹{asset.amount_paid.toFixed(2)} of ₹{(asset.sale_total || 0).toFixed(2)}</div>
                      )}
                    </td>
                  )}
                  {isOwner && tab === 'sold' && visibleColumns.invoice && (
                    <td className="border p-2 text-center">
                      {asset.invoice_finalized ? (
                        <span className="text-green-600">✓ {asset.invoice_number}</span>
                      ) : (
                        <button onClick={() => generateInvoice(asset.id)} disabled={!!pendingRowKey} className="text-amber-700 underline text-xs disabled:opacity-50 inline-flex items-center gap-1">
                          {pendingRowKey === `${asset.id}:invoice` && <Loader2 className="size-3 animate-spin" />}
                          Generate Invoice
                        </button>
                      )}
                    </td>
                  )}
                  {canEdit && (
                    <td className="border p-2 space-x-2">
                      <button onClick={() => setFixSkuAssetId(asset.id)} className="text-blue-600 underline text-xs">
                        Fix SKU
                      </button>
                      {isOwner && tab === 'current' && !asset.po_id && (
                        <button
                          onClick={() => deleteAsset(asset, identifier(asset))}
                          disabled={!!pendingRowKey}
                          className="text-red-600 underline text-xs disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          {pendingRowKey === `${asset.id}:delete` && <Loader2 className="size-3 animate-spin" />}
                          Delete
                        </button>
                      )}
                      {isOwner && tab === 'sold' && (
                        <button
                          onClick={() => { setForceDeleteErr(''); setForceDeleteAsset({ id: asset.id, label: identifier(asset) }) }}
                          className="text-red-600 underline text-xs"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                  {tab === 'current' && (
                    <td className="border p-2 space-x-2">
                      {['ready_for_sale', 'qc_passed'].includes(asset.status) && (
                        <button onClick={() => router.push(`/dashboard/entry/sell?asset_id=${asset.id}&return_to=${encodeURIComponent(returnToPath)}`)} className="text-green-700 underline text-xs">
                          Sell
                        </button>
                      )}
                      {showServiceActions && (
                        <button onClick={() => router.push(`/dashboard/entry/service?subtype=repair&asset_id=${asset.id}&return_to=${encodeURIComponent(returnToPath)}`)} className="text-blue-700 underline text-xs">
                          Repair
                        </button>
                      )}
                    </td>
                  )}
                  {tab === 'sold' && (
                    <td className="border p-2 space-x-2">
                      {asset.sale_id && asset.payment_status !== 'paid' && (
                        <button
                          onClick={() => setAddPaymentAsset({ saleId: asset.sale_id!, balanceDue: (asset.sale_total || 0) - (asset.amount_paid || 0) })}
                          className="text-green-700 underline text-xs"
                        >
                          Add Payment
                        </button>
                      )}
                      {showServiceActions && (
                        <button onClick={() => router.push(`/dashboard/entry/service?subtype=return&asset_id=${asset.id}&return_to=${encodeURIComponent(returnToPath)}`)} className="text-amber-700 underline text-xs">
                          Return
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Mobile card list -- this page is checked from a phone often enough (Live
          Stock especially) that a 14-column table's horizontal scroll isn't a good
          enough answer below md; same data as the table, one card per unit. */}
      {!loading && tab === 'sold_accessories' && (
        <div className="md:hidden space-y-2">
          {soldAccessories.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">No accessory sales found.</p>
          )}
          {soldAccessories.map((sale) => (
            <div key={sale.id} className="border rounded-lg p-3 space-y-2">
              <div className="min-w-0">
                <div className="font-medium break-words">{sale.sku_description || sale.full_sku_code}</div>
                <div className="text-xs text-gray-500">{sale.full_sku_code} · Qty {sale.accessory_quantity}</div>
              </div>
              <div className="text-xs text-gray-600 space-y-0.5">
                <div>Sold {sale.sale_date?.slice(0, 10)} to {sale.customer_name || '—'}</div>
                <div className="tabular-nums">₹{sale.sale_total?.toFixed(2)} · {sale.payment_status} · ₹{sale.amount_paid?.toFixed(2)} paid</div>
                {sale.sold_by && <div>Sold by {sale.sold_by}</div>}
                <div>{sale.finalized ? <span className="text-green-600">✓ {sale.invoice_number}</span> : 'Invoice pending'}</div>
              </div>
              {canEdit && (
                <div className="pt-1 border-t">
                  <button onClick={() => setEditSaleId(sale.id)} className="text-blue-600 underline text-xs">Edit</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {!loading && tab === 'accessories' && (
        <div className="md:hidden space-y-2">
          {accessoryStock.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">No accessories in stock.</p>
          )}
          {accessoryStock.map((sku) => (
            <div key={sku.id} className="border rounded-lg p-3 space-y-2">
              <div className="min-w-0">
                <Link href={`/dashboard/accessories/${sku.id}`} className="text-blue-600 underline font-medium break-words">
                  {sku.sku_description || sku.model_name || sku.full_sku_code}
                </Link>
                <div className="text-xs text-gray-500">{sku.category}{sku.brand ? ` · ${sku.brand}` : ''}</div>
              </div>
              <div className="text-sm tabular-nums">
                In stock: {sku.quantity_in_stock}
                {sku.selling_price_default != null && ` · ₹${sku.selling_price_default.toFixed(2)}`}
              </div>
              {sku.last_entry_vendor && (
                <div className="text-xs text-gray-600">
                  Last purchase: {sku.last_entry_vendor}{sku.last_entry_price != null && ` @ ₹${sku.last_entry_price.toFixed(2)}`}
                  {sku.last_entry_date && ` (${sku.last_entry_date.slice(0, 10)})`}
                </div>
              )}
              {isOwner && (
                <div className="text-xs text-gray-600 space-y-0.5">
                  <div>Cost: {sku.base_cost != null ? `₹${sku.base_cost.toFixed(2)}` : '—'}{sku.last_vendor ? ` · ${sku.last_vendor}` : ''}</div>
                  {!!sku.needs_po_qty && <div className="text-amber-600">{sku.needs_po_qty} received, no PO yet</div>}
                </div>
              )}
              <div className="pt-1 border-t">
                <button onClick={() => router.push(`/dashboard/entry/sell?accessory_id=${sku.id}&return_to=${encodeURIComponent(returnToPath)}`)} className="text-green-700 underline text-xs">
                  Sell
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {!loading && tab !== 'sold_accessories' && tab !== 'accessories' && (
        <div className="md:hidden space-y-2">
          {displayedAssets.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">No assets found.</p>
          )}
          {displayedAssets.map((asset) => (
            <div key={asset.id} className="border rounded-lg p-3 space-y-2">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <Link href={`/dashboard/stock/${asset.id}?return_to=${encodeURIComponent(returnToPath)}`} className="text-blue-600 underline font-medium break-all">
                    {identifier(asset)}
                  </Link>
                  <div className="text-xs text-gray-500">{asset.sku_code}</div>
                </div>
                {isOwner && (tab === 'current' || tab === 'sold') && !asset.po_id && (
                  <Checkbox checked={selected.has(asset.id)} onCheckedChange={() => toggleSelectOne(asset)} />
                )}
              </div>
              <div className="text-sm">
                {buildConfigSummary(asset.category, asset.specifications, templates) || asset.description}
                {asset.asset_number && asset.serial_number && (
                  <span className="text-gray-400"> · SN: {asset.serial_number}</span>
                )}
              </div>
              {asset.created_at || asset.po_date ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  {asset.created_at && <span>Added {asset.created_at.slice(0, 10)}</span>}
                  {asset.po_date && <span>Purchased {asset.po_date.slice(0, 10)}</span>}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={toneFor(ASSET_STATUS_TONES, asset.status)}>{asset.status.replace(/_/g, ' ')}</StatusBadge>
                {asset.qc_grade && <span className="text-xs text-gray-500">Grade {asset.qc_grade}</span>}
                {asset.under_repair_job_number && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-xs">Under Repair</span>
                )}
              </div>
              {tab === 'sold' && (
                <div className="text-xs text-gray-600 space-y-0.5">
                  <div>Sold {asset.sold_at?.slice(0, 10)} to {asset.customer_name || '—'}</div>
                  <div className="tabular-nums">₹{asset.sale_total?.toFixed(2)}</div>
                  <div className="capitalize">
                    {asset.payment_status || '—'}
                    {typeof asset.amount_paid === 'number' && ` · ₹${asset.amount_paid.toFixed(2)} of ₹${(asset.sale_total || 0).toFixed(2)}`}
                  </div>
                  {asset.bundled_accessories_display && asset.bundled_accessories_display.length > 0 && (
                    <div>
                      Bundled: {asset.bundled_accessories_display.map((b) => `${b.name}${b.quantity > 1 ? ` ×${b.quantity}` : ''}`).join(', ')}
                    </div>
                  )}
                  {isOwner && (
                    <div>{asset.invoice_finalized ? <span className="text-green-600">✓ {asset.invoice_number}</span> : 'Invoice pending'}</div>
                  )}
                </div>
              )}
              {isOwner && tab === 'current' && (
                <div className="text-xs text-gray-600">
                  {asset.po_id ? <span className="text-green-600">✓ PO {asset.po_number}</span> : <span className="text-amber-600">✗ missing PO</span>}
                  {asset.vendor_name && ` · ${asset.vendor_name} · ₹${asset.unit_price?.toFixed(2)}`}
                </div>
              )}
              <div className="flex flex-wrap gap-3 pt-1 border-t">
                {canEdit && (
                  <button onClick={() => setFixSkuAssetId(asset.id)} className="text-blue-600 underline text-xs">Fix SKU</button>
                )}
                {tab === 'current' && ['ready_for_sale', 'qc_passed'].includes(asset.status) && (
                  <button onClick={() => router.push(`/dashboard/entry/sell?asset_id=${asset.id}&return_to=${encodeURIComponent(returnToPath)}`)} className="text-green-700 underline text-xs">Sell</button>
                )}
                {tab === 'current' && showServiceActions && (
                  <button onClick={() => router.push(`/dashboard/entry/service?subtype=repair&asset_id=${asset.id}&return_to=${encodeURIComponent(returnToPath)}`)} className="text-blue-700 underline text-xs">Repair</button>
                )}
                {tab === 'sold' && asset.sale_id && asset.payment_status !== 'paid' && (
                  <button
                    onClick={() => setAddPaymentAsset({ saleId: asset.sale_id!, balanceDue: (asset.sale_total || 0) - (asset.amount_paid || 0) })}
                    className="text-green-700 underline text-xs"
                  >
                    Add Payment
                  </button>
                )}
                {tab === 'sold' && showServiceActions && (
                  <button onClick={() => router.push(`/dashboard/entry/service?subtype=return&asset_id=${asset.id}&return_to=${encodeURIComponent(returnToPath)}`)} className="text-amber-700 underline text-xs">Return</button>
                )}
                {isOwner && tab === 'current' && !asset.po_id && (
                  <button onClick={() => deleteAsset(asset, identifier(asset))} disabled={!!pendingRowKey} className="text-red-600 underline text-xs disabled:opacity-50">Delete</button>
                )}
                {isOwner && tab === 'sold' && (
                  <button onClick={() => { setForceDeleteErr(''); setForceDeleteAsset({ id: asset.id, label: identifier(asset) }) }} className="text-red-600 underline text-xs">Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}
    </div>
  )
}

function CreatePoForm({ assetIds, assets, onClose, onDone }: {
  assetIds: string[]
  assets: AssetRow[]
  onClose: () => void
  onDone: () => void
}) {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [vendorId, setVendorId] = useState('')
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10))
  const [purchasedByType, setPurchasedByType] = useState('Digitalbluez')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const soldCount = useMemo(() => assets.filter(a => a.status === 'sold').length, [assets])

  // One cost/GST input per distinct SKU among the selected units.
  const skuGroups = useMemo(() => {
    const map = new Map<string, { sku_code: string; count: number }>()
    for (const a of assets) {
      const key = a.sku_code
      if (!map.has(key)) map.set(key, { sku_code: a.sku_code, count: 0 })
      map.get(key)!.count++
    }
    return [...map.entries()]
  }, [assets])

  const [costInputs, setCostInputs] = useState<Record<string, { cost_price: number; gst_percentage: number }>>({})

  useEffect(() => {
    apiFetch('/api/vendors').then(res => res.json()).then(setVendors).catch(() => {})
  }, [])

  const handleSubmit = async () => {
    setError('')
    if (!vendorId) { setError('Select a vendor.'); return }

    // Map sku_code -> sku_id via the first matching asset (assets carry sku_code, not
    // sku_id, in this flattened response -- resolve via a quick lookup).
    const skuCodeToId: Record<string, string> = {}
    for (const a of assets as any[]) {
      if (a.sku_id) skuCodeToId[a.sku_code] = a.sku_id
    }

    const cost_inputs = skuGroups.map(([skuCode]) => ({
      sku_id: skuCodeToId[skuCode],
      cost_price: costInputs[skuCode]?.cost_price ?? 0,
      gst_percentage: costInputs[skuCode]?.gst_percentage ?? 18,
    }))

    if (cost_inputs.some(c => !c.sku_id)) {
      setError('Could not resolve one or more SKUs -- please refresh and try again.')
      return
    }

    setSubmitting(true)
    try {
      const res = await apiFetch('/api/purchase-orders/from-intake', {
        method: 'POST',
        body: JSON.stringify({
          asset_ledger_ids: assetIds,
          vendor_id: vendorId,
          po_date: poDate,
          purchased_by_type: purchasedByType,
          cost_inputs,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to create PO.')
      onDone()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="border rounded p-4 mb-4 bg-gray-50">
      <h3 className="font-semibold mb-2">Create Purchase Order from {assetIds.length} selected unit(s)</h3>
      {soldCount > 0 && (
        <div className="text-xs text-gray-600 mb-2">
          Includes {soldCount} already-sold unit{soldCount > 1 ? 's' : ''} -- their sale record is unaffected, this only attaches the purchase paperwork (vendor/cost/GST).
        </div>
      )}
      {error && <div className="text-red-600 text-sm mb-2">{error}</div>}
      <div className="grid grid-cols-3 gap-4 mb-3">
        <div>
          <label className="block text-sm font-medium mb-1">Vendor</label>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="border p-2 w-full rounded">
            <option value="">Select vendor...</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.company_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">PO Date</label>
          <input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} className="border p-2 w-full rounded" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Purchased By</label>
          <select value={purchasedByType} onChange={(e) => setPurchasedByType(e.target.value)} className="border p-2 w-full rounded">
            <option value="Digitalbluez">Digitalbluez</option>
            <option value="Techtenth">Techtenth</option>
            <option value="Cash">Cash</option>
          </select>
        </div>
      </div>

      <table className="min-w-full border text-sm mb-3">
        <thead>
          <tr><th className="border p-2">SKU</th><th className="border p-2">Qty</th><th className="border p-2">Unit Cost (₹)</th><th className="border p-2">GST %</th></tr>
        </thead>
        <tbody>
          {skuGroups.map(([skuCode, info]) => (
            <tr key={skuCode}>
              <td className="border p-2">{skuCode}</td>
              <td className="border p-2">{info.count}</td>
              <td className="border p-2">
                <input
                  type="number"
                  className="border p-1 w-24 rounded"
                  value={costInputs[skuCode]?.cost_price ?? ''}
                  onChange={(e) => setCostInputs(prev => ({ ...prev, [skuCode]: { ...prev[skuCode], cost_price: Number(e.target.value), gst_percentage: prev[skuCode]?.gst_percentage ?? 18 } }))}
                />
              </td>
              <td className="border p-2">
                <input
                  type="number"
                  className="border p-1 w-20 rounded"
                  value={costInputs[skuCode]?.gst_percentage ?? 18}
                  onChange={(e) => setCostInputs(prev => ({ ...prev, [skuCode]: { ...prev[skuCode], gst_percentage: Number(e.target.value), cost_price: prev[skuCode]?.cost_price ?? 0 } }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded border">Cancel</button>
        <button onClick={handleSubmit} disabled={submitting} className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50 inline-flex items-center gap-1.5">
          {submitting && <Loader2 className="size-4 animate-spin" />}
          {submitting ? 'Creating...' : 'Create PO'}
        </button>
      </div>
    </div>
  )
}

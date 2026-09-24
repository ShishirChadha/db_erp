'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Loader2, ArrowLeft } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useIsDesktopViewport } from '@/lib/useIsDesktopViewport'
import { useRole } from '@/lib/auth/useRole'
import { StatCardsRow } from '@/components/StatCardsRow'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Pagination } from '@/components/Pagination'
import { StatusBadge } from '@/components/StatusBadge'
import { ASSET_STATUS_TONES, PAYMENT_STATUS_TONES, toneFor } from '@/lib/status-styles'
import { CustomerNameLink } from '@/components/CustomerNameLink'
import type { CustomerSummary } from '@/lib/customer-summary'
import { buildConfigSummary, ConfigSummaryTemplate } from '@/lib/sku-config-summary'
import { computeFromUnitPrice, computeFromLineTotal } from '@/lib/po-gst-calc'
import { cn } from '@/lib/utils'
import { AssetQCPage } from '@/app/dashboard/stock/[id]/page'

// Modal dialogs only render behind a click (gated by a state flag) -- code-split
// out of the initial bundle rather than shipped unconditionally.
const FixSkuDialog = dynamic(() => import('@/components/FixSkuDialog').then(m => m.FixSkuDialog), { ssr: false })
const ReasonConfirmDialog = dynamic(() => import('@/components/ReasonConfirmDialog').then(m => m.ReasonConfirmDialog), { ssr: false })
const AddPaymentDialog = dynamic(() => import('@/components/AddPaymentDialog').then(m => m.AddPaymentDialog), { ssr: false })
const EditSaleDialog = dynamic(() => import('@/components/EditSaleDialog').then(m => m.EditSaleDialog), { ssr: false })
const RecordZohoInvoiceDialog = dynamic(() => import('@/components/RecordZohoInvoiceDialog').then(m => m.RecordZohoInvoiceDialog), { ssr: false })
import { AccessoryDetailPage } from '@/app/dashboard/accessories/[id]/page'

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
  // Set only when this unit's SKU was reassigned (Change SKU) after purchase --
  // sku_code/description above are the CURRENT/effective spec; these are what it
  // was actually purchased as, so the divergence stays visible instead of hidden.
  purchased_sku_code?: string | null
  purchased_description?: string | null
  under_repair_job_number?: string | null
  unit_price?: number
  gst_percentage?: number
  po_number?: string
  po_date?: string
  vendor_name?: string
  purchased_by_type?: string
  customer_id?: string | null
  customer_name?: string
  customer_summary?: CustomerSummary | null
  sale_id?: string
  sale_total?: number
  invoice_finalized?: boolean
  invoice_number?: string
  invoice_mode?: 'erp' | 'external'
  payment_status?: string
  amount_paid?: number
  payment_date?: string | null
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
  customer_id?: string | null
  customer_name: string | null
  customer_summary?: CustomerSummary | null
  full_sku_code: string
  sku_description: string | null
  accessory_quantity: number
  sale_total: number
  payment_status: string
  amount_paid: number
  payment_date?: string | null
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
  last_entry_gst_percentage?: number | null
  last_entry_date?: string | null
}

const CURRENT_STATUSES = ['draft', 'reserved', 'received', 'in_stock', 'qc_pending', 'qc_passed', 'ready_for_sale', 'faulty', 'rma_sent', 'rma_returned', 'on_rent']

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
  { key: 'paymentDate', label: 'Payment Date' },
  { key: 'bundle', label: 'Bundle' },
  { key: 'invoice', label: 'Invoice' },
] as const
type ColumnKey = typeof OPTIONAL_COLUMNS[number]['key']

// An asset_number only ever exists once a real PO has been attached (see
// CLAUDE.md) -- a unit can be QC'd/sold entirely by serial_number before
// that happens, and once it does, the serial number is still the physical
// identifier staff read off the unit itself, so both stay visible rather
// than the asset number silently hiding it.
function identifier(asset: AssetRow) {
  if (asset.asset_number) return asset.serial_number ? `${asset.asset_number} · SN: ${asset.serial_number}` : asset.asset_number
  return asset.serial_number ? `SN: ${asset.serial_number}` : '— no tag yet —'
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
  const isDesktop = useIsDesktopViewport()
  const returnToPath = `${pathname}?tab=${tab}`
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [soldAccessories, setSoldAccessories] = useState<SoldAccessoryRow[]>([])
  const [accessoryStock, setAccessoryStock] = useState<AccessoryStockRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  // searchInput updates on every keystroke (so the box itself feels responsive);
  // searchTerm only catches up 300ms after typing stops, and is what actually drives
  // the fetch effects below -- without this, every keystroke fired its own full
  // request (each doing several sequential DB round trips server-side), which piled up
  // overlapping in-flight requests and was the real cause of "search is slow / sometimes
  // errors" rather than any single request being slow on its own.
  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(searchInput), 300)
    return () => clearTimeout(timer)
  }, [searchInput])
  const [monthFilter, setMonthFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear()
    return Array.from({ length: 8 }, (_, i) => currentYear - i)
  }, [])
  const [sortField, setSortField] = useState<SortField>(TAB_DEFAULT_SORT[initialTab === 'sold' ? 'sold' : 'current'].field)
  const [sortOrder, setSortOrder] = useState<SortOrder>(TAB_DEFAULT_SORT[initialTab === 'sold' ? 'sold' : 'current'].order)
  // Sold Accessories has its own date sort toggle (its own route/field, sale_date --
  // not part of SortField/toggleSort, which are asset_ledger-specific).
  const [soldAccOrder, setSoldAccOrder] = useState<SortOrder>('desc')

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
  // Which unit is open in the right-hand detail pane (current/sold tabs' master-detail
  // layout only) -- auto-selects the first row on load/refetch, same pattern as
  // Purchase Orders/Sales/Invoices, but doesn't yank focus away from whatever's
  // already open if it's still present in the refetched page.
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null)
  // Which row is open in the right-hand detail pane for the Accessories/Sold
  // Accessories tabs' own master-detail layouts -- same auto-select-preserving-
  // selection pattern as activeAssetId above.
  const [activeAccessoryId, setActiveAccessoryId] = useState<string | null>(null)
  const [activeSoldAccessoryId, setActiveSoldAccessoryId] = useState<string | null>(null)

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
      const data: AssetRow[] = json.data || []
      setAssets(data)
      setTotal(json.total || 0)
      setActiveAssetId((prev) => (prev && data.some((a) => a.id === prev)) ? prev : (isDesktop ? (data[0]?.id ?? null) : null))
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
      params.set('order', soldAccOrder)
      params.set('page', String(page))
      params.set('limit', String(PAGE_SIZE))

      const res = await apiFetch(`/api/stock/sold-accessories?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch sold accessories')
      const json = await res.json()
      const data: SoldAccessoryRow[] = json.data || []
      setSoldAccessories(data)
      setTotal(json.total || 0)
      setActiveSoldAccessoryId((prev) => (prev && data.some((s) => s.id === prev)) ? prev : (isDesktop ? (data[0]?.id ?? null) : null))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [tab, searchTerm, monthFilter, yearFilter, page, soldAccOrder])

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
      const data: AccessoryStockRow[] = json.data || []
      setAccessoryStock(data)
      setTotal(json.total || 0)
      setActiveAccessoryId((prev) => (prev && data.some((s) => s.id === prev)) ? prev : (isDesktop ? (data[0]?.id ?? null) : null))
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
    // SQL exact counts (see /api/stock's counts=true branch), not full-row fetch
    // + JS .filter().length -- the latter silently plateaus once a bucket exceeds
    // PostgREST's row cap, which real intake volume has already gotten close to.
    const res = await apiFetch(`/api/stock?${sourceParam}&counts=true`)
    if (!res.ok) return
    const counts = await res.json()
    setStatCounts({
      totalCurrent: counts.totalCurrent || 0,
      readyForSale: counts.readyForSale || 0,
      qcPending: counts.qcPending || 0,
      totalSold: counts.totalSold || 0,
    })
    if (isOwner) {
      setMissingPoCount(counts.missingPoCount || 0)
      setMissingInvoiceCount(counts.missingInvoiceCount || 0)
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
  const [zohoSaleId, setZohoSaleId] = useState<string | null>(null)

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

  const sendBackToQc = async (asset: { id: string }, label: string) => {
    if (pendingRowKey) return
    if (!confirm(`Send ${label} back to QC? It will no longer show as Ready for Sale until re-QC'd.`)) return
    setPendingRowKey(`${asset.id}:send-back-to-qc`)
    try {
      const res = await apiFetch(`/api/asset-ledger/${asset.id}/send-back-to-qc`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Failed to send back to QC.')
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

  if (error) return <div className="p-4 text-destructive">Error: {error}</div>

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <h1 className="text-xl font-bold shrink-0" title={subtitle}>{title}</h1>
          <div className="flex border rounded overflow-hidden shrink-0 w-fit">
            <button onClick={() => changeTab('current')} className={`px-3 py-1.5 text-xs font-medium ${tab === 'current' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'}`}>
              Current Stock
            </button>
            <button onClick={() => changeTab('sold')} className={`px-3 py-1.5 text-xs font-medium ${tab === 'sold' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'}`}>
              Sold Stock
            </button>
            <button onClick={() => changeTab('accessories')} className={`px-3 py-1.5 text-xs font-medium ${tab === 'accessories' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'}`}>
              Accessories
            </button>
            <button onClick={() => changeTab('sold_accessories')} className={`px-3 py-1.5 text-xs font-medium ${tab === 'sold_accessories' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'}`}>
              Sold Accessories
            </button>
          </div>
        </div>
        {tab === 'accessories' ? (
          <Link
            href="/dashboard/accessories"
            className="bg-primary text-primary-foreground px-4 py-2 rounded text-sm font-medium shrink-0"
          >
            Manage Accessories →
          </Link>
        ) : (
          <Link
            href={`${tab !== 'current' ? '/dashboard/entry/sell' : '/dashboard/entry/intake'}?return_to=${encodeURIComponent(returnToPath)}`}
            className="bg-primary text-primary-foreground px-4 py-2 rounded text-sm font-medium shrink-0"
          >
            + {tab !== 'current' ? 'New Sale' : 'New Stock Intake'}
          </Link>
        )}
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

      <div className="flex gap-2 mb-2 flex-wrap items-center">
        {tab === 'current' && (
          <Select value={statusFilter || 'all'} onValueChange={(v) => setStatusFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-auto"><SelectValue placeholder="All Current Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Current Statuses</SelectItem>
              <SelectItem value="qc_pending">QC Pending</SelectItem>
              <SelectItem value="qc_passed">QC Passed</SelectItem>
              <SelectItem value="ready_for_sale">Ready for Sale</SelectItem>
              <SelectItem value="faulty">Faulty</SelectItem>
              <SelectItem value="on_rent">On Rent</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Input
          type="text"
          placeholder={
            tab === 'sold_accessories' ? 'Search item, customer, or invoice...' :
            tab === 'accessories' ? 'Search accessories...' :
            tab === 'sold' ? 'Search asset, serial, SKU, customer, or invoice #...' :
            'Search asset, serial, SKU, or spec (e.g. 16GB, i5)...'
          }
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-64"
        />
        {(tab === 'current' || tab === 'sold' || tab === 'sold_accessories') && (
          <>
            <Select value={monthFilter || 'all'} onValueChange={(v) => setMonthFilter(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-auto"><SelectValue placeholder="All Months" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Months</SelectItem>
                {MONTH_OPTIONS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={yearFilter || 'all'} onValueChange={(v) => setYearFilter(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-auto"><SelectValue placeholder="All Years" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {yearOptions.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </>
        )}
        {(statusFilter || searchInput || monthFilter || yearFilter) && (
          <button onClick={() => { setStatusFilter(''); setSearchInput(''); setSearchTerm(''); setMonthFilter(''); setYearFilter('') }} className="text-sm text-muted-foreground underline self-center">
            Clear filters
          </button>
        )}
        {isOwner && (tab === 'current' || tab === 'sold') && selected.size > 0 && (
          <>
            <button onClick={() => setShowPoForm(true)} className="bg-primary text-primary-foreground px-4 py-2 rounded text-sm">
              Create PO from Selected ({selected.size})
            </button>
            {/* Selection now persists across tab/filter/page changes (so a Current +
                Sold combo can be built into one PO) -- give an explicit way to reset it
                rather than relying on the old implicit "any fetch clears it" behavior. */}
            <button onClick={() => setSelected(new Map())} className="text-sm text-muted-foreground underline self-center">
              Clear selection
            </button>
          </>
        )}
        {/* Column toggle no longer gates a wide table -- every tab (current/sold,
            and now accessories/sold_accessories) is master-detail, so the list row
            is intentionally minimal and the detail pane isn't cramped like a table,
            showing every field unconditionally. */}
      </div>

      {showPoForm && (
        <CreatePoForm
          assetIds={[...selected.keys()]}
          assets={[...selected.values()]}
          templates={templates}
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

      {zohoSaleId && (
        <RecordZohoInvoiceDialog
          saleIds={[zohoSaleId]}
          onClose={() => setZohoSaleId(null)}
          onRecorded={() => { setZohoSaleId(null); fetchAssets(); fetchCounts() }}
        />
      )}

      {loading ? (
        <div>Loading {tab === 'sold_accessories' ? 'sales' : tab === 'accessories' ? 'accessories' : 'assets'}…</div>
      ) : tab === 'accessories' ? (
        <div className="flex-1 min-h-[1100px] md:min-h-[500px] lg:min-h-[320px] border rounded overflow-visible lg:overflow-hidden flex">
          {/* List pane -- hidden on mobile once a SKU is open, matching the
              Current/Sold master-detail drill-in navigation. */}
          <div className={cn('w-full md:w-[300px] lg:w-[360px] md:flex-shrink-0 border-r border-border flex flex-col', activeAccessoryId && 'hidden md:flex')}>
            <div className="flex-1 overflow-visible lg:overflow-y-auto">
              {accessoryStock.length === 0 && (
                <p className="p-4 text-center text-sm text-muted-foreground">No accessories in stock.</p>
              )}
              {accessoryStock.map((sku) => (
                <AccessoryStockListItem
                  key={sku.id}
                  sku={sku}
                  active={sku.id === activeAccessoryId}
                  onOpen={() => setActiveAccessoryId(sku.id)}
                />
              ))}
            </div>
          </div>

          {/* Detail pane -- full width on mobile (replaces the list), flex-1 at md+. */}
          <div className={cn('flex-1 min-w-0', !activeAccessoryId && 'hidden md:flex md:items-center md:justify-center')}>
            {activeAccessoryId ? (
              <AccessoryStockDetailPane
                sku={accessoryStock.find(s => s.id === activeAccessoryId)!}
                isOwner={isOwner}
                onBack={() => setActiveAccessoryId(null)}
                onSell={() => router.push(`/dashboard/entry/sell?accessory_id=${activeAccessoryId}&return_to=${encodeURIComponent(returnToPath)}`)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Select an accessory to view details.</p>
            )}
          </div>
        </div>
      ) : tab === 'sold_accessories' ? (
        <div className="flex-1 min-h-[1100px] md:min-h-[500px] lg:min-h-[320px] border rounded overflow-visible lg:overflow-hidden flex">
          {/* List pane -- hidden on mobile once a sale is open. */}
          <div className={cn('w-full md:w-[300px] lg:w-[360px] md:flex-shrink-0 border-r border-border flex flex-col', activeSoldAccessoryId && 'hidden md:flex')}>
            <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() => setSoldAccOrder(prev => (prev === 'desc' ? 'asc' : 'desc'))}
                className="hover:text-foreground"
              >
                Date{soldAccOrder === 'asc' ? ' ↑' : ' ↓'}
              </button>
            </div>
            <div className="flex-1 overflow-visible lg:overflow-y-auto">
              {soldAccessories.length === 0 && (
                <p className="p-4 text-center text-sm text-muted-foreground">No accessory sales found.</p>
              )}
              {soldAccessories.map((sale) => (
                <SoldAccessoryListItem
                  key={sale.id}
                  sale={sale}
                  active={sale.id === activeSoldAccessoryId}
                  onOpen={() => setActiveSoldAccessoryId(sale.id)}
                />
              ))}
            </div>
          </div>

          {/* Detail pane -- full width on mobile (replaces the list), flex-1 at md+. */}
          <div className={cn('flex-1 min-w-0', !activeSoldAccessoryId && 'hidden md:flex md:items-center md:justify-center')}>
            {activeSoldAccessoryId ? (
              <SoldAccessoryDetailPane
                sale={soldAccessories.find(s => s.id === activeSoldAccessoryId)!}
                canEdit={canEdit}
                onBack={() => setActiveSoldAccessoryId(null)}
                onEdit={() => setEditSaleId(activeSoldAccessoryId)}
                onCustomerUpdated={fetchSoldAccessories}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Select a sale to view details.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-[1100px] md:min-h-[500px] lg:min-h-[320px] border rounded overflow-visible lg:overflow-hidden flex">
          {/* List pane -- hidden on mobile once a unit is open, matching the
              Sales/PO/Invoices email-client drill-in navigation; always visible at md+. */}
          <div className={cn('w-full md:w-[300px] lg:w-[360px] md:flex-shrink-0 border-r border-border flex flex-col', activeAssetId && 'hidden md:flex')}>
            <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border text-xs text-muted-foreground">
              {isOwner && (tab === 'current' || tab === 'sold') && (
                <Checkbox
                  title="Select all on page"
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
              )}
              <button type="button" onClick={() => toggleSort('asset_number')} className="hover:text-foreground">
                Asset/Serial{sortIndicator('asset_number')}
              </button>
              <button type="button" onClick={() => toggleSort(tab === 'sold' ? 'sold_at' : 'created_at')} className="hover:text-foreground">
                {tab === 'sold' ? 'Sold' : 'Entry'} Date{sortIndicator(tab === 'sold' ? 'sold_at' : 'created_at')}
              </button>
              <button type="button" onClick={() => toggleSort('status')} className="hover:text-foreground">
                Status{sortIndicator('status')}
              </button>
            </div>
            <div className="flex-1 overflow-visible lg:overflow-y-auto">
              {displayedAssets.length === 0 && (
                <p className="p-4 text-center text-sm text-muted-foreground">No assets found.</p>
              )}
              {displayedAssets.map((asset) => (
                <AssetListItem
                  key={asset.id}
                  asset={asset}
                  tab={tab as 'current' | 'sold'}
                  active={asset.id === activeAssetId}
                  templates={templates}
                  showCheckbox={isOwner && (tab === 'current' || tab === 'sold')}
                  checked={selected.has(asset.id)}
                  onToggleChecked={() => toggleSelectOne(asset)}
                  onOpen={() => setActiveAssetId(asset.id)}
                />
              ))}
            </div>
          </div>

          {/* Detail pane -- full width on mobile (replaces the list), flex-1 at md+. */}
          <div className={cn('flex-1 min-w-0', !activeAssetId && 'hidden md:flex md:items-center md:justify-center')}>
            {activeAssetId ? (
              <AssetDetailPane
                key={activeAssetId}
                asset={displayedAssets.find(a => a.id === activeAssetId) ?? null}
                tab={tab as 'current' | 'sold'}
                idx={displayedAssets.findIndex(a => a.id === activeAssetId)}
                page={page}
                pageSize={PAGE_SIZE}
                canEdit={canEdit}
                isOwner={isOwner}
                showServiceActions={showServiceActions}
                pendingRowKey={pendingRowKey}
                returnToPath={returnToPath}
                templates={templates}
                onBack={() => setActiveAssetId(null)}
                onSell={() => router.push(`/dashboard/entry/sell?asset_id=${activeAssetId}&return_to=${encodeURIComponent(returnToPath)}`)}
                onRepair={() => router.push(`/dashboard/entry/service?subtype=repair&asset_id=${activeAssetId}&return_to=${encodeURIComponent(returnToPath)}`)}
                onReturn={() => router.push(`/dashboard/entry/service?subtype=return&asset_id=${activeAssetId}&return_to=${encodeURIComponent(returnToPath)}`)}
                onSendBackToQc={(asset) => sendBackToQc(asset, identifier(asset))}
                onFixSku={() => setFixSkuAssetId(activeAssetId)}
                onDelete={(asset) => deleteAsset(asset, identifier(asset))}
                onForceDelete={(asset) => { setForceDeleteErr(''); setForceDeleteAsset({ id: asset.id, label: identifier(asset) }) }}
                onAddPayment={(asset) => setAddPaymentAsset({ saleId: asset.sale_id!, balanceDue: (asset.sale_total || 0) - (asset.amount_paid || 0) })}
                onGenerateInvoice={(asset) => generateInvoice(asset.id)}
                onRecordZohoInvoice={(asset) => setZohoSaleId(asset.sale_id!)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Select a unit to view details.</p>
            )}
          </div>
        </div>
      )}

      {/* Pagination -- every tab is now a master-detail list/pane, so mobile is
          handled by the list pane itself (list-only until a row is tapped,
          matching the Sales/PO/Invoices pattern) rather than a separate card block. */}
      {!loading && (
        <div className="mt-2">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </div>
      )}
    </div>
  )
}

// Compact left-pane list row for the Current/Sold master-detail layout -- identifier,
// short description, status badge, tab-appropriate date, and (sold tab) sale total,
// mirroring the visual density of PurchaseOrderListItem/Sales/Invoices list rows
// rather than the old wide table row. Selection checkbox stays inline since bulk
// multi-select-for-PO is load-bearing, not a convenience (see CLAUDE.md/spec).
function AssetListItem({ asset, tab, active, templates, showCheckbox, checked, onToggleChecked, onOpen }: {
  asset: AssetRow
  tab: 'current' | 'sold'
  active: boolean
  templates: ConfigSummaryTemplate[]
  showCheckbox: boolean
  checked: boolean
  onToggleChecked: () => void
  onOpen: () => void
}) {
  const dateStr = tab === 'sold' ? asset.sold_at?.slice(0, 10) : asset.created_at?.slice(0, 10)
  const desc = buildConfigSummary(asset.category, asset.specifications, templates) || asset.description
  return (
    <div className={cn('w-full flex items-start gap-2 border-b border-border transition-colors', active ? 'bg-primary/10' : 'hover:bg-muted')}>
      {showCheckbox && (
        <div className="pl-3 pt-2.5" onClick={(e) => e.stopPropagation()}>
          {!asset.po_id && <Checkbox checked={checked} onCheckedChange={onToggleChecked} />}
        </div>
      )}
      <button type="button" onClick={onOpen} className={cn('flex-1 min-w-0 text-left px-3 py-2', !showCheckbox && 'pl-3')}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-sm text-foreground truncate">{identifier(asset)}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            {tab === 'sold' && (
              <span className="text-xs font-medium tabular-nums whitespace-nowrap text-foreground">
                {asset.sale_total != null ? `₹${asset.sale_total.toFixed(2)}` : '—'}
              </span>
            )}
            {asset.under_repair_job_number && (
              <span className="px-1.5 py-0.5 rounded bg-warning/15 text-warning text-xs whitespace-nowrap">Under Repair</span>
            )}
            <StatusBadge tone={toneFor(ASSET_STATUS_TONES, asset.status)}>{asset.status.replace(/_/g, ' ')}</StatusBadge>
          </div>
        </div>
        <div className="flex items-baseline justify-between gap-2 mt-1">
          <p className="text-xs text-muted-foreground truncate">{desc}</p>
          <span className="text-xs text-muted-foreground whitespace-nowrap">{dateStr || '—'}</span>
        </div>
      </button>
    </div>
  )
}

// Right-pane detail view for the Current/Sold master-detail layout -- embeds the
// existing per-unit AssetQCPage (QC checklist, cost adjustments, sale summary/edit,
// unit-detail edit) and adds a toolbar above it for every action that page doesn't
// already expose: Fix SKU, Delete/Force-delete, Send back to QC, Sell/Repair/Return,
// Add Payment, Generate/Record Zoho Invoice. These call the exact same handlers
// already defined in StockView (passed down as props), just invoked from here
// instead of a table row.
function AssetDetailPane({
  asset, tab, idx, page, pageSize, canEdit, isOwner, showServiceActions, pendingRowKey, returnToPath, templates,
  onBack, onSell, onRepair, onReturn, onSendBackToQc, onFixSku, onDelete, onForceDelete,
  onAddPayment, onGenerateInvoice, onRecordZohoInvoice,
}: {
  asset: AssetRow | null
  tab: 'current' | 'sold'
  idx: number
  page: number
  pageSize: number
  canEdit: boolean
  isOwner: boolean
  templates: ConfigSummaryTemplate[]
  showServiceActions: boolean
  pendingRowKey: string | null
  returnToPath: string
  onBack: () => void
  onSell: () => void
  onRepair: () => void
  onReturn: () => void
  onSendBackToQc: (asset: AssetRow) => void
  onFixSku: () => void
  onDelete: (asset: AssetRow) => void
  onForceDelete: (asset: AssetRow) => void
  onAddPayment: (asset: AssetRow) => void
  onGenerateInvoice: (asset: AssetRow) => void
  onRecordZohoInvoice: (asset: AssetRow) => void
}) {
  if (!asset) return null
  const rowNumber = idx >= 0 ? (page - 1) * pageSize + idx + 1 : null
  return (
    <div className="flex flex-col h-full w-full">
      <div className="p-4 pb-0">
        <button type="button" onClick={onBack} className="md:hidden mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="size-4" /> Back to list
        </button>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pb-3 border-b border-border">
          {rowNumber != null && <span className="text-xs text-muted-foreground">#{rowNumber}</span>}
          {canEdit && (
            <Button variant="link" size="sm" onClick={onFixSku} className="text-primary text-xs">Fix SKU</Button>
          )}
          {tab === 'current' && ['ready_for_sale', 'qc_passed'].includes(asset.status) && (
            <Button variant="link" size="sm" onClick={onSell} className="text-success text-xs">Sell</Button>
          )}
          {tab === 'current' && asset.status === 'ready_for_sale' && (
            <Button
              variant="link"
              size="sm"
              onClick={() => onSendBackToQc(asset)}
              disabled={!!pendingRowKey}
              className="text-warning text-xs disabled:opacity-50 inline-flex items-center gap-1"
            >
              {pendingRowKey === `${asset.id}:send-back-to-qc` && <Loader2 className="size-3 animate-spin" />}
              Send to QC
            </Button>
          )}
          {tab === 'current' && showServiceActions && (
            <Button variant="link" size="sm" onClick={onRepair} className="text-primary text-xs">Repair</Button>
          )}
          {tab === 'current' && isOwner && !asset.po_id && (
            <Button
              variant="link"
              size="sm"
              onClick={() => onDelete(asset)}
              disabled={!!pendingRowKey}
              className="text-destructive text-xs disabled:opacity-50 inline-flex items-center gap-1"
            >
              {pendingRowKey === `${asset.id}:delete` && <Loader2 className="size-3 animate-spin" />}
              Delete
            </Button>
          )}
          {tab === 'sold' && asset.sale_id && asset.payment_status !== 'paid' && (
            <Button variant="link" size="sm" onClick={() => onAddPayment(asset)} className="text-success text-xs">Add Payment</Button>
          )}
          {tab === 'sold' && showServiceActions && (
            <Button variant="link" size="sm" onClick={onReturn} className="text-warning text-xs">Return</Button>
          )}
          {tab === 'sold' && isOwner && (
            asset.invoice_finalized ? (
              <span className="text-success text-xs">✓ {asset.invoice_number}</span>
            ) : asset.invoice_mode === 'external' ? (
              <Button variant="link" size="sm" onClick={() => onRecordZohoInvoice(asset)} disabled={!asset.sale_id} className="text-warning text-xs disabled:opacity-50" title="This entity is issuing invoices in Zoho during the transition">
                Record Zoho Invoice #
              </Button>
            ) : (
              <Button variant="link" size="sm" onClick={() => onGenerateInvoice(asset)} disabled={!!pendingRowKey} className="text-warning text-xs disabled:opacity-50 inline-flex items-center gap-1">
                {pendingRowKey === `${asset.id}:invoice` && <Loader2 className="size-3 animate-spin" />}
                Generate Invoice
              </Button>
            )
          )}
          {tab === 'sold' && isOwner && (
            <Button
              variant="link"
              size="sm"
              onClick={() => onForceDelete(asset)}
              className="text-destructive text-xs"
            >
              Delete
            </Button>
          )}
          <Link href={`/dashboard/stock/${asset.id}?return_to=${encodeURIComponent(returnToPath)}`} className="text-xs text-muted-foreground underline ml-auto">
            Open full page
          </Link>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 pt-2">
        <AssetQCPage assetId={asset.id} embedded templates={templates} />
      </div>
    </div>
  )
}

// Left-pane list row for the Accessories tab's master-detail layout -- name,
// category/brand, in-stock qty and selling price are the most-scannable columns
// from the old wide table; owner-only cost/last-vendor/awaiting-PO and the
// employee-visible last-purchase line move into the detail pane (the embedded
// AccessoryDetailPage already surfaces cost/last-vendor and the movement ledger's
// most recent receipt row already surfaces last-purchase vendor/price/date, so
// nothing here is lost -- see the accompanying audit).
function AccessoryStockListItem({ sku, active, onOpen }: {
  sku: AccessoryStockRow
  active: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'w-full text-left px-3 py-2.5 border-b border-border flex items-start gap-2.5 transition-colors',
        active ? 'bg-primary/10' : 'hover:bg-muted'
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-sm text-foreground truncate">{sku.sku_description || sku.model_name || sku.full_sku_code}</span>
          <span className="text-sm font-medium tabular-nums whitespace-nowrap text-foreground">
            {sku.selling_price_default != null ? `₹${sku.selling_price_default.toFixed(2)}` : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-1">
          <p className="text-xs text-muted-foreground truncate">
            {sku.full_sku_code} — {sku.category}{sku.brand ? ` · ${sku.brand}` : ''}
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs text-muted-foreground whitespace-nowrap">In stock: {sku.quantity_in_stock}</span>
            {!!sku.needs_po_qty && <StatusBadge tone="warning">{sku.needs_po_qty} awaiting PO</StatusBadge>}
          </div>
        </div>
      </div>
    </button>
  )
}

// Right-pane detail view for the Accessories tab -- embeds the same per-SKU
// history page used by the standalone Accessories list (Receive/Adjust/Attach-
// PO/Archive controls live there; "Manage Accessories" link below reaches them),
// plus a Sell toolbar button, which isn't part of that page itself.
function AccessoryStockDetailPane({ sku, isOwner, onBack, onSell }: {
  sku: AccessoryStockRow
  isOwner: boolean
  onBack: () => void
  onSell: () => void
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 pb-0">
        <button type="button" onClick={onBack} className="md:hidden mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="size-4" /> Back to list
        </button>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pb-3 border-b border-border">
          <Button variant="link" size="sm" onClick={onSell} className="text-success text-xs whitespace-nowrap">Sell</Button>
          {isOwner && !!sku.needs_po_qty && (
            <span className="text-warning text-xs whitespace-nowrap" title="Units received but not yet on a purchase order -- use Manage Accessories to attach.">
              {sku.needs_po_qty} received, awaiting PO
            </span>
          )}
          <Link href={`/dashboard/accessories/${sku.id}`} className="text-xs text-muted-foreground underline ml-auto">
            Manage Accessories
          </Link>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 pt-2">
        <AccessoryDetailPage key={sku.id} skuId={sku.id} embedded />
      </div>
    </div>
  )
}

// Left-pane list row for the Sold Accessories tab -- item, date, sale total and
// payment status are what's scannable at a glance, mirroring AssetListItem's sold
// variant.
function SoldAccessoryListItem({ sale, active, onOpen }: {
  sale: SoldAccessoryRow
  active: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'w-full text-left px-3 py-2.5 border-b border-border flex items-start gap-2.5 transition-colors',
        active ? 'bg-primary/10' : 'hover:bg-muted'
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-sm text-foreground truncate">{sale.sku_description || sale.full_sku_code}</span>
          <span className="text-sm font-medium tabular-nums whitespace-nowrap text-foreground">
            {sale.sale_total != null ? `₹${sale.sale_total.toFixed(2)}` : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-1">
          <p className="text-xs text-muted-foreground truncate">{sale.customer_name || 'Walk-in'} · Qty {sale.accessory_quantity}</p>
          <div className="flex items-center gap-1.5 shrink-0">
            <StatusBadge tone={toneFor(PAYMENT_STATUS_TONES, sale.payment_status)}>{sale.payment_status}</StatusBadge>
            <span className="text-xs text-muted-foreground whitespace-nowrap">{sale.sale_date?.slice(0, 10) || '—'}</span>
          </div>
        </div>
      </div>
    </button>
  )
}

// Right-pane detail view for the Sold Accessories tab -- there's no dedicated
// per-sale detail page for an accessory sale (unlike Current/Sold's AssetQCPage),
// so this is a Field-based pane showing every column the old wide table had,
// same helper pattern as Customers/Sales Ledger. Edit is preserved via the same
// EditSaleDialog the old table's Edit link opened.
function SoldAccessoryDetailPane({ sale, canEdit, onBack, onEdit, onCustomerUpdated }: {
  sale: SoldAccessoryRow
  canEdit: boolean
  onBack: () => void
  onEdit: () => void
  onCustomerUpdated: () => void
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
        <div className="min-w-0">
          <button type="button" onClick={onBack} className="md:hidden mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowLeft className="size-4" /> Back to list
          </button>
          <h2 className="text-lg font-semibold text-foreground truncate">{sale.sku_description || sale.full_sku_code}</h2>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <StatusBadge tone={toneFor(PAYMENT_STATUS_TONES, sale.payment_status)}>{sale.payment_status}</StatusBadge>
            {sale.finalized && <StatusBadge tone="success">Invoiced</StatusBadge>}
          </div>
        </div>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={onEdit}>Edit</Button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <Field label="Sale Date">{sale.sale_date?.slice(0, 10) || '—'}</Field>
        <Field label="Item">
          {sale.sku_description || sale.full_sku_code}
          {sale.sku_description && sale.full_sku_code && (
            <span className="text-muted-foreground"> · {sale.full_sku_code}</span>
          )}
        </Field>
        <Field label="Quantity">{sale.accessory_quantity}</Field>
        <Field label="Sale Total">₹{sale.sale_total?.toFixed(2)}</Field>
        <Field label="Payment Status">
          <StatusBadge tone={toneFor(PAYMENT_STATUS_TONES, sale.payment_status)}>{sale.payment_status}</StatusBadge>
        </Field>
        <Field label="Amount Paid">₹{sale.amount_paid?.toFixed(2)}</Field>
        <Field label="Payment Date">{sale.payment_date?.slice(0, 10) || '—'}</Field>
        <Field label="Received Into">{sale.payment_account || '—'}</Field>
        <Field label="Customer">
          <CustomerNameLink customerId={sale.customer_id} customerName={sale.customer_name} summary={sale.customer_summary} onUpdated={onCustomerUpdated} />
        </Field>
        <Field label="Sold By">{sale.sold_by || '—'}</Field>
        <Field label="Invoice">
          {sale.finalized ? <span className="text-success">✓ {sale.invoice_number}</span> : '—'}
        </Field>
      </div>
    </div>
  )
}

// One field in the detail pane's label/value grid -- matches the same helper used
// by Sales Ledger/Customers/Purchase Orders' Field-based detail panes.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5 border-b border-border grid grid-cols-3 gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2">{children}</span>
    </div>
  )
}

function CreatePoForm({ assetIds, assets, templates, onClose, onDone }: {
  assetIds: string[]
  assets: AssetRow[]
  templates: ConfigSummaryTemplate[]
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

  // One cost/GST input per distinct SKU among the selected units. category/
  // specifications are carried along (identical across every unit sharing this
  // sku_code) so the review table can show a real config summary (e.g. "i5 / 8GB /
  // 256GB") instead of just a SKU code -- easy to pick the wrong laptop out of a
  // page full of near-identical asset numbers otherwise.
  const skuGroups = useMemo(() => {
    const map = new Map<string, { sku_code: string; count: number; category?: string | null; specifications?: Record<string, any> | null }>()
    for (const a of assets) {
      const key = a.sku_code
      if (!map.has(key)) map.set(key, { sku_code: a.sku_code, count: 0, category: a.category, specifications: a.specifications })
      map.get(key)!.count++
    }
    return [...map.entries()]
  }, [assets])

  // cost_price/gst_percentage/line_total are kept in sync with each other the same
  // way the New PO wizard's Unit Price/GST%/Line Total fields are (lib/po-gst-calc.ts)
  // -- editing price or GST% forward-computes the total; editing the total back-solves
  // price. Only `cost_price`/`gst_percentage` are ever sent to the server.
  const [costInputs, setCostInputs] = useState<Record<string, { cost_price: number; gst_percentage: number; line_total: number }>>({})

  const updateCostPrice = (skuCode: string, qty: number, cost_price: number) => {
    setCostInputs(prev => {
      const gst_percentage = prev[skuCode]?.gst_percentage ?? 18
      return { ...prev, [skuCode]: { cost_price, gst_percentage, line_total: computeFromUnitPrice(cost_price, qty, gst_percentage).lineTotal } }
    })
  }
  const updateGstPercentage = (skuCode: string, qty: number, gst_percentage: number) => {
    setCostInputs(prev => {
      const cost_price = prev[skuCode]?.cost_price ?? 0
      return { ...prev, [skuCode]: { cost_price, gst_percentage, line_total: computeFromUnitPrice(cost_price, qty, gst_percentage).lineTotal } }
    })
  }
  const updateLineTotal = (skuCode: string, qty: number, line_total: number) => {
    setCostInputs(prev => {
      const gst_percentage = prev[skuCode]?.gst_percentage ?? 18
      return { ...prev, [skuCode]: { cost_price: computeFromLineTotal(line_total, qty, gst_percentage).unitPrice, gst_percentage, line_total } }
    })
  }

  const grandTotal = useMemo(
    () => skuGroups.reduce((sum, [skuCode]) => sum + (costInputs[skuCode]?.line_total ?? 0), 0),
    [skuGroups, costInputs]
  )

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
    <div className="border rounded p-4 mb-4 bg-muted">
      <h3 className="font-semibold mb-2">Create Purchase Order from {assetIds.length} selected unit(s)</h3>
      {soldCount > 0 && (
        <div className="text-xs text-muted-foreground mb-2">
          Includes {soldCount} already-sold unit{soldCount > 1 ? 's' : ''} -- their sale record is unaffected, this only attaches the purchase paperwork (vendor/cost/GST).
        </div>
      )}
      {error && <div className="text-destructive text-sm mb-2">{error}</div>}
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
          <tr>
            <th className="border p-2">SKU</th>
            <th className="border p-2">Config</th>
            <th className="border p-2">Qty</th>
            <th className="border p-2">Unit Price (before GST) (₹)</th>
            <th className="border p-2">GST %</th>
            <th className="border p-2">Line Total (incl. GST) (₹)</th>
          </tr>
        </thead>
        <tbody>
          {skuGroups.map(([skuCode, info]) => (
            <tr key={skuCode}>
              <td className="border p-2">{skuCode}</td>
              <td className="border p-2 text-xs text-muted-foreground">{buildConfigSummary(info.category, info.specifications, templates) || '—'}</td>
              <td className="border p-2">{info.count}</td>
              <td className="border p-2">
                <input
                  type="number"
                  className="border p-1 w-24 rounded"
                  value={costInputs[skuCode]?.cost_price ?? ''}
                  onChange={(e) => updateCostPrice(skuCode, info.count, Number(e.target.value))}
                />
              </td>
              <td className="border p-2">
                <input
                  type="number"
                  className="border p-1 w-20 rounded"
                  value={costInputs[skuCode]?.gst_percentage ?? 18}
                  onChange={(e) => updateGstPercentage(skuCode, info.count, Number(e.target.value))}
                />
              </td>
              <td className="border p-2">
                <input
                  type="number"
                  className="border p-1 w-28 rounded"
                  value={costInputs[skuCode]?.line_total ?? ''}
                  onChange={(e) => updateLineTotal(skuCode, info.count, Number(e.target.value))}
                />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="border p-2 text-right font-medium" colSpan={5}>Grand Total (incl. GST)</td>
            <td className="border p-2 font-medium">₹{grandTotal.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>

      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded border">Cancel</button>
        <button onClick={handleSubmit} disabled={submitting} className="bg-primary text-primary-foreground px-4 py-2 rounded disabled:opacity-50 inline-flex items-center gap-1.5">
          {submitting && <Loader2 className="size-4 animate-spin" />}
          {submitting ? 'Creating...' : 'Create PO'}
        </button>
      </div>
    </div>
  )
}

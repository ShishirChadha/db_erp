'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useRole } from '@/lib/auth/useRole'
import { FixSkuDialog } from '@/components/FixSkuDialog'
import { StatCardsRow } from '@/components/StatCardsRow'
import { buildConfigSummary, ConfigSummaryTemplate } from '@/lib/sku-config-summary'

interface AssetRow {
  id: string
  asset_number: string | null
  serial_number: string | null
  status: string
  qc_grade: string | null
  qc_status: string
  sold_at: string | null
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
  sale_total?: number
  invoice_finalized?: boolean
  invoice_number?: string
  payment_status?: string
  amount_paid?: number
}

interface Vendor {
  id: string
  company_name: string
}

const CURRENT_STATUSES = ['draft', 'reserved', 'received', 'in_stock', 'qc_pending', 'qc_passed', 'ready_for_sale', 'faulty', 'rma_sent', 'rma_returned']

type Tab = 'current' | 'sold'
type SortField = 'asset_number' | 'sku_code' | 'status' | 'sold_at'
type SortOrder = 'asc' | 'desc'

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
  showServiceActions = false,
}: {
  title: string
  subtitle: string
  sourceMode: 'employee_intake' | 'exclude_employee_intake'
  showServiceActions?: boolean
}) {
  const router = useRouter()
  const { isOwner } = useRole()
  const [tab, setTab] = useState<Tab>('current')
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<SortField>('asset_number')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showPoForm, setShowPoForm] = useState(false)
  const [fixSkuAssetId, setFixSkuAssetId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ConfigSummaryTemplate[]>([])

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

      const res = await apiFetch(`/api/stock?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch assets')
      const data = await res.json()
      setAssets(data)
      setSelected(new Set())
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [tab, statusFilter, searchTerm, sourceParam])

  useEffect(() => { fetchAssets() }, [fetchAssets])

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

  const displayedAssets = useMemo(() => {
    const sorted = [...assets].sort((a, b) => {
      const av = (a as any)[sortField]
      const bv = (b as any)[sortField]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return String(av).localeCompare(String(bv))
    })
    return sortOrder === 'asc' ? sorted : sorted.reverse()
  }, [assets, sortField, sortOrder])

  const sortIndicator = (field: SortField) => (sortField === field ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : '')

  const selectableIds = useMemo(
    () => displayedAssets.filter(a => !a.po_id).map(a => a.id),
    [displayedAssets]
  )

  const toggleSelectAll = () => {
    setSelected(prev => prev.size === selectableIds.length ? new Set() : new Set(selectableIds))
  }
  const toggleSelectOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const [pendingRowKey, setPendingRowKey] = useState<string | null>(null)

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

  if (error) return <div className="p-4 text-red-600">Error: {error}</div>

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-1">{title}</h1>
      <p className="text-sm text-gray-500 mb-4">{subtitle}</p>

      <div className="flex mb-4 border rounded overflow-hidden w-fit">
        <button onClick={() => setTab('current')} className={`px-4 py-2 text-sm font-medium ${tab === 'current' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>
          Current Stock
        </button>
        <button onClick={() => setTab('sold')} className={`px-4 py-2 text-sm font-medium ${tab === 'sold' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>
          Sold Stock
        </button>
      </div>

      <StatCardsRow
        cards={[
          {
            label: 'Total Current Stock',
            value: statCounts.totalCurrent,
            active: tab === 'current' && !statusFilter,
            onClick: () => { setTab('current'); setStatusFilter('') },
          },
          {
            label: 'Ready for Sale',
            value: statCounts.readyForSale,
            active: tab === 'current' && statusFilter === 'ready_for_sale',
            onClick: () => { setTab('current'); setStatusFilter('ready_for_sale') },
          },
          {
            label: 'QC Pending',
            value: statCounts.qcPending,
            active: tab === 'current' && statusFilter === 'qc_pending',
            onClick: () => { setTab('current'); setStatusFilter('qc_pending') },
          },
          {
            label: 'Sold',
            value: statCounts.totalSold,
            active: tab === 'sold',
            onClick: () => setTab('sold'),
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
          placeholder="Search asset or serial..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="border p-2 rounded"
        />
        {(statusFilter || searchTerm) && (
          <button onClick={() => { setStatusFilter(''); setSearchTerm('') }} className="text-sm text-gray-500 underline self-center">
            Clear filters
          </button>
        )}
        {isOwner && tab === 'current' && selected.size > 0 && (
          <button onClick={() => setShowPoForm(true)} className="bg-blue-600 text-white px-4 py-2 rounded text-sm">
            Create PO from Selected ({selected.size})
          </button>
        )}
      </div>

      {showPoForm && (
        <CreatePoForm
          assetIds={[...selected]}
          assets={displayedAssets.filter(a => selected.has(a.id))}
          onClose={() => setShowPoForm(false)}
          onDone={() => { setShowPoForm(false); fetchAssets(); fetchCounts() }}
        />
      )}

      {fixSkuAssetId && (
        <FixSkuDialog
          assetId={fixSkuAssetId}
          onClose={() => setFixSkuAssetId(null)}
          onReassigned={() => { fetchAssets(); fetchCounts() }}
        />
      )}

      {loading ? (
        <div>Loading assets…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border text-sm">
            <thead>
              <tr>
                {isOwner && tab === 'current' && (
                  <th className="border p-2">
                    <input type="checkbox" checked={selectableIds.length > 0 && selected.size === selectableIds.length} onChange={toggleSelectAll} />
                  </th>
                )}
                <th className="border p-2 cursor-pointer select-none" onClick={() => toggleSort('asset_number')}>
                  Asset / Serial{sortIndicator('asset_number')}
                </th>
                <th className="border p-2 cursor-pointer select-none" onClick={() => toggleSort('sku_code')}>
                  SKU{sortIndicator('sku_code')}
                </th>
                <th className="border p-2">Description</th>
                <th className="border p-2 cursor-pointer select-none" onClick={() => toggleSort('status')}>
                  Status{sortIndicator('status')}
                </th>
                <th className="border p-2">Grade</th>
                {isOwner && tab === 'current' && <th className="border p-2">PO</th>}
                {isOwner && tab === 'current' && <th className="border p-2">Vendor / Cost</th>}
                {tab === 'sold' && <th className="border p-2 cursor-pointer select-none" onClick={() => toggleSort('sold_at')}>Sold{sortIndicator('sold_at')}</th>}
                {tab === 'sold' && <th className="border p-2">Customer</th>}
                {tab === 'sold' && <th className="border p-2">Sale Total</th>}
                {isOwner && tab === 'sold' && <th className="border p-2">Invoice</th>}
                {isOwner && <th className="border p-2">Fix SKU</th>}
                {(tab === 'current' || (tab === 'sold' && showServiceActions)) && <th className="border p-2">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {displayedAssets.map((asset) => (
                <tr key={asset.id}>
                  {isOwner && tab === 'current' && (
                    <td className="border p-2 text-center">
                      {!asset.po_id && (
                        <input type="checkbox" checked={selected.has(asset.id)} onChange={() => toggleSelectOne(asset.id)} />
                      )}
                    </td>
                  )}
                  <td className="border p-2">
                    <Link href={`/dashboard/stock/${asset.id}`} className="text-blue-600 underline">
                      {identifier(asset)}
                    </Link>
                    {asset.under_repair_job_number && (
                      <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-xs whitespace-nowrap" title={`Repair job ${asset.under_repair_job_number}`}>
                        Under Repair
                      </span>
                    )}
                  </td>
                  <td className="border p-2">{asset.sku_code}</td>
                  <td className="border p-2">{buildConfigSummary(asset.category, asset.specifications, templates) || asset.description}</td>
                  <td className="border p-2 capitalize">{asset.status.replace(/_/g, ' ')}</td>
                  <td className="border p-2">{asset.qc_grade || '—'}</td>
                  {isOwner && tab === 'current' && (
                    <td className="border p-2 text-center">
                      {asset.po_id ? <span className="text-green-600">✓ {asset.po_number}</span> : <span className="text-amber-600">✗ missing</span>}
                    </td>
                  )}
                  {isOwner && tab === 'current' && (
                    <td className="border p-2">
                      {asset.vendor_name ? `${asset.vendor_name} · ₹${asset.unit_price?.toFixed(2)}` : '—'}
                    </td>
                  )}
                  {tab === 'sold' && <td className="border p-2">{asset.sold_at?.slice(0, 10)}</td>}
                  {tab === 'sold' && <td className="border p-2">{asset.customer_name || '—'}</td>}
                  {tab === 'sold' && <td className="border p-2">₹{asset.sale_total?.toFixed(2)}</td>}
                  {isOwner && tab === 'sold' && (
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
                  {isOwner && (
                    <td className="border p-2 space-x-2">
                      <button onClick={() => setFixSkuAssetId(asset.id)} className="text-blue-600 underline text-xs">
                        Fix SKU
                      </button>
                      {tab === 'current' && !asset.po_id && (
                        <button
                          onClick={() => deleteAsset(asset, identifier(asset))}
                          disabled={!!pendingRowKey}
                          className="text-red-600 underline text-xs disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          {pendingRowKey === `${asset.id}:delete` && <Loader2 className="size-3 animate-spin" />}
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                  {tab === 'current' && (
                    <td className="border p-2 space-x-2">
                      {['ready_for_sale', 'qc_passed'].includes(asset.status) && (
                        <button onClick={() => router.push(`/dashboard/entry/sell?asset_id=${asset.id}`)} className="text-green-700 underline text-xs">
                          Sell
                        </button>
                      )}
                      {showServiceActions && (
                        <button onClick={() => router.push(`/dashboard/entry/service?subtype=repair&asset_id=${asset.id}`)} className="text-blue-700 underline text-xs">
                          Repair
                        </button>
                      )}
                    </td>
                  )}
                  {tab === 'sold' && showServiceActions && (
                    <td className="border p-2">
                      <button onClick={() => router.push(`/dashboard/entry/service?subtype=return&asset_id=${asset.id}`)} className="text-amber-700 underline text-xs">
                        Return
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Loader2, MessageSquare } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useRole } from '@/lib/auth/useRole'
import RequirePageAccess from '@/components/RequirePageAccess'
import { buildConfigSummary, ConfigSummaryTemplate } from '@/lib/sku-config-summary'
import { SearchableSelect } from '@/components/SearchableSelect'
import { useCustomOptions } from '@/lib/useCustomOptions'
import { EditSaleDialog } from '@/components/EditSaleDialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const DEFAULT_CHECK_ITEMS = [
  'Screen',
  'Keyboard',
  'Trackpad',
  'Battery Health',
  'Ports / Connectivity',
  'Body / Cosmetic Condition',
  'Boot / OS',
  // Added for the storefront Technical Test Report (2026-07-30 architecture,
  // §A) -- asset_qc_checks.check_item is free text with no server-side enum,
  // so these are the only change needed to start capturing them.
  'Camera',
  'Audio',
  'WiFi',
  'Charging',
  'Stress Test',
]

interface CheckResult {
  check_item: string
  result: 'pass' | 'fail' | 'na'
  notes: string
}

interface CostAdjustment {
  id: string
  amount: number
  reason: string | null
  created_at: string
}

interface AssetDetail {
  id: string
  asset_number: string
  serial_number: string | null
  status: string
  created_at: string | null
  notes: string | null
  qc_grade: string | null
  qc_status: string
  qc_notes: string | null
  qc_at: string | null
  warranty_type: string | null
  warranty_start_date: string | null
  warranty_duration_months: number | null
  warranty_expiry_date: string | null
  battery_health_percent: number | null
  estimated_backup_hours: number | null
  screen_condition: string | null
  keyboard_condition: string | null
  body_condition: string | null
  included_accessories: string | null
  sale_id: string | null
  sale_summary: {
    customer_name: string | null
    sale_total: number | null
    payment_status: string | null
    amount_paid: number | null
    payment_date: string | null
    bundled_accessories_display: { name: string; quantity: number }[]
  } | null
  // Owner-only (redacted server-side to null for non-owners, same rule as cost/vendor
  // everywhere else -- see CLAUDE.md). PO number / vendor / unit cost this unit was
  // purchased under; unit_price falls back to asset_ledger.cost_price for legacy-door
  // rows with no PO link.
  purchase_info: { po_number: string | null; vendor_name: string | null; unit_price: number | null } | null
  purchase_order_items: {
    sku_master: {
      full_sku_code: string
      sku_description: string
      category: string
      brand: string
      model_name: string
      specifications: Record<string, any> | null
    } | null
  } | null
  // Set only when this unit's SKU was reassigned (Change SKU) after purchase --
  // purchase_order_items.sku_master above becomes the CURRENT/effective spec in that
  // case, and this holds what it was actually purchased as.
  purchased_sku?: {
    full_sku_code: string
    sku_description: string
    category: string
    specifications: Record<string, any> | null
  } | null
  checks: { check_item: string; result: string; notes: string | null }[]
}

// Shared label/value row for detail panes -- same exact pattern used by Sales Ledger
// (app/dashboard/sales/page.tsx) and Customers (app/dashboard/customers/page.tsx).
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5 border-b border-border grid grid-cols-3 gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2">{children}</span>
    </div>
  )
}

// `assetId`/`embedded` let this exact component be reused inline inside StockView's
// master-detail right pane (see components/StockView.tsx) instead of duplicating its
// fetch/QC/cost-adjustment logic a second time -- same technique as PODetailPage's
// `poId`/`embedded` props. Embedded mode fetches by the given id instead of a route
// param, and drops the standalone-page chrome (back link, outer padding/max-width,
// which the host pane already supplies).
export function AssetQCPage({ assetId: assetIdProp, embedded, templates: templatesProp }: { assetId?: string; embedded?: boolean; templates?: ConfigSummaryTemplate[] } = {}) {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const assetId = assetIdProp ?? (params.id as string)
  const { isOwner, canEditPage } = useRole()
  // Reachable from both Live Stock and the main-ERP Stock page (same route), so either
  // page's edit grant unlocks correcting an asset's serial/asset number here.
  const canEditLiveStock = isOwner || canEditPage('live_stock') || canEditPage('stock')
  // Preserves which tab (current/sold/accessories/sold_accessories) the user came from --
  // plain browser-history back() would land on the bare list URL and lose that, same
  // pattern already used by app/dashboard/entry/sell/page.tsx. Not used in embedded mode.
  const returnTo = searchParams.get('return_to')
  const backHref = returnTo && returnTo.startsWith('/dashboard') ? returnTo : '/dashboard/live-stock'

  const [asset, setAsset] = useState<AssetDetail | null>(null)
  const [templates, setTemplates] = useState<ConfigSummaryTemplate[]>(templatesProp ?? [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [checkResults, setCheckResults] = useState<CheckResult[]>([])
  const [grade, setGrade] = useState('')
  const [notes, setNotes] = useState('')

  // Condition/battery/warranty facts for the storefront Test Report.
  const [batteryHealthPercent, setBatteryHealthPercent] = useState('')
  const [estimatedBackupHours, setEstimatedBackupHours] = useState('')
  const [screenCondition, setScreenCondition] = useState('')
  const [keyboardCondition, setKeyboardCondition] = useState('')
  const [bodyCondition, setBodyCondition] = useState('')
  const [includedAccessories, setIncludedAccessories] = useState('')
  const [warrantyDurationMonths, setWarrantyDurationMonths] = useState('')
  const { values: conditionGradeOptions } = useCustomOptions('condition_grade')

  // Owner-only cost tracking (original cost + any upgrade/refurb adjustments).
  const [costPrice, setCostPrice] = useState<number | null>(null)
  const [adjustments, setAdjustments] = useState<CostAdjustment[]>([])
  const [totalCost, setTotalCost] = useState<number | null>(null)
  const [newAmount, setNewAmount] = useState('')
  const [newReason, setNewReason] = useState('')
  const [savingAdjustment, setSavingAdjustment] = useState(false)

  // Edit-grant-gated unit correction (serial/asset number, entry date, notes). Editing a
  // sold/invoiced/returned unit additionally requires a typed reason (see PUT /api/stock's
  // confirm_override path).
  const [editingTag, setEditingTag] = useState(false)
  const [assetNumberInput, setAssetNumberInput] = useState('')
  const [serialNumberInput, setSerialNumberInput] = useState('')
  const [entryDateInput, setEntryDateInput] = useState('')
  const [notesInput, setNotesInput] = useState('')
  const [tagReason, setTagReason] = useState('')
  const [tagErr, setTagErr] = useState('')
  const [savingTag, setSavingTag] = useState(false)

  // QC & Spec tab: whether the full checklist/grid is expanded for a unit that already
  // has QC data recorded (see `hasQcData` below). Irrelevant for a never-QC'd unit --
  // that case always shows the full form directly, same as current behavior.
  const [editingQC, setEditingQC] = useState(false)

  // Full sold-entry edit (customer, amount, SKU, bundled accessories) -- reuses the
  // existing EditSaleDialog (same one the Sales ledger page uses), reachable here once
  // the linked sales row's id is known (asset.sale_id, from GET .../qc).
  const [showEditSale, setShowEditSale] = useState(false)

  const fetchCostAdjustments = useCallback(async () => {
    if (!isOwner) return
    const res = await apiFetch(`/api/asset-ledger/${assetId}/cost-adjustments`)
    if (!res.ok) return
    const data = await res.json()
    setCostPrice(data.cost_price)
    setAdjustments(data.adjustments || [])
    setTotalCost(data.total_cost)
  }, [assetId, isOwner])

  useEffect(() => { fetchCostAdjustments() }, [fetchCostAdjustments])

  const addAdjustment = async () => {
    if (!newAmount.trim() || isNaN(Number(newAmount))) return
    setSavingAdjustment(true)
    try {
      const res = await apiFetch(`/api/asset-ledger/${assetId}/cost-adjustments`, {
        method: 'POST',
        body: JSON.stringify({ amount: Number(newAmount), reason: newReason || null }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Failed to add adjustment')
        return
      }
      setNewAmount('')
      setNewReason('')
      await fetchCostAdjustments()
    } finally {
      setSavingAdjustment(false)
    }
  }

  const lockedStatus = asset ? ['sold', 'invoiced', 'returned'].includes(asset.status) : false

  const saveTag = async () => {
    setTagErr('')
    if (lockedStatus && !tagReason.trim()) {
      setTagErr('A reason is required to edit a sold/invoiced/returned unit.')
      return
    }
    setSavingTag(true)
    try {
      const body: Record<string, unknown> = {
        id: assetId,
        asset_number: assetNumberInput || null,
        serial_number: serialNumberInput || null,
        created_at: entryDateInput || null,
        notes: notesInput || null,
      }
      if (lockedStatus) {
        body.confirm_override = true
        body.reason = tagReason.trim()
      }
      const res = await apiFetch('/api/stock', { method: 'PUT', body: JSON.stringify(body) })
      if (!res.ok) {
        // Duplicate serial (and every other save error) is now a hard block -- no
        // confirm-and-proceed override.
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to save.')
      }
      setEditingTag(false)
      setTagReason('')
      await fetchAsset()
    } catch (e: any) {
      setTagErr(e.message)
    } finally {
      setSavingTag(false)
    }
  }

  // Shared by fetchAsset (initial load / refresh) and the QC-edit Cancel button, so
  // "discard changes" can reset every QC-related input back to the persisted asset
  // record without duplicating this field list in two places.
  const applyQcFieldsFromAsset = useCallback((data: AssetDetail) => {
    setGrade(data.qc_grade || '')
    setNotes(data.qc_notes || '')
    setBatteryHealthPercent(data.battery_health_percent != null ? String(data.battery_health_percent) : '')
    setEstimatedBackupHours(data.estimated_backup_hours != null ? String(data.estimated_backup_hours) : '')
    setScreenCondition(data.screen_condition || '')
    setKeyboardCondition(data.keyboard_condition || '')
    setBodyCondition(data.body_condition || '')
    setIncludedAccessories(data.included_accessories || '')
    setWarrantyDurationMonths(data.warranty_duration_months != null ? String(data.warranty_duration_months) : '')
    // Pre-fill from existing checks if present, else default checklist
    if (data.checks.length > 0) {
      setCheckResults(
        data.checks.map((c) => ({
          check_item: c.check_item,
          result: c.result as 'pass' | 'fail' | 'na',
          notes: c.notes || '',
        }))
      )
    } else {
      setCheckResults(DEFAULT_CHECK_ITEMS.map((item) => ({ check_item: item, result: 'pass', notes: '' })))
    }
  }, [])

  const fetchAsset = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/asset-ledger/${assetId}/qc`)
      if (!res.ok) throw new Error('Failed to load asset')
      const data: AssetDetail = await res.json()
      setAsset(data)
      setAssetNumberInput(data.asset_number || '')
      setSerialNumberInput(data.serial_number || '')
      setEntryDateInput(data.created_at ? data.created_at.slice(0, 10) : '')
      setNotesInput(data.notes || '')
      applyQcFieldsFromAsset(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [assetId, applyQcFieldsFromAsset])

  useEffect(() => {
    fetchAsset()
  }, [fetchAsset])

  useEffect(() => {
    // When rendered embedded from StockView, the parent already fetched this
    // and passes it down via `templates` -- avoid a duplicate network request.
    // Standalone route (no prop) keeps its own fetch-on-mount as before.
    if (templatesProp) {
      setTemplates(templatesProp)
      return
    }
    apiFetch('/api/sku-category-templates').then(res => res.json()).then((data) => {
      setTemplates(Array.isArray(data) ? data : [])
    })
  }, [templatesProp])

  const updateCheck = (idx: number, field: keyof CheckResult, value: string) => {
    setCheckResults((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c))
    )
  }

  const submitQC = async () => {
    setSaving(true)
    try {
      const res = await apiFetch(`/api/asset-ledger/${assetId}/qc`, {
        method: 'PUT',
        body: JSON.stringify({
          checks: checkResults,
          qc_grade: grade || null,
          qc_notes: notes || null,
          battery_health_percent: batteryHealthPercent !== '' ? Number(batteryHealthPercent) : null,
          estimated_backup_hours: estimatedBackupHours !== '' ? Number(estimatedBackupHours) : null,
          screen_condition: screenCondition || null,
          keyboard_condition: keyboardCondition || null,
          body_condition: bodyCondition || null,
          included_accessories: includedAccessories || null,
          warranty_duration_months: warrantyDurationMonths !== '' ? Number(warrantyDurationMonths) : null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Failed to submit QC')
        return
      }
      await fetchAsset()
      // Collapse back to the compact read-only summary once saved -- confirms the
      // save happened and matches Unit Details' own edit->view collapse on Save.
      setEditingQC(false)
    } finally {
      setSaving(false)
    }
  }

  const markReady = async () => {
    setSaving(true)
    try {
      const res = await apiFetch(`/api/asset-ledger/${assetId}/mark-ready`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Failed to mark ready for sale')
        return
      }
      await fetchAsset()
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-4">Loading…</div>
  if (error) return <div className="p-4 text-destructive">Error: {error}</div>
  if (!asset) return null

  const sku = asset.purchase_order_items?.sku_master
  const canEditQC = ['qc_pending', 'qc_passed', 'faulty'].includes(asset.status)

  // "Has QC data" -- the same signal fetchAsset()/applyQcFieldsFromAsset() already use
  // to decide whether to pre-fill from recorded checks vs. the default fresh checklist.
  // A unit with zero recorded checks has never been QC'd, so there's nothing to
  // summarize -- go straight to the full (expanded) form, matching prior behavior.
  const hasQcData = asset.checks.length > 0
  const showFullChecklist = canEditQC && (!hasQcData || editingQC)
  const showCompactQcSummary = hasQcData && !showFullChecklist

  const checkFailCount = asset.checks.filter((c) => c.result === 'fail').length
  const qcSummaryParts = [
    asset.checks.length > 0
      ? (checkFailCount > 0 ? `${checkFailCount} of ${asset.checks.length} checks flagged` : `${asset.checks.length} checks passed`)
      : null,
    asset.qc_grade && `Grade ${asset.qc_grade}`,
    asset.battery_health_percent != null && `Battery ${asset.battery_health_percent}%`,
    asset.screen_condition && `Screen ${asset.screen_condition}`,
    asset.keyboard_condition && `Keyboard ${asset.keyboard_condition}`,
    asset.body_condition && `Body ${asset.body_condition}`,
    asset.warranty_duration_months != null && `${asset.warranty_duration_months}mo warranty`,
  ].filter(Boolean) as string[]
  const qcSummaryLine = qcSummaryParts.length > 0 ? qcSummaryParts.join(' · ') : 'QC recorded — no grade/condition set.'

  const canSeeSaleDetails = Boolean(asset.sale_id) && (isOwner || canEditPage('live_stock') || canEditPage('stock') || canEditPage('sales'))

  return (
    <div className={embedded ? '' : 'p-4 max-w-3xl mx-auto'}>
      {!embedded && (
        <button onClick={() => router.push(backHref)} className="text-sm text-muted-foreground mb-2">&larr; Back</button>
      )}
      <h1 className="text-2xl font-bold mb-1">{asset.asset_number || (asset.serial_number ? `SN: ${asset.serial_number}` : '— no tag yet —')}</h1>
      <p className="text-muted-foreground mb-1">
        {sku?.full_sku_code} — {buildConfigSummary(sku?.category, sku?.specifications, templates) || sku?.sku_description || `${sku?.brand || ''} ${sku?.model_name || ''}`}
      </p>
      {asset.purchased_sku && (
        <p className="text-xs text-muted-foreground mb-1" title="This unit's spec was changed after purchase (Change SKU)">
          Purchased as: {asset.purchased_sku.full_sku_code} — {buildConfigSummary(asset.purchased_sku.category, asset.purchased_sku.specifications, templates) || asset.purchased_sku.sku_description}
        </p>
      )}
      <p className="text-sm text-muted-foreground mb-4">
        {asset.warranty_type || asset.warranty_expiry_date
          ? `Warranty: ${asset.warranty_type || '—'}${asset.warranty_expiry_date ? ` — expires ${asset.warranty_expiry_date.slice(0, 10)}` : ''}`
          : 'No warranty on file.'}
      </p>

      <div className="flex gap-4 mb-4 text-sm">
        <div>
          <span className="text-muted-foreground">Serial:</span> {asset.serial_number || '—'}
        </div>
        <div>
          <span className="text-muted-foreground">Status:</span>{' '}
          <span className="font-medium capitalize">{asset.status.replace(/_/g, ' ')}</span>
        </div>
        <div>
          <span className="text-muted-foreground">QC Status:</span>{' '}
          <span className="font-medium capitalize">{asset.qc_status}</span>
        </div>
        {asset.qc_grade && (
          <div>
            <span className="text-muted-foreground">Grade:</span> <span className="font-medium">{asset.qc_grade}</span>
          </div>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="qc">QC &amp; Spec</TabsTrigger>
          <TabsTrigger value="sale">Sale &amp; Payment</TabsTrigger>
        </TabsList>

        {/* ---------- Tab 1: Overview -- Unit Details + Mark-ready banner ---------- */}
        <TabsContent value="overview">
          {canEditLiveStock && (
            <div className="border rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold">Unit Details</h2>
                {!editingTag && (
                  <button onClick={() => setEditingTag(true)} className="text-primary underline text-sm">Edit</button>
                )}
              </div>
              {editingTag ? (
                <div className="space-y-2">
                  {tagErr && <div className="text-destructive text-sm">{tagErr}</div>}
                  {lockedStatus && (
                    <p className="text-xs text-warning bg-warning/15 border border-warning/20 rounded p-2">
                      This unit is &apos;{asset.status}&apos; — editing it requires a reason (logged to its correction history).
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1">Asset Number</label>
                      <input
                        type="text"
                        value={assetNumberInput}
                        onChange={(e) => setAssetNumberInput(e.target.value)}
                        className="border p-2 w-full rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Serial Number</label>
                      <input
                        type="text"
                        value={serialNumberInput}
                        onChange={(e) => setSerialNumberInput(e.target.value)}
                        className="border p-2 w-full rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Entry Date</label>
                      <input
                        type="date"
                        value={entryDateInput}
                        onChange={(e) => setEntryDateInput(e.target.value)}
                        className="border p-2 w-full rounded"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium mb-1">Notes</label>
                      <textarea
                        value={notesInput}
                        onChange={(e) => setNotesInput(e.target.value)}
                        className="border p-2 w-full rounded"
                        rows={2}
                      />
                    </div>
                  </div>
                  {lockedStatus && (
                    <div>
                      <label className="block text-xs font-medium mb-1">Reason</label>
                      <input
                        type="text"
                        value={tagReason}
                        onChange={(e) => setTagReason(e.target.value)}
                        placeholder="e.g. Typo'd serial number at intake"
                        className="border p-2 w-full rounded"
                      />
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={saveTag}
                      disabled={savingTag}
                      className="bg-primary text-primary-foreground px-3 py-1.5 rounded text-sm disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                      {savingTag && <Loader2 className="size-4 animate-spin" />}
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setEditingTag(false)
                        setTagErr('')
                        setTagReason('')
                        setAssetNumberInput(asset.asset_number || '')
                        setSerialNumberInput(asset.serial_number || '')
                        setEntryDateInput(asset.created_at ? asset.created_at.slice(0, 10) : '')
                        setNotesInput(asset.notes || '')
                      }}
                      className="px-3 py-1.5 border rounded text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground space-y-1">
                  {/* Asset #/serial intentionally not repeated here -- already shown once
                      in the identity chip strip above the tabs. */}
                  <p className="text-xs text-muted-foreground">
                    Entry: {asset.created_at?.slice(0, 10) || '—'}
                    {asset.notes && <> · {asset.notes}</>}
                  </p>
                </div>
              )}
              {isOwner && asset.purchase_info && (
                <p className="text-xs text-muted-foreground mt-2 pt-2 border-t">
                  {asset.purchase_info.po_number ? `PO ${asset.purchase_info.po_number}` : 'No PO attached'}
                  {asset.purchase_info.vendor_name && ` · ${asset.purchase_info.vendor_name}`}
                  {asset.purchase_info.unit_price != null && ` · ₹${asset.purchase_info.unit_price.toFixed(2)}`}
                </p>
              )}
            </div>
          )}

          {asset.status === 'qc_passed' && (
            <div className="mb-4 p-3 bg-success/15 border border-success/20 rounded flex items-center justify-between">
              <span className="text-success text-sm">QC passed. Ready to list this unit for sale?</span>
              <button
                onClick={markReady}
                disabled={saving}
                className="bg-success text-success-foreground px-3 py-1.5 rounded text-sm disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                Mark Ready for Sale
              </button>
            </div>
          )}
        </TabsContent>

        {/* ---------- Tab 2: QC & Spec ---------- */}
        <TabsContent value="qc">
          <div className="border rounded-lg p-4 mb-4">
            {showFullChecklist ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold">
                    {asset.qc_status === 'pending' ? 'Run QC Checklist' : 'Re-run QC Checklist'}
                  </h2>
                  {hasQcData && (
                    <button
                      type="button"
                      onClick={() => { applyQcFieldsFromAsset(asset); setEditingQC(false) }}
                      className="text-sm text-muted-foreground underline"
                    >
                      Cancel
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5 mb-4">
                  {checkResults.map((c, idx) => (
                    <div key={c.check_item} className="flex items-center gap-2 border-b pb-1.5">
                      <span className="flex-1 text-sm truncate">{c.check_item}</span>
                      <div className="flex gap-1">
                        {(['pass', 'fail', 'na'] as const).map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => updateCheck(idx, 'result', r)}
                            className={`px-2 py-1 text-xs rounded border ${
                              c.result === r
                                ? r === 'pass'
                                  ? 'bg-success text-success-foreground border-success'
                                  : r === 'fail'
                                  ? 'bg-destructive text-destructive-foreground border-destructive'
                                  : 'bg-muted-foreground text-background border-muted-foreground'
                                : 'border-border text-muted-foreground'
                            }`}
                          >
                            {r.toUpperCase()}
                          </button>
                        ))}
                      </div>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            title={c.notes ? c.notes : 'Add note'}
                            className={`p-1 rounded hover:bg-muted shrink-0 ${c.notes ? 'text-primary' : 'text-muted-foreground'}`}
                          >
                            <MessageSquare className="size-3.5" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64">
                          <label className="block text-xs font-medium mb-1">Notes — {c.check_item}</label>
                          <input
                            type="text"
                            placeholder="Notes"
                            value={c.notes}
                            onChange={(e) => updateCheck(idx, 'notes', e.target.value)}
                            className="border p-2 w-full rounded text-sm"
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Grade</label>
                    <select value={grade} onChange={(e) => setGrade(e.target.value)} className="border p-2 w-full rounded">
                      <option value="">Not graded</option>
                      <option value="A">A</option>
                      <option value="B">B</option>
                      <option value="C">C</option>
                      <option value="D">D</option>
                      <option value="Scrap">Scrap</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Overall Notes</label>
                    <input
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="border p-2 w-full rounded"
                    />
                  </div>
                </div>

                <h3 className="text-sm font-semibold mb-2 mt-4">Condition &amp; Battery (shown on the website)</h3>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-medium mb-1">Battery Health (%)</label>
                    <input
                      type="number" min={0} max={100}
                      value={batteryHealthPercent}
                      onChange={(e) => setBatteryHealthPercent(e.target.value)}
                      placeholder="e.g. 87"
                      className="border p-2 w-full rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Estimated Backup (hours)</label>
                    <input
                      type="number" min={0} step={0.5}
                      value={estimatedBackupHours}
                      onChange={(e) => setEstimatedBackupHours(e.target.value)}
                      placeholder="e.g. 4.5"
                      className="border p-2 w-full rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Screen Condition</label>
                    <SearchableSelect options={conditionGradeOptions} value={screenCondition} onChange={setScreenCondition} placeholder="Select..." />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Keyboard Condition</label>
                    <SearchableSelect options={conditionGradeOptions} value={keyboardCondition} onChange={setKeyboardCondition} placeholder="Select..." />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Body Condition</label>
                    <SearchableSelect options={conditionGradeOptions} value={bodyCondition} onChange={setBodyCondition} placeholder="Select..." />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Warranty (months)</label>
                    <input
                      type="number" min={0}
                      value={warrantyDurationMonths}
                      onChange={(e) => setWarrantyDurationMonths(e.target.value)}
                      placeholder="e.g. 6"
                      className="border p-2 w-full rounded"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium mb-1">Included Accessories</label>
                    <input
                      type="text"
                      value={includedAccessories}
                      onChange={(e) => setIncludedAccessories(e.target.value)}
                      placeholder="e.g. Charger only"
                      className="border p-2 w-full rounded"
                    />
                  </div>
                </div>

                <button
                  onClick={submitQC}
                  disabled={saving}
                  className="bg-primary text-primary-foreground px-4 py-2 rounded disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  {saving ? 'Saving…' : 'Submit QC Result'}
                </button>
              </>
            ) : showCompactQcSummary ? (
              <>
                <div className="flex items-center justify-between mb-1">
                  <h2 className="font-semibold">QC Summary</h2>
                  {canEditQC && (
                    <button type="button" onClick={() => setEditingQC(true)} className="text-primary underline text-sm">Edit QC</button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{qcSummaryLine}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No QC data recorded yet.</p>
            )}
          </div>
        </TabsContent>

        {/* ---------- Tab 3: Sale & Payment -- always rendered, even pre-sale ---------- */}
        <TabsContent value="sale">
          {!asset.sale_id ? (
            <div className="border rounded-lg p-4 mb-4">
              <h2 className="font-semibold mb-1">Sale Details</h2>
              <p className="text-sm text-muted-foreground">Not sold yet.</p>
            </div>
          ) : canSeeSaleDetails ? (
            <div className="border rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Sale Details</h2>
                <button onClick={() => setShowEditSale(true)} className="text-primary underline text-sm">Edit Sale</button>
              </div>
              {asset.sale_summary ? (
                <div className="mt-1">
                  <Field label="Customer">{asset.sale_summary.customer_name || '—'}</Field>
                  <Field label="Total">₹{(asset.sale_summary.sale_total ?? 0).toFixed(2)}</Field>
                  <Field label="Payment Status">
                    {asset.sale_summary.payment_status ? (
                      <span className="capitalize">
                        {asset.sale_summary.payment_status}
                        {typeof asset.sale_summary.amount_paid === 'number' && ` (₹${asset.sale_summary.amount_paid.toFixed(2)} paid)`}
                      </span>
                    ) : '—'}
                  </Field>
                  <Field label="Payment Date">{asset.sale_summary.payment_date ? asset.sale_summary.payment_date.slice(0, 10) : '—'}</Field>
                  <Field label="Bundled">
                    {asset.sale_summary.bundled_accessories_display.length > 0
                      ? asset.sale_summary.bundled_accessories_display.map((b, i) => (
                          <span key={i}>{i > 0 && ', '}{b.name}{b.quantity > 1 ? ` ×${b.quantity}` : ''}</span>
                        ))
                      : 'None'}
                  </Field>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">Customer, amount, SKU/laptop, and bundled accessories for this sale.</p>
              )}
            </div>
          ) : null}

          {isOwner && (
            <div className="border rounded-lg p-4 mb-4">
              <h2 className="font-semibold mb-3">Cost Adjustments</h2>
              <p className="text-sm text-muted-foreground mb-2">
                Original cost: ₹{(costPrice ?? 0).toFixed(2)}
                {adjustments.length > 0 && totalCost !== null && (
                  <> — Total cost: ₹{totalCost.toFixed(2)}</>
                )}
              </p>
              {adjustments.length > 0 && (
                <ul className="text-sm mb-3 divide-y border rounded max-h-32 overflow-y-auto">
                  {adjustments.map((a) => (
                    <li key={a.id} className="p-2 flex justify-between">
                      <span>{a.reason || '—'} <span className="text-muted-foreground text-xs">({a.created_at.slice(0, 10)})</span></span>
                      <span className="font-medium">₹{Number(a.amount).toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1">Amount (₹)</label>
                  <input
                    type="number"
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                    className="border p-2 w-full rounded"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1">Reason</label>
                  <input
                    type="text"
                    value={newReason}
                    onChange={(e) => setNewReason(e.target.value)}
                    placeholder="e.g. Upgraded to 16GB RAM"
                    className="border p-2 w-full rounded"
                  />
                </div>
                <button
                  onClick={addAdjustment}
                  disabled={savingAdjustment}
                  className="bg-primary text-primary-foreground px-4 py-2 rounded disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {savingAdjustment && <Loader2 className="size-4 animate-spin" />}
                  {savingAdjustment ? 'Adding…' : 'Add'}
                </button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {showEditSale && asset.sale_id && (
        <EditSaleDialog saleId={asset.sale_id} onClose={() => setShowEditSale(false)} onSaved={fetchAsset} />
      )}
    </div>
  )
}

export default function AssetQCPageGuarded() {
  // Standalone route -- reads assetId from the URL param (see AssetQCPage's default
  // `assetIdProp ?? params.id` above).
  return (
    <RequirePageAccess pageKey={['live_stock', 'stock']}>
      <AssetQCPage />
    </RequirePageAccess>
  )
}

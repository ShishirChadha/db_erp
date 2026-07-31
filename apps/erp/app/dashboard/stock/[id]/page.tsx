'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useRole } from '@/lib/auth/useRole'
import RequirePageAccess from '@/components/RequirePageAccess'
import { buildConfigSummary, ConfigSummaryTemplate } from '@/lib/sku-config-summary'
import { SearchableSelect } from '@/components/SearchableSelect'
import { useCustomOptions } from '@/lib/useCustomOptions'
import { EditSaleDialog } from '@/components/EditSaleDialog'

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
  checks: { check_item: string; result: string; notes: string | null }[]
}

function AssetQCPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const assetId = params.id as string
  const { isOwner, canEditPage } = useRole()
  // Reachable from both Live Stock and the main-ERP Stock page (same route), so either
  // page's edit grant unlocks correcting an asset's serial/asset number here.
  const canEditLiveStock = isOwner || canEditPage('live_stock') || canEditPage('stock')
  // Preserves which tab (current/sold/accessories/sold_accessories) the user came from --
  // plain browser-history back() would land on the bare list URL and lose that, same
  // pattern already used by app/dashboard/entry/sell/page.tsx.
  const returnTo = searchParams.get('return_to')
  const backHref = returnTo && returnTo.startsWith('/dashboard') ? returnTo : '/dashboard/live-stock'

  const [asset, setAsset] = useState<AssetDetail | null>(null)
  const [templates, setTemplates] = useState<ConfigSummaryTemplate[]>([])
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
      let res = await apiFetch('/api/stock', { method: 'PUT', body: JSON.stringify(body) })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        if (err.error_code === 'duplicate_serial' && confirm(`${err.error}\n\nProceed anyway?`)) {
          res = await apiFetch('/api/stock', { method: 'PUT', body: JSON.stringify({ ...body, confirm_duplicate: true }) })
          if (!res.ok) {
            const err2 = await res.json().catch(() => ({}))
            throw new Error(err2.error || 'Failed to save.')
          }
        } else if (err.error_code === 'duplicate_serial') {
          return
        } else {
          throw new Error(err.error || 'Failed to save.')
        }
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

  const fetchAsset = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/asset-ledger/${assetId}/qc`)
      if (!res.ok) throw new Error('Failed to load asset')
      const data: AssetDetail = await res.json()
      setAsset(data)
      setGrade(data.qc_grade || '')
      setNotes(data.qc_notes || '')
      setAssetNumberInput(data.asset_number || '')
      setSerialNumberInput(data.serial_number || '')
      setEntryDateInput(data.created_at ? data.created_at.slice(0, 10) : '')
      setNotesInput(data.notes || '')
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
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [assetId])

  useEffect(() => {
    fetchAsset()
  }, [fetchAsset])

  useEffect(() => {
    apiFetch('/api/sku-category-templates').then(res => res.json()).then((data) => {
      setTemplates(Array.isArray(data) ? data : [])
    })
  }, [])

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
  if (error) return <div className="p-4 text-red-600">Error: {error}</div>
  if (!asset) return null

  const sku = asset.purchase_order_items?.sku_master
  const canEditQC = ['qc_pending', 'qc_passed', 'faulty'].includes(asset.status)

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <button onClick={() => router.push(backHref)} className="text-sm text-gray-500 mb-2">&larr; Back</button>
      <h1 className="text-2xl font-bold mb-1">{asset.asset_number || (asset.serial_number ? `SN: ${asset.serial_number}` : '— no tag yet —')}</h1>
      <p className="text-gray-600 mb-1">
        {sku?.full_sku_code} — {buildConfigSummary(sku?.category, sku?.specifications, templates) || sku?.sku_description || `${sku?.brand || ''} ${sku?.model_name || ''}`}
      </p>
      <p className="text-sm text-gray-500 mb-4">
        {asset.warranty_type || asset.warranty_expiry_date
          ? `Warranty: ${asset.warranty_type || '—'}${asset.warranty_expiry_date ? ` — expires ${asset.warranty_expiry_date.slice(0, 10)}` : ''}`
          : 'No warranty on file.'}
      </p>

      <div className="flex gap-4 mb-6 text-sm">
        <div>
          <span className="text-gray-500">Serial:</span> {asset.serial_number || '—'}
        </div>
        <div>
          <span className="text-gray-500">Status:</span>{' '}
          <span className="font-medium capitalize">{asset.status.replace(/_/g, ' ')}</span>
        </div>
        <div>
          <span className="text-gray-500">QC Status:</span>{' '}
          <span className="font-medium capitalize">{asset.qc_status}</span>
        </div>
        {asset.qc_grade && (
          <div>
            <span className="text-gray-500">Grade:</span> <span className="font-medium">{asset.qc_grade}</span>
          </div>
        )}
      </div>

      {canEditLiveStock && (
        <div className="border rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Unit Details</h2>
            {!editingTag && (
              <button onClick={() => setEditingTag(true)} className="text-blue-600 underline text-sm">Edit</button>
            )}
          </div>
          {editingTag ? (
            <div className="space-y-2">
              {tagErr && <div className="text-red-600 text-sm">{tagErr}</div>}
              {lockedStatus && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
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
                  className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50 inline-flex items-center gap-1.5"
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
            <div className="text-sm text-gray-600 space-y-1">
              <p>{asset.asset_number || '—'} · {asset.serial_number || '—'}</p>
              <p className="text-xs text-gray-500">
                Entry: {asset.created_at?.slice(0, 10) || '—'}
                {asset.notes && <> · {asset.notes}</>}
              </p>
            </div>
          )}
        </div>
      )}

      {asset.sale_id && (isOwner || canEditPage('live_stock') || canEditPage('stock') || canEditPage('sales')) && (
        <div className="border rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Sale Details</h2>
            <button onClick={() => setShowEditSale(true)} className="text-blue-600 underline text-sm">Edit Sale</button>
          </div>
          <p className="text-sm text-gray-500 mt-1">Customer, amount, SKU/laptop, and bundled accessories for this sale.</p>
        </div>
      )}

      {showEditSale && asset.sale_id && (
        <EditSaleDialog saleId={asset.sale_id} onClose={() => setShowEditSale(false)} onSaved={fetchAsset} />
      )}

      {asset.status === 'qc_passed' && (
        <div className="mb-6 p-3 bg-green-50 border border-green-200 rounded flex items-center justify-between">
          <span className="text-green-800 text-sm">QC passed. Ready to list this unit for sale?</span>
          <button
            onClick={markReady}
            disabled={saving}
            className="bg-green-600 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Mark Ready for Sale
          </button>
        </div>
      )}

      {canEditQC && (
        <div className="border rounded-lg p-4">
          <h2 className="font-semibold mb-3">
            {asset.qc_status === 'pending' ? 'Run QC Checklist' : 'Re-run QC Checklist'}
          </h2>

          <div className="space-y-2 mb-4">
            {checkResults.map((c, idx) => (
              <div key={c.check_item} className="flex items-center gap-3 border-b pb-2">
                <span className="flex-1 text-sm">{c.check_item}</span>
                <div className="flex gap-1">
                  {(['pass', 'fail', 'na'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => updateCheck(idx, 'result', r)}
                      className={`px-2 py-1 text-xs rounded border ${
                        c.result === r
                          ? r === 'pass'
                            ? 'bg-green-600 text-white border-green-600'
                            : r === 'fail'
                            ? 'bg-red-600 text-white border-red-600'
                            : 'bg-gray-500 text-white border-gray-500'
                          : 'border-gray-200 text-gray-600'
                      }`}
                    >
                      {r.toUpperCase()}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="Notes"
                  value={c.notes}
                  onChange={(e) => updateCheck(idx, 'notes', e.target.value)}
                  className="border rounded px-2 py-1 text-xs w-32"
                />
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
            className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? 'Saving…' : 'Submit QC Result'}
          </button>
        </div>
      )}

      {isOwner && (
        <div className="border rounded-lg p-4 mt-6">
          <h2 className="font-semibold mb-3">Cost Adjustments</h2>
          <p className="text-sm text-gray-600 mb-2">
            Original cost: ₹{(costPrice ?? 0).toFixed(2)}
            {adjustments.length > 0 && totalCost !== null && (
              <> — Total cost: ₹{totalCost.toFixed(2)}</>
            )}
          </p>
          {adjustments.length > 0 && (
            <ul className="text-sm mb-3 divide-y border rounded">
              {adjustments.map((a) => (
                <li key={a.id} className="p-2 flex justify-between">
                  <span>{a.reason || '—'} <span className="text-gray-400 text-xs">({a.created_at.slice(0, 10)})</span></span>
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
              className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {savingAdjustment && <Loader2 className="size-4 animate-spin" />}
              {savingAdjustment ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AssetQCPageGuarded() {
  return (
    <RequirePageAccess pageKey={['live_stock', 'stock']}>
      <AssetQCPage />
    </RequirePageAccess>
  )
}

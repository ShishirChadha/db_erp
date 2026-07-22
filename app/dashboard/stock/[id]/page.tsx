'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'
import { useRole } from '@/lib/auth/useRole'
import RequirePageAccess from '@/components/RequirePageAccess'

const DEFAULT_CHECK_ITEMS = [
  'Screen',
  'Keyboard',
  'Trackpad',
  'Battery Health',
  'Ports / Connectivity',
  'Body / Cosmetic Condition',
  'Boot / OS',
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
  qc_grade: string | null
  qc_status: string
  qc_notes: string | null
  qc_at: string | null
  purchase_order_items: {
    sku_master: {
      full_sku_code: string
      sku_description: string
      category: string
      brand: string
      model_name: string
    } | null
  } | null
  checks: { check_item: string; result: string; notes: string | null }[]
}

function AssetQCPage() {
  const params = useParams()
  const router = useRouter()
  const assetId = params.id as string
  const { isOwner } = useRole()

  const [asset, setAsset] = useState<AssetDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [checkResults, setCheckResults] = useState<CheckResult[]>([])
  const [grade, setGrade] = useState('')
  const [notes, setNotes] = useState('')

  // Owner-only cost tracking (original cost + any upgrade/refurb adjustments).
  const [costPrice, setCostPrice] = useState<number | null>(null)
  const [adjustments, setAdjustments] = useState<CostAdjustment[]>([])
  const [totalCost, setTotalCost] = useState<number | null>(null)
  const [newAmount, setNewAmount] = useState('')
  const [newReason, setNewReason] = useState('')
  const [savingAdjustment, setSavingAdjustment] = useState(false)

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

  const fetchAsset = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/asset-ledger/${assetId}/qc`)
      if (!res.ok) throw new Error('Failed to load asset')
      const data: AssetDetail = await res.json()
      setAsset(data)
      setGrade(data.qc_grade || '')
      setNotes(data.qc_notes || '')

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
        body: JSON.stringify({ checks: checkResults, qc_grade: grade || null, qc_notes: notes || null }),
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
      <button onClick={() => router.back()} className="text-sm text-gray-500 mb-2">&larr; Back</button>
      <h1 className="text-2xl font-bold mb-1">{asset.asset_number || (asset.serial_number ? `SN: ${asset.serial_number}` : '— no tag yet —')}</h1>
      <p className="text-gray-600 mb-4">
        {sku?.full_sku_code} — {sku?.sku_description || `${sku?.brand || ''} ${sku?.model_name || ''}`}
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

      {asset.status === 'qc_passed' && (
        <div className="mb-6 p-3 bg-green-50 border border-green-200 rounded flex items-center justify-between">
          <span className="text-green-800 text-sm">QC passed. Ready to list this unit for sale?</span>
          <button
            onClick={markReady}
            disabled={saving}
            className="bg-green-600 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
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

          <button
            onClick={submitQC}
            disabled={saving}
            className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
          >
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
              className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
            >
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
    <RequirePageAccess pageKey="live_stock">
      <AssetQCPage />
    </RequirePageAccess>
  )
}

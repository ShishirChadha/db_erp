'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { SimpleModal } from '@/components/SimpleModal'

interface Candidate {
  id: string
  full_sku_code: string
  category: string
  brand: string
  model_name: string
  quantity_in_stock: number | null
}

interface SourcePreview {
  id: string
  full_sku_code: string
  quantity_in_stock: number | null
  asset_count: number
  invoiced_asset_count: number
  reorder_rule_count: number
  category_mismatch: boolean
}

// Bulk-merges a cluster of duplicate sku_master rows into one canonical SKU --
// repoints every referencing table (asset_ledger, purchase_order_items,
// invoice_items, sales_document_items, sales, repair_job_parts, reorder_rules)
// and archives the rest. Deliberately separate from FixSkuDialog, which reassigns
// one asset (or one PO line item) at a time and has no concept of archiving a
// whole sku_master row.
export function MergeSkuDialog({
  candidates,
  onClose,
  onMerged,
}: {
  candidates: Candidate[]
  onClose: () => void
  onMerged: () => void
}) {
  const [targetId, setTargetId] = useState<string>(() => {
    const best = [...candidates].sort((a, b) => (b.quantity_in_stock || 0) - (a.quantity_in_stock || 0))[0]
    return best?.id || candidates[0]?.id
  })
  const [reason, setReason] = useState('')
  const [previews, setPreviews] = useState<SourcePreview[] | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const sourceIds = candidates.filter((c) => c.id !== targetId).map((c) => c.id)
  const target = candidates.find((c) => c.id === targetId)

  useEffect(() => {
    if (sourceIds.length === 0) { setPreviews(null); return }
    setLoadingPreview(true)
    const params = new URLSearchParams({ source_ids: sourceIds.join(','), target_id: targetId })
    apiFetch(`/api/sku-master/merge?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => setPreviews(data.sources || []))
      .catch(() => setPreviews(null))
      .finally(() => setLoadingPreview(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId])

  const totalQuantity = previews?.reduce((sum, p) => sum + (p.quantity_in_stock || 0), 0) || 0
  const totalAssets = previews?.reduce((sum, p) => sum + p.asset_count, 0) || 0
  const totalInvoiced = previews?.reduce((sum, p) => sum + p.invoiced_asset_count, 0) || 0

  const handleMerge = async () => {
    if (!target || sourceIds.length === 0) return
    const confirmMsg = `Merge ${sourceIds.length} SKU(s) into ${target.full_sku_code}?\n\n` +
      `This will move ${totalQuantity} unit(s) of stock and ${totalAssets} tracked asset(s)` +
      (totalInvoiced > 0 ? ` (${totalInvoiced} already invoiced)` : '') +
      ` onto ${target.full_sku_code}, and archive the other ${sourceIds.length} SKU row(s). This cannot be undone from the UI.`
    if (!confirm(confirmMsg)) return

    setSubmitting(true)
    setError('')
    try {
      const res = await apiFetch('/api/sku-master/merge', {
        method: 'POST',
        body: JSON.stringify({ source_ids: sourceIds, target_id: targetId, reason: reason || undefined }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Merge failed')
      }
      onMerged()
      onClose()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SimpleModal isOpen onClose={onClose} title="Merge duplicate SKUs" wide>
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Pick the SKU to keep. Every other SKU below will have its stock, assets, and sale/purchase
          history moved onto it, then be archived (not deleted).
        </p>

        {error && <div className="text-red-600 text-sm">{error}</div>}

        <div className="border rounded divide-y">
          {candidates.map((c) => {
            const preview = previews?.find((p) => p.id === c.id)
            return (
              <label key={c.id} className="flex items-start gap-3 p-3 cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="merge-target"
                  className="mt-1"
                  checked={targetId === c.id}
                  onChange={() => setTargetId(c.id)}
                />
                <div className="flex-1">
                  <div className="font-medium">{c.full_sku_code}</div>
                  <div className="text-xs text-gray-500">{c.brand} {c.model_name} -- {c.quantity_in_stock ?? 0} in stock</div>
                  {targetId !== c.id && (
                    <div className="text-xs text-gray-500 mt-1">
                      {loadingPreview && !preview ? (
                        <span className="inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> Checking...</span>
                      ) : preview ? (
                        <span>
                          Will move: {preview.quantity_in_stock ?? 0} stock, {preview.asset_count} asset(s)
                          {preview.invoiced_asset_count > 0 && `, ${preview.invoiced_asset_count} already invoiced`}
                          {preview.reorder_rule_count > 0 && `, ${preview.reorder_rule_count} reorder rule(s)`}
                          {preview.category_mismatch && <span className="text-amber-600 font-medium"> -- different category, cannot merge</span>}
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              </label>
            )
          })}
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">Reason (optional, kept in the audit log)</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Same model, spelling variants"
            className="border p-2 w-full rounded"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="px-4 py-2 border rounded" disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleMerge}
            disabled={submitting || sourceIds.length === 0 || previews?.some((p) => p.category_mismatch)}
            className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50 inline-flex items-center gap-2"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Merge into {target?.full_sku_code || '...'}
          </button>
        </div>
      </div>
    </SimpleModal>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useRole } from '@/lib/auth/useRole'
import { SkuFormModal } from '@/components/SkuFormModal'
import { SimpleModal } from '@/components/SimpleModal'

interface SkuOption {
  id: string
  full_sku_code: string
  sku_description: string
}

interface CategoryTemplate {
  category: string
  display_name: string
  field_schema: any
  sku_code_format?: string
}

// Lets the seller search for (or create) the correct SKU and reassign the asset
// (or its whole PO line item, if it has one) to it. Two entry points share this:
// StockView's owner-only "Fix SKU" (correcting a data-entry mistake), and the
// Sell form's "Change SKU" (recording a physical upgrade before resale, open to
// any role). The optional cost field is owner-only either way, since cost data is
// never shown to employees.
export function FixSkuDialog({
  assetId,
  onClose,
  onReassigned,
}: {
  assetId: string
  onClose: () => void
  onReassigned: () => void
}) {
  const { isOwner } = useRole()
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<SkuOption[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [showCreateSku, setShowCreateSku] = useState(false)
  const [templates, setTemplates] = useState<CategoryTemplate[]>([])
  const [upgradeCost, setUpgradeCost] = useState('')
  const [upgradeReason, setUpgradeReason] = useState('')

  useEffect(() => {
    if (!search.trim()) { setOptions([]); return }
    const timer = setTimeout(() => {
      apiFetch(`/api/sku-master?search=${encodeURIComponent(search)}`)
        .then(res => res.json())
        .then(setOptions)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    apiFetch('/api/sku-category-templates').then(res => res.json()).then(setTemplates)
  }, [])

  const reassignTo = async (sku: SkuOption) => {
    setError('')
    setSubmitting(true)
    try {
      const infoRes = await apiFetch(`/api/asset-ledger/${assetId}/reassign-sku`)
      if (!infoRes.ok) throw new Error('Failed to check affected units')
      const info = await infoRes.json()

      const confirmMsg = info.po_item_id
        ? `This will reassign ${info.affected_count} unit${info.affected_count !== 1 ? 's' : ''} (the whole PO line item) to ${sku.full_sku_code}. Continue?`
        : `Reassign this unit to ${sku.full_sku_code}?`
      if (!confirm(confirmMsg)) { setSubmitting(false); return }

      let res = await apiFetch(`/api/asset-ledger/${assetId}/reassign-sku`, {
        method: 'PATCH',
        body: JSON.stringify({ new_sku_id: sku.id }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        // Already invoiced -- let the seller confirm they understand the invoice
        // won't reflect this change, rather than silently blocking or allowing it.
        if (err.error_code === 'already_invoiced' && confirm(`${err.error}\n\nProceed anyway?`)) {
          res = await apiFetch(`/api/asset-ledger/${assetId}/reassign-sku`, {
            method: 'PATCH',
            body: JSON.stringify({ new_sku_id: sku.id, confirm_despite_invoice: true }),
          })
          if (!res.ok) {
            const err2 = await res.json().catch(() => ({}))
            throw new Error(err2.error || 'Reassignment failed')
          }
        } else if (err.error_code === 'already_invoiced') {
          setSubmitting(false)
          return
        } else {
          throw new Error(err.error || 'Reassignment failed')
        }
      }

      if (isOwner && upgradeCost.trim()) {
        const costRes = await apiFetch(`/api/asset-ledger/${assetId}/cost-adjustments`, {
          method: 'POST',
          body: JSON.stringify({ amount: Number(upgradeCost), reason: upgradeReason || 'SKU reassignment' }),
        })
        if (!costRes.ok) {
          const err = await costRes.json().catch(() => ({}))
          throw new Error(err.error || 'Reassigned, but failed to record the upgrade cost')
        }
      }

      onReassigned()
      onClose()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (showCreateSku) {
    return (
      <SkuFormModal
        templates={templates}
        existingSku={null}
        onClose={() => setShowCreateSku(false)}
        onSaved={(sku) => { setShowCreateSku(false); reassignTo(sku) }}
      />
    )
  }

  return (
    <SimpleModal isOpen onClose={onClose} title="Change SKU">
      <div>
        <p className="text-sm text-gray-500 mb-3">
          Search for the correct SKU to reassign this unit to, or create a new one.
        </p>
        {error && <div className="text-red-600 text-sm mb-2">{error}</div>}
        <input
          type="text"
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search SKU code or description..."
          className="border p-2 w-full rounded mb-2"
        />
        {options.length > 0 && (
          <ul className="border rounded divide-y max-h-64 overflow-y-auto mb-3">
            {options.map(sku => (
              <li key={sku.id}>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => reassignTo(sku)}
                  className="w-full text-left p-2 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2"
                >
                  {submitting && <Loader2 className="size-4 animate-spin shrink-0" />}
                  <div>
                    <div className="font-medium">{sku.full_sku_code}</div>
                    <div className="text-xs text-gray-500">{sku.sku_description}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {search.trim() && options.length === 0 && (
          <p className="text-sm text-gray-500 mb-3">No matching SKU found.</p>
        )}
        <button
          type="button"
          onClick={() => setShowCreateSku(true)}
          className="text-blue-600 underline text-sm mb-3"
        >
          + Create new SKU
        </button>

        {isOwner && (
          <div className="border-t pt-3 mt-1 space-y-2">
            <p className="text-xs text-gray-500">Optional -- record the cost of this upgrade (e.g. added RAM/SSD):</p>
            <div>
              <label className="block text-xs font-medium">Additional cost (₹)</label>
              <input
                type="number"
                value={upgradeCost}
                onChange={(e) => setUpgradeCost(e.target.value)}
                className="border p-2 w-full rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-medium">Reason</label>
              <input
                type="text"
                value={upgradeReason}
                onChange={(e) => setUpgradeReason(e.target.value)}
                placeholder="e.g. Upgraded to 16GB RAM + 512GB SSD"
                className="border p-2 w-full rounded"
              />
            </div>
          </div>
        )}

        <div className="flex justify-end mt-3">
          <button type="button" onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
        </div>
      </div>
    </SimpleModal>
  )
}

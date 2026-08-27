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
  specifications?: Record<string, any>
}

interface CategoryTemplate {
  category: string
  display_name: string
  field_schema: any
  sku_code_format?: string
}

// RAM/SSD are the two physical-swap fields this business already treats specially
// (same fields as sku_upgrade_rules.ALLOWED_FIELDS on the website side) -- the only
// ones worth auto-diffing to detect an upgrade/downgrade on reassignment.
const COMPONENT_FIELDS = ['ram', 'ssd'] as const
type ComponentField = (typeof COMPONENT_FIELDS)[number]
interface ComponentChange {
  field: ComponentField
  from: string
  to: string
  direction: 'up' | 'down'
}
const ACCESSORY_CATEGORIES = 'RAM,SSD,CPU,GPU,KBD,MOUSE,ACC,ADP'

function parseLeadingInt(v: any): number | null {
  const m = String(v ?? '').match(/\d+/)
  return m ? parseInt(m[0], 10) : null
}

// Compares the unit's spec before vs. after a reassignment on RAM/SSD only --
// skips a field entirely if either side is missing/unparseable/equal, so a plain
// data-entry correction (e.g. fixing a brand typo) never triggers a false positive.
function diffComponents(
  oldSpecs: Record<string, any> | null | undefined,
  newSpecs: Record<string, any> | null | undefined
): ComponentChange[] {
  if (!oldSpecs || !newSpecs) return []
  const changes: ComponentChange[] = []
  for (const field of COMPONENT_FIELDS) {
    const from = oldSpecs[field]
    const to = newSpecs[field]
    if (!from || !to || from === to) continue
    const fromNum = parseLeadingInt(from)
    const toNum = parseLeadingInt(to)
    if (fromNum === null || toNum === null || fromNum === toNum) continue
    changes.push({ field, from: String(from), to: String(to), direction: toNum < fromNum ? 'down' : 'up' })
  }
  return changes
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

  // Set once reassignment succeeds AND at least one tracked component (RAM/SSD)
  // actually changed -- switches the dialog into the follow-up stock-adjustment
  // step instead of closing immediately. Most reassignments are plain corrections
  // with no RAM/SSD change, so this stays null and the dialog closes as before.
  const [pendingChanges, setPendingChanges] = useState<ComponentChange[] | null>(null)
  const [newSkuLabel, setNewSkuLabel] = useState('')

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

      // info.current_sku is the unit's spec BEFORE this reassignment (fetched by the
      // GET above, ahead of the PATCH) -- diff it against the SKU just reassigned to.
      const changes = diffComponents(info.current_sku?.specifications, sku.specifications)
      if (changes.length > 0) {
        setNewSkuLabel(sku.full_sku_code)
        setPendingChanges(changes)
      } else {
        onReassigned()
        onClose()
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (pendingChanges) {
    return (
      <ComponentStockFollowUp
        changes={pendingChanges}
        newSkuLabel={newSkuLabel}
        onDone={() => { onReassigned(); onClose() }}
      />
    )
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

// Shown only when the reassignment actually changed RAM and/or SSD -- one row per
// changed field, each independently searchable/skippable, so staff aren't forced
// to log anything that doesn't apply (e.g. the part was sourced externally).
function ComponentStockFollowUp({
  changes,
  newSkuLabel,
  onDone,
}: {
  changes: ComponentChange[]
  newSkuLabel: string
  onDone: () => void
}) {
  return (
    <SimpleModal isOpen onClose={onDone} title="Change SKU">
      <div className="space-y-3">
        <p className="text-sm text-gray-500">
          Reassigned to <span className="font-medium">{newSkuLabel}</span>. This changed:
        </p>
        {changes.map((c) => (
          <ComponentStockRow key={c.field} change={c} />
        ))}
        <div className="flex justify-end pt-2">
          <button type="button" onClick={onDone} className="px-4 py-2 bg-blue-600 text-white rounded">Done</button>
        </div>
      </div>
    </SimpleModal>
  )
}

function ComponentStockRow({ change }: { change: ComponentChange }) {
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<SkuOption[]>([])
  const [selected, setSelected] = useState<SkuOption | null>(null)
  const [qty, setQty] = useState('1')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [skipped, setSkipped] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!search.trim()) { setOptions([]); return }
    const timer = setTimeout(() => {
      apiFetch(`/api/sku-master?category=${ACCESSORY_CATEGORIES}&search=${encodeURIComponent(search)}`)
        .then(res => res.json())
        .then((data) => setOptions(Array.isArray(data) ? data : []))
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const isDowngrade = change.direction === 'down'
  const label = change.field.toUpperCase()
  const message = isDowngrade
    ? `${label} decreased from ${change.from} to ${change.to} -- log the removed component back into stock?`
    : `${label} increased from ${change.from} to ${change.to} -- if it came from your own accessory stock (not bought fresh for this), deduct it now:`

  const submit = async () => {
    if (!selected) return
    setSubmitting(true)
    setErr('')
    const n = Number(qty) || 1
    const res = await apiFetch(`/api/sku-master/${selected.id}/stock-movement`, {
      method: 'POST',
      body: JSON.stringify({
        movement_type: isDowngrade ? 'receipt' : 'adjustment',
        quantity_change: isDowngrade ? n : -n,
        notes: `${isDowngrade ? 'Removed' : 'Used'} during SKU reassignment (${label} ${change.from} → ${change.to})`,
      }),
    })
    setSubmitting(false)
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      setErr(e.error || 'Failed to update stock.')
      return
    }
    setDone(true)
  }

  if (done) {
    return <div className="border rounded p-2 text-sm text-green-600">✓ {label}: stock updated.</div>
  }
  if (skipped) {
    return <div className="border rounded p-2 text-sm text-gray-400">{label}: skipped.</div>
  }

  return (
    <div className="border rounded p-2 space-y-2">
      <p className="text-sm">{message}</p>
      {err && <p className="text-xs text-red-600">{err}</p>}
      {!selected ? (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search accessory SKU..."
          className="border p-2 w-full rounded text-sm"
        />
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-sm flex-1 truncate">{selected.full_sku_code}</span>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="border p-1 w-16 rounded text-sm text-right"
          />
          <button type="button" disabled={submitting} onClick={submit} className="text-xs bg-blue-600 text-white px-2 py-1 rounded disabled:opacity-50 shrink-0">
            {submitting ? '...' : isDowngrade ? 'Receive to Stock' : 'Deduct from Stock'}
          </button>
          <button type="button" onClick={() => setSelected(null)} className="text-xs text-gray-500 underline shrink-0">Change</button>
        </div>
      )}
      {!selected && options.length > 0 && (
        <ul className="border rounded divide-y max-h-32 overflow-y-auto text-sm">
          {options.map((o) => (
            <li
              key={o.id}
              onClick={() => { setSelected(o); setSearch(''); setOptions([]) }}
              className="p-2 hover:bg-gray-50 cursor-pointer"
            >
              {o.full_sku_code} — {o.sku_description}
            </li>
          ))}
        </ul>
      )}
      {!selected && (
        <button type="button" onClick={() => setSkipped(true)} className="text-xs text-gray-500 underline">Skip</button>
      )}
    </div>
  )
}

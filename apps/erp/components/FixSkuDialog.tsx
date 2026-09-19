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

// A spec value with no digits in it (real data in this business: "No", "N/A", "",
// missing entirely) means "nothing installed" -- zero capacity, not "can't compare."
// Treating it as null/skip (the original behavior) silently missed the exact case
// this feature exists for: a "No RAM" unit getting real RAM added.
function componentCapacity(v: any): number {
  return parseLeadingInt(v) ?? 0
}

// Compares the unit's spec before vs. after a reassignment on RAM/SSD only -- skips
// a field only when there's truly nothing to compare (no new value) or the capacity
// is unchanged (covers both a plain data-entry correction, e.g. fixing a brand typo,
// and two different-looking "nothing installed" spellings like "No" -> "").
function diffComponents(
  oldSpecs: Record<string, any> | null | undefined,
  newSpecs: Record<string, any> | null | undefined
): ComponentChange[] {
  if (!oldSpecs || !newSpecs) return []
  const changes: ComponentChange[] = []
  for (const field of COMPONENT_FIELDS) {
    const from = oldSpecs[field]
    const to = newSpecs[field]
    if (to === undefined || to === null || from === to) continue
    const fromNum = componentCapacity(from)
    const toNum = componentCapacity(to)
    if (fromNum === toNum) continue
    changes.push({ field, from: from ? String(from) : 'None', to: String(to), direction: toNum < fromNum ? 'down' : 'up' })
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
      if (!infoRes.ok) throw new Error('Failed to check current spec')
      const info = await infoRes.json()

      // Only ever changes THIS unit's current/effective spec -- never rewrites the
      // original purchase record, and never affects any other unit (even one sharing
      // the same PO line item), so this confirmation is always the same, simple line.
      if (!confirm(`Reassign this unit to ${sku.full_sku_code}? This only changes this unit's current spec -- it does not alter the original purchase record.`)) {
        setSubmitting(false)
        return
      }

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
        assetId={assetId}
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
        <p className="text-sm text-muted-foreground mb-3">
          Search for the correct SKU to reassign this unit to, or create a new one.
        </p>
        {error && <div className="text-destructive text-sm mb-2">{error}</div>}
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
                  className="w-full text-left p-2 hover:bg-muted disabled:opacity-50 flex items-center gap-2"
                >
                  {submitting && <Loader2 className="size-4 animate-spin shrink-0" />}
                  <div>
                    <div className="font-medium">{sku.full_sku_code}</div>
                    <div className="text-xs text-muted-foreground">{sku.sku_description}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {search.trim() && options.length === 0 && (
          <p className="text-sm text-muted-foreground mb-3">No matching SKU found.</p>
        )}
        <button
          type="button"
          onClick={() => setShowCreateSku(true)}
          className="text-primary underline text-sm mb-3"
        >
          + Create new SKU
        </button>

        {isOwner && (
          <div className="border-t pt-3 mt-1 space-y-2">
            <p className="text-xs text-muted-foreground">Optional -- record the cost of this upgrade (e.g. added RAM/SSD):</p>
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
// changed field, each independently searchable. "Done" is disabled until every row
// is resolved (stock deducted/received, or skipped with a typed reason) -- staff
// aren't forced to log anything that doesn't apply (e.g. the part was sourced
// externally), but they can't silently close this leaving the unit's spec and the
// accessory's stock count out of sync with no trace of why.
function ComponentStockFollowUp({
  changes,
  newSkuLabel,
  assetId,
  onDone,
}: {
  changes: ComponentChange[]
  newSkuLabel: string
  assetId: string
  onDone: () => void
}) {
  const [resolved, setResolved] = useState<boolean[]>(() => changes.map(() => false))
  const allResolved = resolved.every(Boolean)

  return (
    <SimpleModal isOpen onClose={() => allResolved && onDone()} title="Change SKU">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Reassigned to <span className="font-medium">{newSkuLabel}</span>. This changed:
        </p>
        {changes.map((c, i) => (
          <ComponentStockRow
            key={c.field}
            change={c}
            assetId={assetId}
            onResolved={() => setResolved((prev) => prev.map((v, idx) => (idx === i ? true : v)))}
          />
        ))}
        {!allResolved && (
          <p className="text-xs text-muted-foreground">Resolve every row above (deduct/receive stock, or skip with a reason) to continue.</p>
        )}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onDone}
            disabled={!allResolved}
            className="px-4 py-2 bg-primary text-primary-foreground rounded disabled:opacity-50"
          >
            Done
          </button>
        </div>
      </div>
    </SimpleModal>
  )
}

function ComponentStockRow({ change, assetId, onResolved }: { change: ComponentChange; assetId: string; onResolved: () => void }) {
  const { isOwner } = useRole()
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<SkuOption[]>([])
  const [selected, setSelected] = useState<SkuOption | null>(null)
  const [qty, setQty] = useState('1')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [costNote, setCostNote] = useState('')
  const [previewPrice, setPreviewPrice] = useState<number | null>(null)
  const [skipping, setSkipping] = useState(false)
  const [skipReason, setSkipReason] = useState('')
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

  // Preview only -- the actual cost recorded on submit is always computed fresh
  // server-side, this is just so the owner isn't confirming blind.
  useEffect(() => {
    setPreviewPrice(null)
    if (!selected || !isOwner) return
    apiFetch(`/api/sku-master/last-entry-vendors?ids=${selected.id}`)
      .then(res => res.json())
      .then((data) => setPreviewPrice(data?.[selected.id]?.unit_price ?? null))
  }, [selected, isOwner])

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
    // Moves the accessory stock AND -- using that SKU's own last purchase price --
    // automatically costs the swap against this unit (asset_cost_adjustments), so
    // COGS/margin reporting reflects every component actually pulled from our stock,
    // not just an upfront manual guess. Several rows (e.g. RAM and SSD both changing)
    // each add their own entry and simply sum, no combining step needed.
    const res = await apiFetch(`/api/asset-ledger/${assetId}/component-stock-adjustment`, {
      method: 'POST',
      body: JSON.stringify({
        sku_id: selected.id,
        quantity: n,
        direction: change.direction,
        field: change.field,
        from: change.from,
        to: change.to,
      }),
    })
    setSubmitting(false)
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      setErr(e.error || 'Failed to update stock.')
      return
    }
    const json = await res.json().catch(() => ({}))
    if (isOwner) {
      setCostNote(
        json.cost_recorded && typeof json.amount === 'number'
          ? `${json.amount >= 0 ? '+' : ''}₹${json.amount.toFixed(2)} added to this unit's cost.`
          : 'Stock updated -- no purchase price on record for this SKU, so cost wasn\'t added automatically (add it via Cost Adjustments if needed).'
      )
    }
    setDone(true)
    onResolved()
  }

  const confirmSkip = async () => {
    if (!skipReason.trim()) return
    setSubmitting(true)
    setErr('')
    const res = await apiFetch(`/api/asset-ledger/${assetId}/component-upgrade-skip`, {
      method: 'POST',
      body: JSON.stringify({ field: change.field, from: change.from, to: change.to, reason: skipReason.trim() }),
    })
    setSubmitting(false)
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      setErr(e.error || 'Failed to record the skip reason.')
      return
    }
    setSkipped(true)
    onResolved()
  }

  if (done) {
    return (
      <div className="border rounded p-2 text-sm text-success">
        ✓ {label}: stock updated.{costNote && <div className="text-xs text-muted-foreground mt-0.5">{costNote}</div>}
      </div>
    )
  }
  if (skipped) {
    return <div className="border rounded p-2 text-sm text-muted-foreground">{label}: skipped -- {skipReason}</div>
  }

  return (
    <div className="border rounded p-2 space-y-2">
      <p className="text-sm">{message}</p>
      {err && <p className="text-xs text-destructive">{err}</p>}
      {!selected ? (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search accessory SKU..."
          className="border p-2 w-full rounded text-sm"
        />
      ) : (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm flex-1 truncate">{selected.full_sku_code}</span>
            <input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="border p-1 w-16 rounded text-sm text-right"
            />
            <button type="button" disabled={submitting} onClick={submit} className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded disabled:opacity-50 shrink-0">
              {submitting ? '...' : isDowngrade ? 'Receive to Stock' : 'Deduct from Stock'}
            </button>
            <button type="button" onClick={() => setSelected(null)} className="text-xs text-muted-foreground underline shrink-0">Change</button>
          </div>
          {isOwner && (
            <p className="text-xs text-muted-foreground">
              {previewPrice != null
                ? `Est. cost: ${(Number(qty) || 1)} × ₹${previewPrice.toFixed(2)} = ₹${((Number(qty) || 1) * previewPrice).toFixed(2)} (from last purchase price)`
                : 'No purchase price on record for this SKU -- cost won\'t be added automatically.'}
            </p>
          )}
        </div>
      )}
      {!selected && options.length > 0 && (
        <ul className="border rounded divide-y max-h-32 overflow-y-auto text-sm">
          {options.map((o) => (
            <li
              key={o.id}
              onClick={() => { setSelected(o); setSearch(''); setOptions([]) }}
              className="p-2 hover:bg-muted cursor-pointer"
            >
              {o.full_sku_code} — {o.sku_description}
            </li>
          ))}
        </ul>
      )}
      {!selected && !skipping && (
        <button type="button" onClick={() => setSkipping(true)} className="text-xs text-muted-foreground underline">Skip</button>
      )}
      {!selected && skipping && (
        <div className="flex items-center gap-2">
          <input
            value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)}
            placeholder="Why? e.g. customer supplied their own RAM"
            className="border p-1 flex-1 rounded text-sm"
            autoFocus
          />
          <button
            type="button"
            disabled={submitting || !skipReason.trim()}
            onClick={confirmSkip}
            className="text-xs bg-muted-foreground/20 px-2 py-1 rounded disabled:opacity-50 shrink-0"
          >
            {submitting ? '...' : 'Confirm Skip'}
          </button>
          <button type="button" onClick={() => setSkipping(false)} className="text-xs text-muted-foreground underline shrink-0">Cancel</button>
        </div>
      )}
    </div>
  )
}

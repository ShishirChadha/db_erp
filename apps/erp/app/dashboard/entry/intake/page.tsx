'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api-client'
import { useCustomOptions } from '@/lib/useCustomOptions'
import { SearchableSelect } from '@/components/SearchableSelect'
import RequirePageAccess from '@/components/RequirePageAccess'
import { CategorySpecFields, parseFieldSchema } from '@/components/CategorySpecFields'
import { TYPE_TO_CATEGORY } from '@/lib/sku-category-map'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { ReviewSummaryDialog } from '@/components/ReviewSummaryDialog'
import { AccessoryBundlePicker, type BundledAccessory } from '@/components/AccessoryBundlePicker'
import { BundleMonitorFields, EMPTY_BUNDLED_MONITOR, type BundledMonitor } from '@/components/BundleMonitorFields'

interface CategoryTemplate {
  category: string
  display_name: string
  field_schema: any
}

const BUYER_OPTIONS = ['Digitalbluez', 'Techtenth', 'Cash', 'Other']

function today() {
  return new Date().toISOString().slice(0, 10)
}

// The category's own field, if any, that identifies "which model/item this is" --
// LAP/DES/TAB call it `model`, OTHER calls it `item_name`; Monitor has neither (brand +
// size already fully identify it, matching SKU Master's own MON template).
function findIdentityField(fields: any[]): string | undefined {
  return fields.find((f: any) => f.name === 'model' || f.name === 'item_name')?.name
}

function StockIntakePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Where to return after Back/Done -- the page this form was opened from (Live
  // Stock, Stock, etc.), falling back to the New Entry hub when opened from there.
  const returnTo = searchParams.get('return_to')
  const backHref = returnTo && returnTo.startsWith('/dashboard') ? returnTo : '/dashboard/entry'
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const [templates, setTemplates] = useState<CategoryTemplate[]>([])

  // Starts empty rather than defaulting straight to 'Laptop' -- SearchableSelect decides
  // dropdown-vs-free-text mode once on mount based on whether its value is already in
  // options, and options here loads asynchronously from custom_options; a non-empty
  // default would race that fetch and can get stuck rendering as a free-text field. See
  // the effect below, which defaults to 'Laptop' only once the list has actually loaded.
  const [type, setType] = useState('')
  // Every category-specific SKU field (brand, model/item_name, and every spec field the
  // resolved category's sku_category_templates.field_schema defines) -- schema-driven,
  // same mechanism and same field set as SkuFormModal's "New SKU" form, so the two entry
  // points can't drift apart on which fields a category captures. Per-unit fields
  // (serial, condition, etc.) stay as their own state below, separate from this
  // SKU-level object.
  const [specs, setSpecs] = useState<Record<string, any>>({})
  const [serialNumber, setSerialNumber] = useState('')
  const [purchasedByType, setPurchasedByType] = useState('Digitalbluez')
  const [conditionNotes, setConditionNotes] = useState('')
  const [receivedDate, setReceivedDate] = useState(today())
  const [bundled, setBundled] = useState<BundledAccessory[]>([])
  const [bundleMonitor, setBundleMonitor] = useState(false)
  const [bundledMonitor, setBundledMonitor] = useState<BundledMonitor>(EMPTY_BUNDLED_MONITOR)

  const { values: typeOptions, addOption: addTypeOption } = useCustomOptions('stock_intake_type')

  const category = TYPE_TO_CATEGORY[type] || 'OTHER'
  const selectedTemplate = templates.find(t => t.category === category)
  const fieldSchema = parseFieldSchema(selectedTemplate?.field_schema)
  // Model Year is the one field kept conditionally hidden rather than always rendered --
  // irrelevant for non-Apple brands, same UX carve-out this page had before going
  // schema-driven.
  const fields = (fieldSchema?.fields || []).filter((f: any) => f.name !== 'model_year' || specs.brand === 'Apple')
  const identityField = findIdentityField(fields)

  useEffect(() => {
    apiFetch('/api/sku-category-templates').then(res => res.json()).then((data) => {
      setTemplates(Array.isArray(data) ? data : [])
    })
  }, [])

  useEffect(() => {
    if (!type && typeOptions.includes('Laptop')) setType('Laptop')
  }, [type, typeOptions])

  // Prefill specs from whatever was last recorded for this exact identity value (model/
  // item name) -- a repeatedly purchased model shouldn't need every spec field re-picked
  // by hand each time. Only fills fields that are still empty, so it never overwrites
  // something the user already chose, and it's fully editable afterward either way.
  const identityValue = identityField ? specs[identityField] : undefined
  useEffect(() => {
    if (!identityValue || !String(identityValue).trim()) return
    let cancelled = false
    apiFetch(`/api/sku-master?latest_for_model=${encodeURIComponent(identityValue)}&category=${encodeURIComponent(category)}`)
      .then(res => res.json())
      .then((fetched) => {
        if (cancelled || !fetched) return
        setSpecs(prev => {
          const next = { ...prev }
          for (const [key, value] of Object.entries(fetched)) {
            if ((next[key] === undefined || next[key] === '') && value) next[key] = value
          }
          return next
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityValue, category])

  const resetForm = () => {
    setType('Laptop'); setSpecs({})
    setBundled([]); setBundleMonitor(false); setBundledMonitor(EMPTY_BUNDLED_MONITOR)
    setSerialNumber(''); setPurchasedByType('Digitalbluez'); setConditionNotes('')
    setReceivedDate(today())
  }

  // Generic required-field check, driven by the resolved category's own field_schema --
  // whatever that category marks required (brand, model, size, ...) must be filled, no
  // hardcoded "Model" special case.
  const missingRequiredLabel = () => {
    const missing = fields.filter((f: any) => f.required && !specs[f.name])
    return missing.length > 0 ? missing.map((f: any) => f.label).join(', ') : null
  }

  const openReview = () => {
    setError('')
    const missing = missingRequiredLabel()
    if (missing) { setError(`${missing} required.`); return }
    setShowReview(true)
  }

  const { run: handleSubmit, pending: submitting } = useAsyncAction(async () => {
    setError('')
    const missing = missingRequiredLabel()
    if (missing) { setError(`${missing} required.`); return }

    const payload = {
      type,
      model: identityField ? specs[identityField] : undefined,
      brand: specs.brand,
      specifications: specs,
      serial_number: serialNumber,
      purchased_by_type: purchasedByType,
      condition_notes: conditionNotes,
      received_date: receivedDate,
      bundled_accessories: bundled.length > 0 ? bundled.map(b => ({ accessory_id: b.accessory_id, quantity: b.quantity })) : undefined,
      bundled_monitor: category === 'DES' && bundleMonitor && bundledMonitor.brand && bundledMonitor.size ? bundledMonitor : undefined,
    }

    // Informational only -- never blocks this submission. Employees can't reach
    // the owner-only merge tool, so this is just a heads-up that the model they
    // typed looks similar to something already in the catalog.
    const notifyPossibleDuplicates = (data: any) => {
      const match = data?.possible_duplicates?.[0]
      if (match) {
        toast(`Heads up: this looks similar to an existing SKU (${match.full_sku_code}, ${match.quantity_in_stock ?? 0} in stock). The owner may merge these later.`)
      }
      if (data?.bundled_monitor_warning) {
        toast.error(data.bundled_monitor_warning)
      }
    }

    try {
      const res = await apiFetch('/api/stock-intake', { method: 'POST', body: JSON.stringify(payload) })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        // Serial number already exists elsewhere in the system -- this door hard-blocks
        // re-entry of the same serial (no confirm-and-proceed override), since that's
        // exactly how this class of duplicate got created before.
        throw new Error(err.error || 'Failed to save entry.')
      }
      notifyPossibleDuplicates(await res.json().catch(() => ({})))
      setDone(true)
      resetForm()
    } catch (err: any) {
      setError(err.message)
    }
  })

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <button onClick={() => router.push(backHref)} className="text-sm text-muted-foreground hover:text-foreground mb-2">
        ← Back
      </button>
      <h1 className="text-2xl font-bold mb-1">Stock Intake</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Register a unit you just received. No price or vendor info needed here — the owner will fill that in.
      </p>

      {done && (
        <div className="bg-success/15 border border-success/20 text-success rounded p-3 mb-4 flex justify-between items-center">
          <span>Added to stock — pending QC before it can be sold.</span>
          <button onClick={() => setDone(false)} className="text-sm underline">Add another</button>
        </div>
      )}
      {error && <div className="text-destructive mb-4">{error}</div>}

      <div className="space-y-4 bg-card p-4 rounded shadow">
        <div>
          <label className="block font-medium text-sm mb-1">Date Received</label>
          <input
            type="date"
            value={receivedDate}
            max={today()}
            onChange={(e) => setReceivedDate(e.target.value)}
            className="border p-2 w-full rounded"
          />
          <p className="text-xs text-muted-foreground mt-1">Backdate this if the unit was actually received earlier.</p>
        </div>

        <div>
          <label className="block font-medium text-sm mb-1">Type *</label>
          <SearchableSelect
            options={typeOptions}
            value={type}
            onChange={(v) => { setType(v); setSpecs({}) }}
            placeholder="Select type..."
            onOtherCommit={(v) => { if (!typeOptions.includes(v)) addTypeOption(v) }}
          />
        </div>

        <CategorySpecFields
          fields={fields}
          specs={specs}
          category={category}
          onChange={(name, value) => setSpecs(prev => ({ ...prev, [name]: value }))}
        />

        <AccessoryBundlePicker bundled={bundled} onChange={setBundled} />

        {category === 'DES' && (
          <div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={bundleMonitor} onChange={(e) => setBundleMonitor(e.target.checked)} />
              This came with a monitor (complete set)
            </label>
            {bundleMonitor && (
              <div className="mt-2">
                <BundleMonitorFields value={bundledMonitor} onChange={setBundledMonitor} />
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block font-medium text-sm mb-1">Serial Number</label>
            <input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} className="border p-2 w-full rounded" />
          </div>
          <div>
            <label className="block font-medium text-sm mb-1">Purchased By</label>
            <select value={purchasedByType} onChange={(e) => setPurchasedByType(e.target.value)} className="border p-2 w-full rounded">
              {BUYER_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block font-medium text-sm mb-1">Condition Notes</label>
          <textarea
            value={conditionNotes}
            onChange={(e) => setConditionNotes(e.target.value)}
            placeholder="e.g. Battery issue, keyboard pullout for spare parts, screen scratch..."
            className="border p-2 w-full rounded"
            rows={3}
          />
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => openReview()}
            disabled={submitting}
            className="bg-primary text-primary-foreground px-6 py-2 rounded disabled:opacity-50"
          >
            {submitting && <Loader2 className="inline size-4 animate-spin mr-1" />}
            {submitting ? 'Saving...' : 'Review & Save Entry'}
          </button>
        </div>
      </div>

      {showReview && (
        <ReviewSummaryDialog
          title="Review Stock Entry"
          confirming={submitting}
          onBack={() => setShowReview(false)}
          onConfirm={async () => { await handleSubmit(); setShowReview(false) }}
          rows={[
            { label: 'Type', value: type },
            ...fields.map((f: any) => ({
              label: f.label,
              value: typeof specs[f.name] === 'boolean' ? (specs[f.name] ? 'Yes' : 'No') : (specs[f.name] ?? ''),
            })),
            { label: 'Serial Number', value: serialNumber },
            { label: 'Purchased By', value: purchasedByType },
            ...(bundled.length > 0 ? [{ label: 'Bundled Accessories', value: bundled.map(b => `${b.accessory_name} ×${b.quantity}`).join(', ') }] : []),
            ...(category === 'DES' && bundleMonitor && bundledMonitor.brand ? [{ label: 'Bundled Monitor', value: `${bundledMonitor.brand} ${bundledMonitor.size}"` }] : []),
            { label: 'Condition Notes', value: conditionNotes },
            { label: 'Date Received', value: receivedDate },
          ]}
        />
      )}
    </div>
  )
}

export default function StockIntakePageGuarded() {
  return (
    <RequirePageAccess pageKey="new_entry">
      <StockIntakePage />
    </RequirePageAccess>
  )
}

'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, X } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { SearchableCustomerSelect } from '@/components/SearchableCustomerSelect'
import AddCustomerDialog from '@/components/AddCustomerDialog'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ResizableDialogContent } from '@/components/ResizableDialogContent'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type SalesDocType = 'quotation' | 'proforma'

export interface SalesDocLineItem {
  item_type: 'sku' | 'accessory' | 'custom'
  sku_id?: string
  accessory_id?: string
  description: string
  hsn_code?: string
  quantity: number
  rate: number
  gst_rate: number
}

// 'exclusive' = rates are typed before GST (what the server stores);
// 'inclusive' = rates are typed GST-included and reduced to their pre-GST base
// on save -- same Before GST / After GST choice as the Sell page.
export type PriceMode = 'exclusive' | 'inclusive'

interface SalesDocumentDefaults {
  next_number: string | null
  is_gst_registered: boolean
  default_notes: string | null
  default_terms: string | null
}

export const ENTITY_LABELS: Record<string, string> = { digitalbluez: 'Digitalbluez', techtenth: 'Techtenth', cash: 'Cash' }

export const DOC_LABELS: Record<SalesDocType, string> = { quotation: 'Quotation', proforma: 'Proforma Invoice' }

const GST_RATE_OPTIONS = [0, 5, 18, 40]

const round2 = (n: number) => Math.round(n * 100) / 100
const toExclusive = (rate: number, gstRate: number) => round2(rate / (1 + gstRate / 100))
const toInclusive = (rate: number, gstRate: number) => round2(rate * (1 + gstRate / 100))

// Grid templates for the Zoho-style item table (Item Details / Qty / Rate / Tax /
// Amount / remove). Only applied once the dialog itself is wide enough
// (@2xl container query, not the viewport) -- narrower, each line stacks so the
// table never scrolls sideways.
const GRID_WITH_TAX = '@2xl:grid-cols-[minmax(0,1fr)_5rem_7.5rem_6.5rem_7rem_2rem]'
const GRID_NO_TAX = '@2xl:grid-cols-[minmax(0,1fr)_5rem_7.5rem_7rem_2rem]'

// ---------- Shared entry-form fields ----------
// Used by every way a quotation/proforma is entered (New, Edit, Clone) via
// SalesDocumentEditorDialog below, so all three look and behave identically.
export function DocumentFormFields({
  docType, documentNumber, numberIsPreview, isGstRegistered, entityKey, setEntityKey, customerId, setCustomerId,
  validUntil, setValidUntil, notes, setNotes, terms, setTerms, items, setItems, shippingAddress, setShippingAddress,
  priceMode, setPriceMode, showErrors,
}: {
  docType: SalesDocType
  documentNumber: string | null
  numberIsPreview: boolean
  isGstRegistered: boolean
  entityKey: string; setEntityKey: (v: string) => void
  customerId: string | null; setCustomerId: (v: string | null) => void
  validUntil: string; setValidUntil: (v: string) => void
  notes: string; setNotes: (v: string) => void
  terms: string; setTerms: (v: string) => void
  items: SalesDocLineItem[]; setItems: React.Dispatch<React.SetStateAction<SalesDocLineItem[]>>
  shippingAddress: string; setShippingAddress: (v: string) => void
  priceMode: PriceMode; setPriceMode: (v: PriceMode) => void
  showErrors: boolean
}) {
  // Billing is shown read-only (it's the customer record's address, snapshotted
  // server-side); Ship To defaults to the customer's saved shipping address and
  // stays editable per document. Only set on an actual pick, so editing an
  // existing document keeps its own saved Ship To until the customer changes.
  const [billingAddress, setBillingAddress] = useState<string | null>(null)
  const pickCustomer = (c: any) => {
    setBillingAddress(c?.address || null)
    setShippingAddress(c?.shipping_address || '')
  }
  const [skuSearch, setSkuSearch] = useState('')
  const [skuResults, setSkuResults] = useState<any[]>([])

  useEffect(() => {
    if (!skuSearch.trim()) { setSkuResults([]); return }
    const timer = setTimeout(async () => {
      const res = await apiFetch(`/api/sku-master?search=${encodeURIComponent(skuSearch)}`)
      const data = await res.json()
      setSkuResults(Array.isArray(data) ? data.slice(0, 15) : [])
    }, 300)
    return () => clearTimeout(timer)
  }, [skuSearch])

  // GST is only ever charged by a GST-registered entity, so the inclusive mode
  // means nothing for Techtenth/Cash -- their rate is simply what the customer pays.
  const inclusive = isGstRegistered && priceMode === 'inclusive'

  const addSkuLine = (sku: any) => {
    const price = Number(sku.selling_price_default) || 0
    setItems((prev) => [...prev, {
      item_type: 'sku',
      sku_id: sku.id,
      description: sku.sku_description || sku.full_sku_code,
      hsn_code: sku.hsn_code || '',
      quantity: 1,
      rate: inclusive ? toInclusive(price, 18) : price,
      gst_rate: 18,
    }])
    setSkuSearch(''); setSkuResults([])
  }
  const addCustomLine = () => setItems((prev) => [...prev, { item_type: 'custom', description: '', hsn_code: '', quantity: 1, rate: 0, gst_rate: 18 }])
  const updateItem = (idx: number, field: keyof SalesDocLineItem, value: any) => setItems((prev) => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it))
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx))

  // Switching modes converts every line's rate so what the customer pays stays the
  // same -- never just relabels a stale number under the new meaning (Sell page rule).
  const changePriceMode = (mode: PriceMode) => {
    if (mode === priceMode) return
    setItems((prev) => prev.map((it) => ({
      ...it,
      rate: mode === 'inclusive' ? toInclusive(it.rate, it.gst_rate) : toExclusive(it.rate, it.gst_rate),
    })))
    setPriceMode(mode)
  }

  const baseRate = (it: SalesDocLineItem) => inclusive ? toExclusive(it.rate, it.gst_rate) : it.rate
  const subtotal = items.reduce((sum, it) => sum + it.quantity * baseRate(it), 0)
  const estGst = isGstRegistered ? items.reduce((sum, it) => sum + (it.quantity * baseRate(it) * it.gst_rate) / 100, 0) : 0
  const gridCols = isGstRegistered ? GRID_WITH_TAX : GRID_NO_TAX
  const docLabel = DOC_LABELS[docType]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Entity</label>
            <select value={entityKey} onChange={(e) => setEntityKey(e.target.value)} className="border p-2 w-full rounded">
              {Object.entries(ENTITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{docLabel} #</label>
            <input
              readOnly
              value={documentNumber ?? '…'}
              className="border p-2 w-full rounded bg-muted text-muted-foreground font-mono"
            />
            {numberIsPreview && (
              <p className="text-xs text-muted-foreground mt-1">Assigned on save — nothing is reserved until then.</p>
            )}
          </div>
        </div>
        {docType === 'quotation' && (
          <div>
            <label className="block text-sm font-medium mb-1">Valid Until</label>
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="border p-2 w-full rounded" />
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Customer</label>
        <div className="flex gap-2 items-start">
          <div className="flex-1">
            <SearchableCustomerSelect value={customerId} onChange={setCustomerId} onCustomerData={pickCustomer} />
          </div>
          <AddCustomerDialog onAdd={(created) => { if (created) { setCustomerId(created.id); pickCustomer(created) } }} />
        </div>
      </div>

      {customerId && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Bill To</label>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap border rounded p-2 min-h-[4.5rem] bg-muted/40">
              {billingAddress || 'From the customer record'}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Ship To</label>
            <textarea
              value={shippingAddress}
              onChange={(e) => setShippingAddress(e.target.value)}
              placeholder="Leave blank to ship to the billing address"
              rows={3}
              className="border p-2 w-full rounded text-sm"
            />
          </div>
        </div>
      )}

      {/* ---------- Item table (Zoho layout) ---------- */}
      <div className="@container space-y-2">
        <div className="flex flex-wrap justify-between items-center gap-2">
          <label className="text-sm font-medium">Item Table</label>
          {isGstRegistered && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Amounts are
              <select value={priceMode} onChange={(e) => changePriceMode(e.target.value as PriceMode)} className="border p-1 rounded text-xs text-foreground">
                <option value="exclusive">Tax Exclusive (before GST)</option>
                <option value="inclusive">Tax Inclusive (after GST)</option>
              </select>
            </label>
          )}
        </div>

        <div className="rounded-md border">
          <div className={cn('hidden @2xl:grid gap-2 px-3 py-2 bg-muted/50 text-xs font-medium uppercase tracking-wide text-muted-foreground border-b', gridCols)}>
            <span>Item Details</span>
            <span className="text-right">Quantity</span>
            <span className="text-right">Rate{isGstRegistered && (inclusive ? ' (incl.)' : ' (excl.)')}</span>
            {isGstRegistered && <span>Tax</span>}
            <span className="text-right">Amount</span>
            <span />
          </div>

          {items.map((it, idx) => {
            const hsnMissing = showErrors && isGstRegistered && !String(it.hsn_code || '').trim()
            const descMissing = showErrors && !it.description.trim()
            return (
              <div key={idx} className={cn('grid grid-cols-2 gap-2 px-3 py-2 border-b items-start', gridCols)}>
                <div className="col-span-2 @2xl:col-span-1 space-y-1.5">
                  <div className="flex items-start gap-2">
                    {/* rows=2 by default, auto-growing with content. */}
                    <textarea
                      value={it.description}
                      onChange={(e) => updateItem(idx, 'description', e.target.value)}
                      onInput={(e) => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }}
                      rows={2}
                      className={cn('border p-1.5 flex-1 min-w-0 rounded text-sm resize-y', descMissing && 'border-destructive')}
                      placeholder="Item name / description"
                    />
                    <button type="button" onClick={() => removeItem(idx)} className="@2xl:hidden text-destructive p-1 shrink-0" title="Remove line">
                      <X className="size-4" />
                    </button>
                  </div>
                  {isGstRegistered && (
                    <label className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">HSN/SAC<span className="text-destructive">*</span></span>
                      <input
                        value={it.hsn_code || ''}
                        onChange={(e) => updateItem(idx, 'hsn_code', e.target.value)}
                        className={cn('border px-1.5 py-1 rounded w-28 font-mono', hsnMissing && 'border-destructive')}
                        placeholder="e.g. 8471"
                      />
                    </label>
                  )}
                </div>
                <label className="flex flex-col gap-0.5 text-xs">
                  <span className="text-muted-foreground @2xl:hidden">Quantity</span>
                  <input type="number" min={1} value={it.quantity} onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))} className="border p-1.5 rounded text-sm text-right tabular-nums w-full" />
                </label>
                <label className="flex flex-col gap-0.5 text-xs">
                  <span className="text-muted-foreground @2xl:hidden">Rate{isGstRegistered && (inclusive ? ' (incl. GST)' : ' (excl. GST)')}</span>
                  <input type="number" step="0.01" value={it.rate} onChange={(e) => updateItem(idx, 'rate', Number(e.target.value))} className="border p-1.5 rounded text-sm text-right tabular-nums w-full" />
                </label>
                {isGstRegistered && (
                  <label className="flex flex-col gap-0.5 text-xs">
                    <span className="text-muted-foreground @2xl:hidden">Tax</span>
                    <select value={it.gst_rate} onChange={(e) => updateItem(idx, 'gst_rate', Number(e.target.value))} className="border p-1.5 rounded text-sm w-full">
                      {[...new Set([...GST_RATE_OPTIONS, it.gst_rate])].sort((a, b) => a - b).map((r) => (
                        <option key={r} value={r}>{r === 0 ? 'No GST' : `GST ${r}%`}</option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="flex flex-col gap-0.5 text-xs text-right">
                  <span className="text-muted-foreground @2xl:hidden">Amount</span>
                  <span className="text-sm font-medium tabular-nums py-1.5">₹{(it.quantity * it.rate).toFixed(2)}</span>
                </div>
                <button type="button" onClick={() => removeItem(idx)} className="hidden @2xl:block text-destructive py-1.5" title="Remove line">
                  <X className="size-4" />
                </button>
              </div>
            )
          })}

          <div className="flex flex-wrap items-start gap-2 p-2">
            <div className="relative flex-1 min-w-[14rem]">
              <input
                value={skuSearch}
                onChange={(e) => setSkuSearch(e.target.value)}
                placeholder="Type to add an item from SKU master…"
                className="border p-1.5 w-full rounded text-sm"
              />
              {skuResults.length > 0 && (
                <ul className="border rounded mt-1 max-h-40 overflow-y-auto absolute bg-card w-full z-10 shadow">
                  {skuResults.map((sku) => (
                    <li key={sku.id} onClick={() => addSkuLine(sku)} className="p-2 hover:bg-muted cursor-pointer border-b last:border-b-0 text-sm">
                      <div className="font-medium">{sku.full_sku_code}</div>
                      <div className="text-xs text-muted-foreground">{sku.sku_description} — {sku.quantity_in_stock} in stock</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addCustomLine}>
              <Plus className="size-3.5 mr-1" /> Add New Row
            </Button>
          </div>
        </div>

        <div className="flex justify-end">
          <div className="w-full max-w-xs space-y-1 text-sm rounded-md bg-muted/40 p-3">
            <div className="flex justify-between"><span className="text-muted-foreground">Sub Total{isGstRegistered && ' (before GST)'}</span><span className="tabular-nums">₹{subtotal.toFixed(2)}</span></div>
            {isGstRegistered && (
              <div className="flex justify-between"><span className="text-muted-foreground">Est. GST</span><span className="tabular-nums">₹{estGst.toFixed(2)}</span></div>
            )}
            <div className="flex justify-between font-bold border-t pt-1"><span>Total (₹)</span><span className="tabular-nums">₹{(subtotal + estGst).toFixed(2)}</span></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="border p-2 w-full rounded text-sm" rows={3} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Terms & Conditions</label>
          <textarea value={terms} onChange={(e) => setTerms(e.target.value)} className="border p-2 w-full rounded text-sm" rows={3} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">New documents start with the entity&apos;s default Notes and T&amp;C, set by the owner in Settings → Business Profiles.</p>
    </div>
  )
}

// ---------- Editor dialog: New / Edit / Clone ----------
// One dialog for all three, so Clone is just "New, prefilled from another
// document" -- the user can change anything, cancel (nothing is written, no
// number consumed), or save (mints a fresh number via POST). Edit saves via
// PATCH and is only offered while the document is still draft/sent with nothing
// converted -- the PATCH route enforces this itself.
// Mount it only while open: every open starts from fresh state.
export function SalesDocumentEditorDialog({ mode, docType, source, onClose, onSaved }: {
  mode: 'create' | 'edit' | 'clone'
  docType: SalesDocType
  source?: any
  onClose: () => void
  onSaved: (savedId: string) => void
}) {
  const [entityKey, setEntityKey] = useState<string>(source?.entity_key || 'digitalbluez')
  const [customerId, setCustomerId] = useState<string | null>(source?.customer_id ?? null)
  // A clone's old validity date is almost always already past -- start it blank.
  const [validUntil, setValidUntil] = useState(mode === 'edit' ? (source?.valid_until || '') : '')
  const [notes, setNotes] = useState<string>(source?.notes || '')
  const [terms, setTerms] = useState<string>(source?.terms_conditions || '')
  const [shippingAddress, setShippingAddress] = useState<string>(source?.shipping_address || '')
  const [priceMode, setPriceMode] = useState<PriceMode>('exclusive')
  const [items, setItems] = useState<SalesDocLineItem[]>(() => (source?.items || []).map((i: any) => ({
    item_type: i.item_type,
    sku_id: i.sku_id || undefined,
    accessory_id: i.accessory_id || undefined,
    description: i.description,
    hsn_code: i.hsn_code || '',
    quantity: Number(i.quantity),
    rate: Number(i.rate),
    gst_rate: Number(i.gst_rate) || 0,
  })))
  const [defaults, setDefaults] = useState<SalesDocumentDefaults | null>(null)
  const [error, setError] = useState('')
  const [showErrors, setShowErrors] = useState(false)

  // Entity defaults (GST status, number preview, Notes/T&C). Notes/T&C are only
  // swapped in while the field is empty or still holds the previous entity's
  // default, so switching Entity never clobbers text the user actually typed --
  // and a clone's own copied notes are kept. Edit never touches them.
  const prevDefaultsRef = useRef<SalesDocumentDefaults | null>(null)
  useEffect(() => {
    let cancelled = false
    apiFetch(`/api/sales-documents/defaults?doc_type=${docType}&entity_key=${encodeURIComponent(entityKey)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d: SalesDocumentDefaults | null) => {
        if (cancelled || !d) return
        if (mode !== 'edit') {
          const prev = prevDefaultsRef.current
          setNotes((cur) => (cur === '' || (prev && cur === (prev.default_notes || ''))) ? (d.default_notes || '') : cur)
          setTerms((cur) => (cur === '' || (prev && cur === (prev.default_terms || ''))) ? (d.default_terms || '') : cur)
        }
        prevDefaultsRef.current = d
        setDefaults(d)
      })
    return () => { cancelled = true }
  }, [docType, entityKey, mode])

  const isGstRegistered = defaults?.is_gst_registered ?? false
  const docLabel = DOC_LABELS[docType]

  const { run: handleSave, pending: saving } = useAsyncAction(async () => {
    setError('')
    setShowErrors(true)
    if (!customerId) { setError('Select a customer.'); return }
    if (items.length === 0) { setError('Add at least one line item.'); return }
    if (items.some((it) => !it.description.trim())) { setError('Every line needs a description.'); return }
    if (isGstRegistered && items.some((it) => !String(it.hsn_code || '').trim())) {
      setError(`HSN code is required on every line for ${ENTITY_LABELS[entityKey] || entityKey}.`); return
    }

    const inclusive = isGstRegistered && priceMode === 'inclusive'
    const payloadItems = items.map((it) => ({
      ...it,
      hsn_code: String(it.hsn_code || '').trim() || undefined,
      rate: inclusive ? toExclusive(it.rate, it.gst_rate) : it.rate,
    }))
    const body = {
      entity_key: entityKey,
      customer_id: customerId,
      notes: notes || null,
      terms_conditions: terms || null,
      items: payloadItems,
      shipping_address: shippingAddress,
    }

    const res = mode === 'edit'
      ? await apiFetch(`/api/sales-documents/${source.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...body, valid_until: docType === 'quotation' ? (validUntil || null) : undefined }),
        })
      : await apiFetch('/api/sales-documents', {
          method: 'POST',
          body: JSON.stringify({ ...body, doc_type: docType, valid_until: docType === 'quotation' && validUntil ? validUntil : undefined }),
        })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(data.error || 'Failed to save.'); return }
    // The previewed number is a peek, not a reservation -- say so if someone else's
    // save took it first, rather than leaving the user to notice a different number.
    if (mode !== 'edit' && defaults?.next_number && data.document_number && data.document_number !== defaults.next_number) {
      alert(`Saved as ${data.document_number} (${defaults.next_number} was taken by another document in the meantime).`)
    }
    onSaved(data.id ?? source?.id)
  })

  const title = mode === 'edit' ? `Edit ${source.document_number}` : mode === 'clone' ? `New ${docLabel} (cloned from ${source.document_number})` : `New ${docLabel}`

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <ResizableDialogContent storageKey="new-sales-document-dialog-size" defaultWidth={900} defaultHeight={720}>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>

        <DocumentFormFields
          docType={docType}
          documentNumber={mode === 'edit' ? source.document_number : (defaults?.next_number ?? null)}
          numberIsPreview={mode !== 'edit'}
          isGstRegistered={isGstRegistered}
          entityKey={entityKey} setEntityKey={setEntityKey}
          customerId={customerId} setCustomerId={setCustomerId}
          validUntil={validUntil} setValidUntil={setValidUntil}
          notes={notes} setNotes={setNotes}
          terms={terms} setTerms={setTerms}
          items={items} setItems={setItems}
          shippingAddress={shippingAddress} setShippingAddress={setShippingAddress}
          priceMode={priceMode} setPriceMode={setPriceMode}
          showErrors={showErrors}
        />

        {error && <p className="text-destructive text-sm mt-2">{error}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => handleSave()} loading={saving} disabled={!defaults}>
            {mode === 'edit' ? 'Save Changes' : 'Save'}
          </Button>
        </div>
      </ResizableDialogContent>
    </Dialog>
  )
}

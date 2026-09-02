'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { SearchableCustomerSelect } from '@/components/SearchableCustomerSelect'
import AddCustomerDialog from '@/components/AddCustomerDialog'
import { SearchableSelect } from '@/components/SearchableSelect'
import { useCustomOptions } from '@/lib/useCustomOptions'
import { FixSkuDialog } from '@/components/FixSkuDialog'
import RequirePageAccess from '@/components/RequirePageAccess'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { ReviewSummaryDialog } from '@/components/ReviewSummaryDialog'
import { buildConfigSummary, ConfigSummaryTemplate } from '@/lib/sku-config-summary'

interface StockUnit {
  id: string
  asset_number: string | null
  serial_number: string | null
  sku_code: string
  description: string
  category?: string | null
  specifications?: Record<string, any> | null
  status: string
}

interface Accessory {
  id: string
  accessory_name: string
  quantity: number
  selling_price: number | null
}

interface BundledAccessory {
  accessory_id: string
  accessory_name: string
  quantity: number
  price: number
}

// A cart line is either a unit (laptop/desktop/monitor), which can carry free/priced
// bundled accessories folded into its own row, or a standalone accessory. Each line has
// its own price -- the customer, GST%, sale type, sale date, and payment are entered
// once for the whole cart (see the shared section below the cart list).
type CartLine =
  | { id: string; kind: 'unit'; unit: StockUnit; salePrice: number; bundled: BundledAccessory[] }
  | { id: string; kind: 'accessory'; accessory: Accessory; quantity: number; salePrice: number }

const PAYMENT_ACCOUNTS = ['Digitalbluez', 'Techtenth', 'Cash']

// Accessories are sku_master rows filtered to the non-serialized categories (see
// docs/decisions.md, 2026-07-23) -- map the raw SKU shape into this page's existing
// Accessory shape so the rest of the component doesn't need to change.
const ACCESSORY_CATEGORIES = 'RAM,SSD,CPU,GPU,KBD,MOUSE,ACC,ADP'
function mapSkuToAccessory(s: any): Accessory {
  return {
    id: s.id,
    accessory_name: s.sku_description || s.model_name || s.full_sku_code,
    quantity: s.quantity_in_stock,
    selling_price: s.selling_price_default,
  }
}

function unitLabel(u: StockUnit) {
  return u.asset_number || (u.serial_number ? `SN: ${u.serial_number}` : 'no tag yet')
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function bundledAddOnsTotal(bundled: BundledAccessory[]) {
  return bundled.reduce((sum, b) => sum + (b.price || 0) * b.quantity, 0)
}

function SellPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const prefillAssetId = searchParams.get('asset_id')
  const prefillAccessoryId = searchParams.get('accessory_id')
  // Prefill from converting one line of a quotation/proforma (see
  // /dashboard/quotations) -- customer + price carried over, owner still
  // picks the specific physical unit (refurb units are qty-1/unique, so a
  // quote can never lock a specific serial number ahead of time). The price
  // applies to whichever unit line the employee adds first.
  const prefillCustomerId = searchParams.get('customer_id')
  const sourceDocumentItemId = searchParams.get('source_document_item_id')
  const prefillRate = searchParams.get('prefill_rate')
  const prefillGstRate = searchParams.get('prefill_gst_rate')
  const skuSearch = searchParams.get('sku_search')
  // Where to return after Back/Done -- the page this form was opened from (Live
  // Stock, Stock, etc.), falling back to the New Entry hub when opened from there.
  const returnTo = searchParams.get('return_to')
  const backHref = returnTo && returnTo.startsWith('/dashboard') ? returnTo : '/dashboard/entry'

  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [showReview, setShowReview] = useState(false)

  const [mode, setMode] = useState<'unit' | 'accessory'>(prefillAccessoryId ? 'accessory' : 'unit')

  const [cartItems, setCartItems] = useState<CartLine[]>([])
  // Consumed once, by whichever unit line gets added first (quotation-line conversion).
  const pendingPrefillRateRef = useRef<number | undefined>(prefillRate ? Number(prefillRate) : undefined)

  // "Add a unit" search
  const [unitSearch, setUnitSearch] = useState('')
  const [units, setUnits] = useState<StockUnit[]>([])
  const [loadingUnits, setLoadingUnits] = useState(false)
  const [templates, setTemplates] = useState<ConfigSummaryTemplate[]>([])

  useEffect(() => {
    apiFetch('/api/sku-category-templates').then(res => res.json()).then((data) => {
      setTemplates(Array.isArray(data) ? data : [])
    })
  }, [])

  const unitConfigSummary = (u: StockUnit) => buildConfigSummary(u.category, u.specifications, templates) || u.description

  // "Add an accessory" search (accessory-only mode)
  const [accessorySearch, setAccessorySearch] = useState('')
  const [accessoryOptions, setAccessoryOptions] = useState<Accessory[]>([])
  const [browsableAccessories, setBrowsableAccessories] = useState<Accessory[]>([])

  // Bundled-accessory search, scoped to one unit line at a time (kept separate from the
  // "add an accessory" search above so the two can't collide when a cart already has
  // both kinds of lines).
  const [bundlingForLineId, setBundlingForLineId] = useState<string | null>(null)
  const [bundleSearch, setBundleSearch] = useState('')
  const [bundleOptions, setBundleOptions] = useState<Accessory[]>([])

  const [showChangeSkuForLineId, setShowChangeSkuForLineId] = useState<string | null>(null)

  const [customerId, setCustomerId] = useState<string | null>(null)
  const [customerData, setCustomerData] = useState<any>(null)
  const [customerRefreshKey, setCustomerRefreshKey] = useState(0)

  const [gstPercent, setGstPercent] = useState<number>(18)
  const [saleType, setSaleType] = useState<'GST' | 'Cash'>('GST')
  const [priceMode, setPriceMode] = useState<'pre_gst' | 'post_gst'>('pre_gst')

  // Sale Type must always match whether the selected entity is actually GST-registered
  // (Digitalbluez is; Techtenth/Cash aren't -- confirmed in business_profiles) rather
  // than being a separately-set field that can silently drift out of sync with
  // paymentAccount. It used to be an independent dropdown whose two options happened to
  // be "GST"/"Cash" -- easily confused with the unrelated Payment Account "Cash" option
  // -- which let a Digitalbluez sale get entered with GST switched off (and the Pre/
  // Post-GST toggle below disappearing along with it). Derived automatically instead;
  // see gstRegisteredByKey below.
  const [gstRegisteredByKey, setGstRegisteredByKey] = useState<Record<string, boolean>>({})
  useEffect(() => {
    apiFetch('/api/business-profiles/gst-status').then(res => res.json()).then((data) => {
      if (!Array.isArray(data)) return
      setGstRegisteredByKey(Object.fromEntries(data.map((p: any) => [p.key, !!p.is_gst_registered])))
    })
  }, [])

  // Payment is a list of legs -- amount + which account it was actually received into
  // (independent of paymentAccount below, the single "invoice under" entity). The first
  // leg defaults to the full cart total (so a simple one-method full payment stays
  // zero-click, matching the old single-field behavior) until the employee edits it.
  const [paymentLegs, setPaymentLegs] = useState<{ id: string; amount: number; account: string; note: string }[]>([
    { id: crypto.randomUUID(), amount: 0, account: 'Digitalbluez', note: '' },
  ])
  const [firstLegAmountTouched, setFirstLegAmountTouched] = useState(false)
  const [invoicingEntityTouched, setInvoicingEntityTouched] = useState(false)
  const [paymentAccount, setPaymentAccount] = useState('Digitalbluez')
  const [notes, setNotes] = useState('')
  const [saleDate, setSaleDate] = useState(today())

  // Keep Sale Type locked to whatever the invoicing entity actually is -- see the
  // gstRegisteredByKey comment above. Re-derives every time paymentAccount changes
  // (including via the "Invoice under" auto-sync from a single payment leg's account).
  useEffect(() => {
    const entityKey = paymentAccount.toLowerCase()
    if (!(entityKey in gstRegisteredByKey)) return
    setSaleType(gstRegisteredByKey[entityKey] ? 'GST' : 'Cash')
  }, [paymentAccount, gstRegisteredByKey])

  const { values: staffNames } = useCustomOptions('staff_names')
  const [soldBy, setSoldBy] = useState('')

  // Browsable list of all sellable accessories, shown up-front in accessory mode
  // instead of requiring the employee to type before seeing anything.
  useEffect(() => {
    if (mode !== 'accessory') return
    apiFetch(`/api/sku-master?category=${ACCESSORY_CATEGORIES}`).then(res => res.json()).then((data) => {
      setBrowsableAccessories(Array.isArray(data) ? data.map(mapSkuToAccessory) : [])
    })
  }, [mode])

  const fetchUnit = async (id: string): Promise<StockUnit | null> => {
    const res = await apiFetch(`/api/stock?id=${id}`)
    const data = await res.json()
    return Array.isArray(data) && data[0] ? data[0] : null
  }

  const addUnitLine = (u: StockUnit) => {
    const salePrice = pendingPrefillRateRef.current ?? 0
    pendingPrefillRateRef.current = undefined
    setCartItems(prev => [...prev, { id: crypto.randomUUID(), kind: 'unit', unit: u, salePrice, bundled: [] }])
    setUnitSearch(''); setUnits([])
  }

  const addAccessoryLine = (a: Accessory) => {
    setCartItems(prev => [...prev, { id: crypto.randomUUID(), kind: 'accessory', accessory: a, quantity: 1, salePrice: 0 }])
    setAccessorySearch(''); setAccessoryOptions([])
  }

  const removeLine = (id: string) => setCartItems(prev => prev.filter(l => l.id !== id))

  const updateLinePrice = (id: string, salePrice: number) =>
    setCartItems(prev => prev.map(l => l.id === id ? { ...l, salePrice } : l))

  const updateAccessoryQty = (id: string, quantity: number) =>
    setCartItems(prev => prev.map(l => l.id === id && l.kind === 'accessory' ? { ...l, quantity } : l))

  const addBundledAccessory = (lineId: string, a: Accessory) => {
    setCartItems(prev => prev.map(l => {
      if (l.id !== lineId || l.kind !== 'unit') return l
      if (l.bundled.some(b => b.accessory_id === a.id)) return l
      return { ...l, bundled: [...l.bundled, { accessory_id: a.id, accessory_name: a.accessory_name, quantity: 1, price: 0 }] }
    }))
    setBundleSearch(''); setBundleOptions([])
  }

  const updateBundled = (lineId: string, idx: number, patch: Partial<BundledAccessory>) =>
    setCartItems(prev => prev.map(l => l.id === lineId && l.kind === 'unit'
      ? { ...l, bundled: l.bundled.map((b, i) => i === idx ? { ...b, ...patch } : b) }
      : l))

  const removeBundled = (lineId: string, idx: number) =>
    setCartItems(prev => prev.map(l => l.id === lineId && l.kind === 'unit'
      ? { ...l, bundled: l.bundled.filter((_, i) => i !== idx) }
      : l))

  // Prefill from Live Stock's "Sell" link.
  useEffect(() => {
    if (!prefillAssetId) return
    setMode('unit')
    fetchUnit(prefillAssetId).then(u => { if (u) addUnitLine(u) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillAssetId])

  // Prefill from the Accessories page's "Sell" link.
  useEffect(() => {
    if (!prefillAccessoryId) return
    apiFetch(`/api/sku-master?id=${prefillAccessoryId}`).then(res => res.json()).then((data) => {
      if (Array.isArray(data) && data[0]) {
        setMode('accessory')
        addAccessoryLine(mapSkuToAccessory(data[0]))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillAccessoryId])

  // Prefill from converting a quotation/proforma line.
  useEffect(() => {
    if (prefillCustomerId) setCustomerId(prefillCustomerId)
    if (skuSearch) { setMode('unit'); setUnitSearch(skuSearch) }
    // saleType itself is NOT set here anymore -- it's derived purely from the selected
    // entity (see the gstRegisteredByKey effect above), never from a prefilled rate.
    if (prefillGstRate) { setGstPercent(Number(prefillGstRate)) }
  }, [prefillCustomerId, skuSearch, prefillGstRate])

  useEffect(() => {
    if (mode !== 'unit') return
    if (!unitSearch.trim()) { setUnits([]); return }
    const timer = setTimeout(async () => {
      setLoadingUnits(true)
      const res = await apiFetch(`/api/stock?status=ready_for_sale,qc_passed&source=employee_intake&search=${encodeURIComponent(unitSearch)}`)
      const data = await res.json()
      setUnits(Array.isArray(data) ? data : [])
      setLoadingUnits(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [unitSearch, mode])

  useEffect(() => {
    if (!accessorySearch.trim()) { setAccessoryOptions([]); return }
    const timer = setTimeout(async () => {
      const res = await apiFetch(`/api/sku-master?category=${ACCESSORY_CATEGORIES}&search=${encodeURIComponent(accessorySearch)}`)
      const data = await res.json()
      setAccessoryOptions(Array.isArray(data) ? data.map(mapSkuToAccessory) : [])
    }, 300)
    return () => clearTimeout(timer)
  }, [accessorySearch])

  useEffect(() => {
    if (!bundleSearch.trim()) { setBundleOptions([]); return }
    const timer = setTimeout(async () => {
      const res = await apiFetch(`/api/sku-master?category=${ACCESSORY_CATEGORIES}&search=${encodeURIComponent(bundleSearch)}`)
      const data = await res.json()
      setBundleOptions(Array.isArray(data) ? data.map(mapSkuToAccessory) : [])
    }, 300)
    return () => clearTimeout(timer)
  }, [bundleSearch])

  // A line's own price, reduced to its pre-GST base (bundled add-on charges are always
  // treated as already pre-GST and added on top, same as before) -- switching priceMode
  // never relabels a stale number under a different meaning.
  const linePreGstBase = (price: number) =>
    (saleType === 'GST' && priceMode === 'post_gst' && price) ? Math.round((price / (1 + gstPercent / 100)) * 100) / 100 : price

  // An accessory line's price field is a PER-UNIT rate -- the line's actual charge
  // scales with quantity (typing 100 at qty 1, then changing qty to 3, means 300, not
  // a flat 100 regardless of quantity). A unit/laptop line has no quantity concept
  // (always exactly 1 serialized item), so it's unaffected by this multiplication.
  const lineBaseGstPrice = (line: CartLine) =>
    linePreGstBase(line.salePrice || 0) * (line.kind === 'accessory' ? line.quantity : 1)
    + (line.kind === 'unit' ? bundledAddOnsTotal(line.bundled) : 0)

  const cartSubtotal = cartItems.reduce((sum, line) => sum + lineBaseGstPrice(line), 0)
  const cartGstAmount = saleType === 'GST' ? Math.round(cartSubtotal * gstPercent * 100) / 10000 : 0
  const cartTotal = cartSubtotal + cartGstAmount

  const legsTotal = paymentLegs.reduce((sum, l) => sum + (l.amount || 0), 0)
  const balanceDue = cartTotal - legsTotal
  // Cart-level preview only -- mirrors the same threshold the DB trigger
  // (sync_sale_payment_totals) uses so this label never disagrees with what actually
  // lands. The real per-item payment_status (Sales Ledger / EditSaleDialog) is computed
  // per-row after server-side allocation, so one item can legitimately end up 'paid'
  // while another is 'partial' even under one "Paid in full"-looking cart total here --
  // that's allocatePaymentLegs doing its job correctly, not a bug.
  const derivedPaymentStatus: 'paid' | 'partial' | 'pending' =
    legsTotal <= 0 ? 'pending' : legsTotal >= cartTotal - 0.5 ? 'paid' : 'partial'

  // First leg defaults to the full cart total until manually edited -- keeps the common
  // "paid in full, one method" case a zero-typing default like the old single field was.
  useEffect(() => {
    if (paymentLegs.length === 1 && !firstLegAmountTouched && paymentLegs[0].amount !== cartTotal) {
      setPaymentLegs([{ ...paymentLegs[0], amount: cartTotal }])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartTotal, firstLegAmountTouched, paymentLegs.length])

  // "Invoice under" mirrors the sole leg's account as long as there's exactly one leg
  // and the employee hasn't manually overridden it -- stops once a 2nd leg is added or
  // the dropdown is touched directly.
  useEffect(() => {
    if (paymentLegs.length === 1 && !invoicingEntityTouched && paymentLegs[0].account !== paymentAccount) {
      setPaymentAccount(paymentLegs[0].account)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentLegs.length, paymentLegs[0]?.account, invoicingEntityTouched])

  const addPaymentLeg = () => setPaymentLegs(prev => [...prev, { id: crypto.randomUUID(), amount: 0, account: 'Digitalbluez', note: '' }])
  const removePaymentLeg = (id: string) => setPaymentLegs(prev => prev.length > 1 ? prev.filter(l => l.id !== id) : prev)
  const updatePaymentLeg = (id: string, patch: Partial<{ amount: number; account: string; note: string }>) => {
    setPaymentLegs(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l))
    if (patch.amount !== undefined) setFirstLegAmountTouched(true)
  }

  // Switching modes converts every line's price so the total the customer pays stays
  // the same -- never just relabels a stale number under the new meaning.
  const handlePriceModeChange = (newMode: 'pre_gst' | 'post_gst') => {
    if (saleType === 'GST' && newMode !== priceMode) {
      setCartItems(prev => prev.map(line => {
        if (!line.salePrice) return line
        const converted = newMode === 'post_gst'
          ? Math.round(line.salePrice * (1 + gstPercent / 100) * 100) / 100
          : Math.round((line.salePrice / (1 + gstPercent / 100)) * 100) / 100
        return { ...line, salePrice: converted }
      }))
    }
    setPriceMode(newMode)
  }

  const resetForm = () => {
    setCartItems([])
    setUnitSearch(''); setUnits([])
    setAccessorySearch(''); setAccessoryOptions([])
    setBundlingForLineId(null); setBundleSearch(''); setBundleOptions([])
    setCustomerId(null); setCustomerData(null)
    // saleType isn't reset explicitly -- it re-derives from paymentAccount below.
    setGstPercent(18); setPriceMode('pre_gst')
    setPaymentLegs([{ id: crypto.randomUUID(), amount: 0, account: 'Digitalbluez', note: '' }])
    setFirstLegAmountTouched(false); setInvoicingEntityTouched(false)
    setPaymentAccount('Digitalbluez'); setNotes(''); setSoldBy('')
    setSaleDate(today())
  }

  const validate = () => {
    if (cartItems.length === 0) { setError('Add at least one item to sell.'); return false }
    if (cartItems.some(l => !l.salePrice || l.salePrice <= 0)) { setError('Enter a valid selling price for every item.'); return false }
    if (!customerId) { setError('Select or add a customer.'); return false }
    if (legsTotal > cartTotal + 0.01) { setError('Payment total cannot exceed the cart total.'); return false }
    return true
  }

  const openReview = () => {
    setError('')
    if (!validate()) return
    setShowReview(true)
  }

  const { run: handleSubmit, pending: submitting } = useAsyncAction(async () => {
    setError('')
    if (!validate()) return

    try {
      const payload = {
        customer_id: customerId,
        sale_type: saleType,
        gst_percentage: saleType === 'GST' ? gstPercent : 0,
        sale_date: saleDate,
        payment_legs: paymentLegs
          .filter(l => l.amount > 0)
          .map(l => ({ amount: l.amount, payment_account: l.account, note: l.note || undefined })),
        payment_account: paymentAccount,
        notes: notes || undefined,
        sold_by: soldBy || undefined,
        source_document_item_id: sourceDocumentItemId || undefined,
        items: cartItems.map(line => line.kind === 'unit'
          ? {
              asset_ledger_id: line.unit.id,
              sale_base_price: lineBaseGstPrice(line),
              ...(line.bundled.length > 0 ? { bundled_accessories: line.bundled.map(b => ({ accessory_id: b.accessory_id, quantity: b.quantity, unit_price: b.price || 0 })) } : {}),
            }
          : {
              accessory_id: line.accessory.id,
              accessory_quantity: line.quantity,
              sale_base_price: lineBaseGstPrice(line),
            }),
      }

      const res = await apiFetch('/api/sales-entry', { method: 'POST', body: JSON.stringify(payload) })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to record sale.')
      }
      setDone(true)
      resetForm()
      router.replace(returnTo ? `/dashboard/entry/sell?return_to=${encodeURIComponent(returnTo)}` : '/dashboard/entry/sell')
    } catch (err: any) {
      setError(err.message)
    }
  })

  const changeSkuLine = cartItems.find(l => l.id === showChangeSkuForLineId && l.kind === 'unit') as Extract<CartLine, { kind: 'unit' }> | undefined

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <button onClick={() => router.push(backHref)} className="text-sm text-muted-foreground hover:text-foreground mb-2">
        ← Back
      </button>
      <h1 className="text-2xl font-bold mb-1">Sell</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Everything in the cart leaves stock immediately once submitted. The GST invoice is generated separately by the owner.
      </p>

      {sourceDocumentItemId && (
        <div className="bg-info/15 border border-primary/20 text-info rounded p-3 mb-4 text-sm">
          Converting one line from a quotation/proforma — customer and price carried over. Pick the specific unit to sell below.
        </div>
      )}
      {done && (
        <div className="bg-success/15 border border-success/20 text-success rounded p-3 mb-4 flex justify-between items-center">
          <span>Sale recorded — stock updated. Invoice will be generated later.</span>
          <button onClick={() => setDone(false)} className="text-sm underline">Record another</button>
        </div>
      )}
      {error && <div className="text-destructive mb-4">{error}</div>}

      <div className="flex mb-4 border rounded overflow-hidden w-fit">
        <button
          onClick={() => setMode('unit')}
          className={`px-4 py-2 text-sm font-medium ${mode === 'unit' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'}`}
        >
          Add Laptop / Desktop / Monitor
        </button>
        <button
          onClick={() => setMode('accessory')}
          className={`px-4 py-2 text-sm font-medium ${mode === 'accessory' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'}`}
        >
          Add Accessory
        </button>
      </div>

      <div className="space-y-4 bg-card p-4 rounded shadow">
        {mode === 'unit' ? (
          <div className="relative">
            <label className="block font-medium text-sm mb-1">Search for a unit to add</label>
            <p className="text-xs text-muted-foreground mb-1">
              Search here, or go to <a href="/dashboard/live-stock" className="underline">Live Stock</a> and click "Sell" on a unit.
            </p>
            <input
              value={unitSearch}
              onChange={(e) => setUnitSearch(e.target.value)}
              placeholder="Search by asset number, serial, or model..."
              className="border p-2 w-full rounded"
            />
            {loadingUnits && <div className="text-xs text-muted-foreground mt-1">Searching...</div>}
            {units.length > 0 && (
              <ul className="border rounded mt-1 max-h-48 overflow-y-auto">
                {units.map(u => (
                  <li
                    key={u.id}
                    onClick={() => addUnitLine(u)}
                    className="p-2 hover:bg-muted cursor-pointer border-b last:border-b-0"
                  >
                    <div className="font-medium">{unitLabel(u)}</div>
                    <div className="text-xs text-muted-foreground">{u.sku_code} — {unitConfigSummary(u)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="relative">
            <label className="block font-medium text-sm mb-1">Search for an accessory to add</label>
            <p className="text-xs text-muted-foreground mb-1">
              Search here, or browse the full list below (also on the <a href="/dashboard/accessories" className="underline">Accessories</a> page).
            </p>
            <input
              value={accessorySearch}
              onChange={(e) => setAccessorySearch(e.target.value)}
              placeholder="Search accessory (mouse, bag, keyboard...)"
              className="border p-2 w-full rounded"
            />
            {accessoryOptions.length > 0 && (
              <ul className="border rounded mt-1 max-h-48 overflow-y-auto">
                {accessoryOptions.map(a => (
                  <li
                    key={a.id}
                    onClick={() => addAccessoryLine(a)}
                    className="p-2 hover:bg-muted cursor-pointer border-b last:border-b-0"
                  >
                    <div className="font-medium">{a.accessory_name}</div>
                    <div className="text-xs text-muted-foreground">{a.quantity} in stock</div>
                  </li>
                ))}
              </ul>
            )}
            {!accessorySearch.trim() && browsableAccessories.length > 0 && (
              <ul className="border rounded mt-2 max-h-64 overflow-y-auto">
                {browsableAccessories.map(a => (
                  <li
                    key={a.id}
                    onClick={() => addAccessoryLine(a)}
                    className="p-2 hover:bg-muted cursor-pointer border-b last:border-b-0 flex justify-between"
                  >
                    <span className="font-medium">{a.accessory_name}</span>
                    <span className="text-xs text-muted-foreground">{a.quantity} in stock</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {cartItems.length > 0 && (
          <div>
            <label className="block font-medium text-sm mb-2">
              Cart ({cartItems.length} item{cartItems.length === 1 ? '' : 's'})
            </label>
            <div className="space-y-3">
              {cartItems.map(line => (
                <div key={line.id} className="border rounded p-3 bg-muted">
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1">
                      {line.kind === 'unit' ? (
                        <>
                          <div className="font-medium">{unitLabel(line.unit)}</div>
                          <div className="text-xs text-muted-foreground">{line.unit.sku_code} — {unitConfigSummary(line.unit)}</div>
                          <button
                            type="button"
                            onClick={() => setShowChangeSkuForLineId(line.id)}
                            className="text-primary underline text-xs mt-1"
                          >
                            Wrong, upgraded, or downgraded spec? Change SKU
                          </button>
                        </>
                      ) : (
                        <div className="font-medium">{line.accessory.accessory_name}</div>
                      )}
                    </div>
                    <button onClick={() => removeLine(line.id)} className="text-destructive text-sm">✕ Remove</button>
                  </div>

                  <div className="flex gap-3 items-end mt-2">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">
                        {line.kind === 'accessory' ? 'Unit Price' : 'Price'} {saleType === 'GST' ? (priceMode === 'pre_gst' ? '(Pre-GST)' : '(GST-Incl.)') : ''} (₹)
                      </label>
                      <input
                        type="number"
                        value={line.salePrice || ''}
                        onChange={(e) => updateLinePrice(line.id, Number(e.target.value))}
                        className="border p-2 w-32 rounded"
                      />
                    </div>
                    {line.kind === 'accessory' && (
                      <>
                        <div>
                          <label className="block text-xs text-muted-foreground mb-1">Quantity</label>
                          <input
                            type="number"
                            min={1}
                            max={line.accessory.quantity}
                            value={line.quantity}
                            onChange={(e) => updateAccessoryQty(line.id, Number(e.target.value))}
                            className="border p-2 w-24 rounded"
                          />
                        </div>
                        <div className="text-sm text-muted-foreground pb-2">
                          = ₹{((line.salePrice || 0) * line.quantity).toFixed(2)}
                        </div>
                      </>
                    )}
                  </div>

                  {line.kind === 'unit' && (
                    <div className="mt-2">
                      {bundlingForLineId === line.id ? (
                        <div className="relative">
                          <input
                            value={bundleSearch}
                            onChange={(e) => setBundleSearch(e.target.value)}
                            placeholder="Search accessory to bundle..."
                            className="border p-2 w-full rounded text-sm"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => { setBundlingForLineId(null); setBundleSearch(''); setBundleOptions([]) }}
                            className="text-xs text-muted-foreground underline mt-1"
                          >
                            Done adding accessories
                          </button>
                          {bundleOptions.length > 0 && (
                            <ul className="border rounded mt-1 max-h-40 overflow-y-auto bg-card">
                              {bundleOptions.map(a => (
                                <li key={a.id} onClick={() => addBundledAccessory(line.id, a)} className="p-2 hover:bg-muted cursor-pointer border-b last:border-b-0 text-sm">
                                  {a.accessory_name} <span className="text-xs text-muted-foreground">({a.quantity} in stock)</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setBundlingForLineId(line.id)}
                          className="text-primary underline text-xs"
                        >
                          + Add bundled accessory (free by default, or set a price if the customer pays extra)
                        </button>
                      )}
                      {line.bundled.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {line.bundled.map((b, idx) => (
                            <span key={b.accessory_id} className="bg-card border text-sm px-2 py-1 rounded flex items-center gap-1">
                              {b.accessory_name}
                              <input
                                type="number"
                                min={1}
                                value={b.quantity}
                                onChange={(e) => updateBundled(line.id, idx, { quantity: Number(e.target.value) })}
                                className="w-12 border rounded text-center"
                                title="Quantity"
                              />
                              <input
                                type="number"
                                min={0}
                                value={b.price || ''}
                                onChange={(e) => updateBundled(line.id, idx, { price: Number(e.target.value) })}
                                placeholder="₹0 (free)"
                                className="w-20 border rounded text-center"
                                title="Extra charge per unit"
                              />
                              <button onClick={() => removeBundled(line.id, idx)} className="text-destructive">✕</button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block font-medium text-sm mb-1">Customer *</label>
          <div className="flex gap-2 items-start">
            <div className="flex-1">
              <SearchableCustomerSelect
                key={customerRefreshKey}
                value={customerId}
                onChange={setCustomerId}
                onCustomerData={setCustomerData}
              />
            </div>
            <AddCustomerDialog onAdd={(created) => {
              if (created?.id) {
                setCustomerId(created.id)
                setCustomerData(created)
                setCustomerRefreshKey(k => k + 1)
              }
            }} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block font-medium text-sm mb-1">Sale Type</label>
            <div className="border p-2 w-full rounded bg-muted text-sm">
              {saleType === 'GST' ? 'GST' : 'No GST (Bill of Supply)'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Follows the invoicing entity below ({paymentAccount}) -- not separately editable.
            </p>
          </div>
          {saleType === 'GST' && (
            <div>
              <label className="block font-medium text-sm mb-1">GST %</label>
              <input type="number" value={gstPercent} onChange={(e) => setGstPercent(Number(e.target.value))} className="border p-2 w-full rounded" />
            </div>
          )}
        </div>

        {saleType === 'GST' && (
          <div>
            <label className="block font-medium text-sm mb-1">Prices entered above are</label>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1">
                <input type="radio" checked={priceMode === 'pre_gst'} onChange={() => handlePriceModeChange('pre_gst')} />
                Before GST
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={priceMode === 'post_gst'} onChange={() => handlePriceModeChange('post_gst')} />
                After GST (Inclusive)
              </label>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block font-medium text-sm mb-1">Sale Date</label>
            <input
              type="date"
              value={saleDate}
              max={today()}
              onChange={(e) => setSaleDate(e.target.value)}
              className="border p-2 w-full rounded"
            />
            <p className="text-xs text-muted-foreground mt-1">Backdate if this sale actually happened earlier.</p>
          </div>
          <div>
            <label className="block font-medium text-sm mb-1">Invoice Entity</label>
            <select
              value={paymentAccount}
              onChange={(e) => { setPaymentAccount(e.target.value); setInvoicingEntityTouched(true) }}
              className="border p-2 w-full rounded"
            >
              {PAYMENT_ACCOUNTS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <p className="text-xs text-muted-foreground mt-1">Drives the GST invoice this sale is issued under.</p>
          </div>
          <div>
            <label className="block font-medium text-sm mb-1">Sold By</label>
            <SearchableSelect options={staffNames} value={soldBy} onChange={setSoldBy} placeholder="Myself / select..." />
          </div>
        </div>

        <div>
          <label className="block font-medium text-sm mb-1">
            Payment received as{' '}
            <span className="font-normal text-muted-foreground">
              — {derivedPaymentStatus === 'paid' ? 'Paid in full' : derivedPaymentStatus === 'partial' ? `Partial — ₹${legsTotal.toFixed(2)} of ₹${cartTotal.toFixed(2)}` : 'Payment Pending'}
            </span>
          </label>
          <div className="space-y-2">
            {paymentLegs.map((leg) => (
              <div key={leg.id} className="flex gap-2 items-center">
                <input
                  type="number"
                  value={leg.amount || ''}
                  onChange={(e) => updatePaymentLeg(leg.id, { amount: Number(e.target.value) })}
                  placeholder="Amount (₹)"
                  className="border p-2 w-32 rounded"
                />
                <select
                  value={leg.account}
                  onChange={(e) => updatePaymentLeg(leg.id, { account: e.target.value })}
                  className="border p-2 rounded"
                >
                  {PAYMENT_ACCOUNTS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <input
                  value={leg.note}
                  onChange={(e) => updatePaymentLeg(leg.id, { note: e.target.value })}
                  placeholder="Note (optional)"
                  className="border p-2 flex-1 rounded"
                />
                {paymentLegs.length > 1 && (
                  <button type="button" onClick={() => removePaymentLeg(leg.id)} className="text-destructive">✕</button>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={addPaymentLeg} className="text-primary underline text-xs mt-2">
            + Add another payment method
          </button>
          {legsTotal > cartTotal + 0.01 && (
            <p className="text-destructive text-xs mt-1">
              Payment total (₹{legsTotal.toFixed(2)}) exceeds the cart total (₹{cartTotal.toFixed(2)}).
            </p>
          )}
        </div>

        <div>
          <label className="block font-medium text-sm mb-1">Notes</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="border p-2 w-full rounded"
          />
        </div>

        <div className="text-right text-sm space-y-1">
          {saleType === 'GST' && priceMode === 'post_gst' && <p>Pre-GST: ₹{cartSubtotal.toFixed(2)}</p>}
          {saleType === 'GST' && <p>GST: ₹{cartGstAmount.toFixed(2)}</p>}
          <p className="font-bold text-base">Total: ₹{cartTotal.toFixed(2)}</p>
          {derivedPaymentStatus !== 'paid' && <p className="text-warning">Balance due: ₹{balanceDue.toFixed(2)}</p>}
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => openReview()}
            disabled={submitting}
            className="bg-primary text-primary-foreground px-6 py-2 rounded disabled:opacity-50"
          >
            {submitting && <Loader2 className="inline size-4 animate-spin mr-1" />}
            {submitting ? 'Saving...' : `Review & Record Sale (${cartItems.length} item${cartItems.length === 1 ? '' : 's'})`}
          </button>
        </div>
      </div>

      {changeSkuLine && (
        <FixSkuDialog
          assetId={changeSkuLine.unit.id}
          onClose={() => setShowChangeSkuForLineId(null)}
          onReassigned={() => fetchUnit(changeSkuLine.unit.id).then(u => {
            if (u) setCartItems(prev => prev.map(l => l.id === changeSkuLine.id ? { ...l, unit: u } : l))
          })}
        />
      )}

      {showReview && (
        <ReviewSummaryDialog
          title="Review Sale"
          confirming={submitting}
          onBack={() => setShowReview(false)}
          onConfirm={async () => { await handleSubmit(); setShowReview(false) }}
          rows={[
            {
              label: 'Items',
              value: (
                <ul className="space-y-1">
                  {cartItems.map(line => (
                    <li key={line.id}>
                      {line.kind === 'unit'
                        ? `${unitLabel(line.unit)} — ${line.unit.sku_code} · ₹${line.salePrice.toFixed(2)}`
                        : `${line.accessory.accessory_name} ×${line.quantity} @ ₹${line.salePrice.toFixed(2)} = ₹${(line.salePrice * line.quantity).toFixed(2)}`}
                      {line.kind === 'unit' && line.bundled.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          + {line.bundled.map(b => `${b.accessory_name} ×${b.quantity}${b.price ? ` (+₹${b.price})` : ''}`).join(', ')}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ),
            },
            { label: 'Customer', value: customerData?.customer_name || '' },
            { label: 'Sale Type', value: saleType },
            { label: 'Total', value: `₹${cartTotal.toFixed(2)}` },
            {
              label: 'Payment',
              value: (
                <div>
                  <div>{derivedPaymentStatus === 'paid' ? 'Paid in full' : derivedPaymentStatus === 'partial' ? `Partial — ₹${legsTotal.toFixed(2)} of ₹${cartTotal.toFixed(2)}` : 'Payment Pending'}</div>
                  {paymentLegs.filter(l => l.amount > 0).map(l => (
                    <div key={l.id} className="text-xs text-muted-foreground">₹{l.amount.toFixed(2)} — {l.account}</div>
                  ))}
                </div>
              ),
            },
            { label: 'Invoice Entity', value: paymentAccount },
            { label: 'Notes', value: notes },
            { label: 'Sold By', value: soldBy },
            { label: 'Sale Date', value: saleDate },
          ]}
        />
      )}
    </div>
  )
}

export default function SellPage() {
  return (
    <RequirePageAccess pageKey="new_entry">
      <Suspense fallback={<div className="p-4">Loading...</div>}>
        <SellPageInner />
      </Suspense>
    </RequirePageAccess>
  )
}

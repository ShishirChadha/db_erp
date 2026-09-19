'use client'

import { useEffect, useState } from 'react'
import { Loader2, Trash2, Upload } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { SearchableSelect } from '@/components/SearchableSelect'
import { useCustomOptions } from '@/lib/useCustomOptions'

function publicImageUrl(storagePath: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images/${storagePath}`
}

interface UpgradeRule {
  id: string
  category: string
  field_name: 'ram' | 'ssd' | 'warranty_months'
  from_value: string
  to_value: string
  price_delta: number
  is_active: boolean
}

const CATEGORY_OPTIONS = ['LAP', 'DES']
const FIELD_OPTIONS: { value: UpgradeRule['field_name']; label: string }[] = [
  { value: 'ram', label: 'RAM' },
  { value: 'ssd', label: 'SSD' },
  { value: 'warranty_months', label: 'Warranty (months)' },
]

function UpgradePricingSection() {
  const [rules, setRules] = useState<UpgradeRule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [category, setCategory] = useState('LAP')
  const [fieldName, setFieldName] = useState<UpgradeRule['field_name']>('ram')
  const [fromValue, setFromValue] = useState('')
  const [toValue, setToValue] = useState('')
  const [priceDelta, setPriceDelta] = useState('')

  const { values: ramOptions } = useCustomOptions('ram')
  const { values: storageOptions } = useCustomOptions('storage')
  const valueOptions = fieldName === 'ram' ? ramOptions : fieldName === 'ssd' ? storageOptions : []

  const fetchRules = async () => {
    setLoading(true)
    const res = await apiFetch('/api/website-admin/upgrade-rules')
    if (res.ok) setRules(await res.json())
    setLoading(false)
  }

  useEffect(() => { fetchRules() }, [])

  const addRule = async () => {
    setError('')
    if (!fromValue.trim() || !toValue.trim() || !priceDelta.trim() || isNaN(Number(priceDelta))) {
      setError('From, To, and Price are all required.')
      return
    }
    setSaving(true)
    try {
      const res = await apiFetch('/api/website-admin/upgrade-rules', {
        method: 'POST',
        body: JSON.stringify({
          category, field_name: fieldName, from_value: fromValue.trim(), to_value: toValue.trim(),
          price_delta: Number(priceDelta),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error || 'Failed to add rule')
        return
      }
      setFromValue('')
      setToValue('')
      setPriceDelta('')
      await fetchRules()
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (rule: UpgradeRule) => {
    await apiFetch(`/api/website-admin/upgrade-rules/${rule.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: !rule.is_active }),
    })
    await fetchRules()
  }

  const removeRule = async (id: string) => {
    if (!confirm('Delete this upgrade rule?')) return
    await apiFetch(`/api/website-admin/upgrade-rules/${id}`, { method: 'DELETE' })
    await fetchRules()
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        Configure what upgrades customers can buy on the website (e.g. 8GB RAM → 16GB RAM = +₹3,500), and their price.
        RAM/SSD upgrades are a real physical service performed by staff before shipping; a Warranty upgrade just
        extends the unit&apos;s warranty. Only rules matching a unit&apos;s <em>current</em> spec will show on the
        product page — there is no automatic chaining across tiers.
      </p>

      <div className="border rounded-lg p-4 mb-4">
        <h3 className="text-sm font-semibold mb-3">Add Upgrade Rule</h3>
        {error && <div className="text-destructive text-sm mb-2">{error}</div>}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium mb-1">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="border p-2 w-full rounded">
              {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Field</label>
            <select
              value={fieldName}
              onChange={(e) => { setFieldName(e.target.value as UpgradeRule['field_name']); setFromValue(''); setToValue('') }}
              className="border p-2 w-full rounded"
            >
              {FIELD_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">From</label>
            {fieldName === 'warranty_months' ? (
              <input type="number" min={0} value={fromValue} onChange={(e) => setFromValue(e.target.value)} placeholder="e.g. 6" className="border p-2 w-full rounded" />
            ) : (
              <SearchableSelect options={valueOptions} value={fromValue} onChange={setFromValue} placeholder="e.g. 8GB" />
            )}
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">To</label>
            {fieldName === 'warranty_months' ? (
              <input type="number" min={0} value={toValue} onChange={(e) => setToValue(e.target.value)} placeholder="e.g. 12" className="border p-2 w-full rounded" />
            ) : (
              <SearchableSelect options={valueOptions} value={toValue} onChange={setToValue} placeholder="e.g. 16GB" />
            )}
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1">Price (₹)</label>
              <input type="number" min={0} value={priceDelta} onChange={(e) => setPriceDelta(e.target.value)} className="border p-2 w-full rounded" />
            </div>
            <button onClick={addRule} disabled={saving} className="bg-primary text-primary-foreground px-4 py-2 rounded disabled:opacity-50 h-fit self-end">
              {saving ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No upgrade rules configured yet.</p>
      ) : (
        <table className="min-w-full border">
          <thead>
            <tr>
              <th className="border p-2 text-left">Category</th>
              <th className="border p-2 text-left">Field</th>
              <th className="border p-2 text-left">From</th>
              <th className="border p-2 text-left">To</th>
              <th className="border p-2 text-right">Price</th>
              <th className="border p-2 text-center">Active</th>
              <th className="border p-2"></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className={r.is_active ? '' : 'opacity-50'}>
                <td className="border p-2">{r.category}</td>
                <td className="border p-2">{FIELD_OPTIONS.find((f) => f.value === r.field_name)?.label || r.field_name}</td>
                <td className="border p-2">{r.from_value}</td>
                <td className="border p-2">{r.to_value}</td>
                <td className="border p-2 text-right tabular-nums">₹{Number(r.price_delta).toFixed(2)}</td>
                <td className="border p-2 text-center">
                  <button onClick={() => toggleActive(r)} className="text-primary underline text-xs">
                    {r.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
                <td className="border p-2">
                  <button onClick={() => removeRule(r.id)} className="text-destructive underline text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

interface Promotion {
  id: string
  name: string
  promo_type: 'percent_off' | 'flat_off' | 'free_gift' | 'coupon_code'
  code: string | null
  discount_percent: number | null
  discount_flat: number | null
  free_gift_sku_id: string | null
  scope_type: 'product' | 'brand' | 'category' | 'sitewide'
  scope_value: string | null
  starts_at: string
  ends_at: string
  is_stackable: boolean
  is_active: boolean
  min_order_value: number | null
}

const PROMO_TYPE_LABELS: Record<Promotion['promo_type'], string> = {
  percent_off: '% Off',
  flat_off: 'Flat ₹ Off',
  free_gift: 'Free Gift',
  coupon_code: 'Coupon Code (no discount, just requires a code)',
}

function toLocalDatetimeInput(iso?: string) {
  if (!iso) return ''
  return new Date(iso).toISOString().slice(0, 16)
}

function PromotionsSection() {
  const [promos, setPromos] = useState<Promotion[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [name, setName] = useState('')
  const [promoType, setPromoType] = useState<Promotion['promo_type']>('percent_off')
  const [code, setCode] = useState('')
  const [discountPercent, setDiscountPercent] = useState('')
  const [discountFlat, setDiscountFlat] = useState('')
  const [freeGiftSkuId, setFreeGiftSkuId] = useState('')
  const [scopeType, setScopeType] = useState<Promotion['scope_type']>('sitewide')
  const [scopeValue, setScopeValue] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [isStackable, setIsStackable] = useState(false)
  const [minOrderValue, setMinOrderValue] = useState('')

  const fetchPromos = async () => {
    setLoading(true)
    const res = await apiFetch('/api/website-admin/promotions')
    if (res.ok) setPromos(await res.json())
    setLoading(false)
  }

  useEffect(() => { fetchPromos() }, [])

  const addPromo = async () => {
    setError('')
    if (!name.trim() || !startsAt || !endsAt) {
      setError('Name, start date, and end date are all required.')
      return
    }
    setSaving(true)
    try {
      const res = await apiFetch('/api/website-admin/promotions', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          promo_type: promoType,
          code: code.trim() || null,
          discount_percent: promoType === 'percent_off' ? Number(discountPercent) : null,
          discount_flat: promoType === 'flat_off' ? Number(discountFlat) : null,
          free_gift_sku_id: promoType === 'free_gift' ? freeGiftSkuId.trim() : null,
          scope_type: scopeType,
          scope_value: scopeType !== 'sitewide' ? scopeValue.trim() : null,
          starts_at: new Date(startsAt).toISOString(),
          ends_at: new Date(endsAt).toISOString(),
          is_stackable: isStackable,
          min_order_value: minOrderValue ? Number(minOrderValue) : null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error || 'Failed to add promotion')
        return
      }
      setName(''); setCode(''); setDiscountPercent(''); setDiscountFlat(''); setFreeGiftSkuId('')
      setScopeValue(''); setStartsAt(''); setEndsAt(''); setIsStackable(false); setMinOrderValue('')
      await fetchPromos()
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (promo: Promotion) => {
    await apiFetch(`/api/website-admin/promotions/${promo.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !promo.is_active }) })
    await fetchPromos()
  }

  const removePromo = async (id: string) => {
    if (!confirm('Delete this promotion?')) return
    await apiFetch(`/api/website-admin/promotions/${id}`, { method: 'DELETE' })
    await fetchPromos()
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        Discounts, coupon codes, and free-gift promotions for the website. At most one non-stackable promotion
        applies per order (the best discount wins); any number of stackable promotions combine with it and each other.
      </p>

      <div className="border rounded-lg p-4 mb-4 space-y-3">
        <h3 className="text-sm font-semibold">Add Promotion</h3>
        {error && <div className="text-destructive text-sm">{error}</div>}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Festive Sale" className="border p-2 w-full rounded" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Type</label>
            <select value={promoType} onChange={(e) => setPromoType(e.target.value as Promotion['promo_type'])} className="border p-2 w-full rounded">
              {Object.entries(PROMO_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Coupon Code (blank = automatic)</label>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. SUMMER25" className="border p-2 w-full rounded" />
          </div>

          {promoType === 'percent_off' && (
            <div>
              <label className="block text-xs font-medium mb-1">Discount (%)</label>
              <input type="number" min={0} max={100} value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} className="border p-2 w-full rounded" />
            </div>
          )}
          {promoType === 'flat_off' && (
            <div>
              <label className="block text-xs font-medium mb-1">Discount (₹)</label>
              <input type="number" min={0} value={discountFlat} onChange={(e) => setDiscountFlat(e.target.value)} className="border p-2 w-full rounded" />
            </div>
          )}
          {promoType === 'free_gift' && (
            <div>
              <label className="block text-xs font-medium mb-1">Free Gift SKU ID</label>
              <input type="text" value={freeGiftSkuId} onChange={(e) => setFreeGiftSkuId(e.target.value)} placeholder="sku_master.id" className="border p-2 w-full rounded" />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1">Scope</label>
            <select value={scopeType} onChange={(e) => setScopeType(e.target.value as Promotion['scope_type'])} className="border p-2 w-full rounded">
              <option value="sitewide">Sitewide</option>
              <option value="category">Category</option>
              <option value="brand">Brand</option>
              <option value="product">Specific Product (SKU ID)</option>
            </select>
          </div>
          {scopeType !== 'sitewide' && (
            <div>
              <label className="block text-xs font-medium mb-1">
                {scopeType === 'category' ? 'Category code (e.g. LAP)' : scopeType === 'brand' ? 'Brand name' : 'SKU ID'}
              </label>
              <input type="text" value={scopeValue} onChange={(e) => setScopeValue(e.target.value)} className="border p-2 w-full rounded" />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium mb-1">Min Order Value (optional)</label>
            <input type="number" min={0} value={minOrderValue} onChange={(e) => setMinOrderValue(e.target.value)} className="border p-2 w-full rounded" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Starts</label>
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="border p-2 w-full rounded" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Ends</label>
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="border p-2 w-full rounded" />
          </div>
          <label className="flex items-center gap-2 text-xs font-medium mt-5">
            <input type="checkbox" checked={isStackable} onChange={(e) => setIsStackable(e.target.checked)} />
            Stackable with other promotions
          </label>
        </div>
        <button onClick={addPromo} disabled={saving} className="bg-primary text-primary-foreground px-4 py-2 rounded disabled:opacity-50">
          {saving ? 'Adding…' : 'Add Promotion'}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : promos.length === 0 ? (
        <p className="text-sm text-muted-foreground">No promotions configured yet.</p>
      ) : (
        <table className="min-w-full border">
          <thead>
            <tr>
              <th className="border p-2 text-left">Name</th>
              <th className="border p-2 text-left">Type</th>
              <th className="border p-2 text-left">Code</th>
              <th className="border p-2 text-left">Scope</th>
              <th className="border p-2 text-left">Window</th>
              <th className="border p-2 text-center">Stackable</th>
              <th className="border p-2 text-center">Active</th>
              <th className="border p-2"></th>
            </tr>
          </thead>
          <tbody>
            {promos.map((p) => (
              <tr key={p.id} className={p.is_active ? '' : 'opacity-50'}>
                <td className="border p-2">{p.name}</td>
                <td className="border p-2">{PROMO_TYPE_LABELS[p.promo_type]}</td>
                <td className="border p-2 font-mono">{p.code || '—'}</td>
                <td className="border p-2">{p.scope_type}{p.scope_value ? `: ${p.scope_value}` : ''}</td>
                <td className="border p-2 text-xs">{toLocalDatetimeInput(p.starts_at)} → {toLocalDatetimeInput(p.ends_at)}</td>
                <td className="border p-2 text-center">{p.is_stackable ? 'Yes' : 'No'}</td>
                <td className="border p-2 text-center">
                  <button onClick={() => toggleActive(p)} className="text-primary underline text-xs">{p.is_active ? 'Deactivate' : 'Activate'}</button>
                </td>
                <td className="border p-2">
                  <button onClick={() => removePromo(p.id)} className="text-destructive underline text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

interface CrossSellRule {
  id: string
  source_category: string
  suggested_category: string
  sort_order: number
  is_active: boolean
}

function CrossSellSection() {
  const [rules, setRules] = useState<CrossSellRule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [sourceCategory, setSourceCategory] = useState('LAP')
  const [suggestedCategory, setSuggestedCategory] = useState('ACC')

  const fetchRules = async () => {
    setLoading(true)
    const res = await apiFetch('/api/website-admin/cross-sell-rules')
    if (res.ok) setRules(await res.json())
    setLoading(false)
  }

  useEffect(() => { fetchRules() }, [])

  const addRule = async () => {
    setError('')
    setSaving(true)
    try {
      const res = await apiFetch('/api/website-admin/cross-sell-rules', {
        method: 'POST',
        body: JSON.stringify({ source_category: sourceCategory, suggested_category: suggestedCategory }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error || 'Failed to add rule')
        return
      }
      await fetchRules()
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (rule: CrossSellRule) => {
    await apiFetch(`/api/website-admin/cross-sell-rules/${rule.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !rule.is_active }) })
    await fetchRules()
  }

  const removeRule = async (id: string) => {
    if (!confirm('Delete this cross-sell rule?')) return
    await apiFetch(`/api/website-admin/cross-sell-rules/${id}`, { method: 'DELETE' })
    await fetchRules()
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        Which category to suggest under "Complete your setup" on a product page. Seeded from the previous default
        (every category suggests Accessories) — add more specific rules (e.g. Laptops → Adapters) as you like.
      </p>

      <div className="border rounded-lg p-4 mb-4">
        <h3 className="text-sm font-semibold mb-3">Add Rule</h3>
        {error && <div className="text-destructive text-sm mb-2">{error}</div>}
        <div className="flex gap-3 items-end">
          <div>
            <label className="block text-xs font-medium mb-1">When viewing category</label>
            <input type="text" value={sourceCategory} onChange={(e) => setSourceCategory(e.target.value.toUpperCase())} placeholder="e.g. LAP" className="border p-2 rounded w-32" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Suggest category</label>
            <input type="text" value={suggestedCategory} onChange={(e) => setSuggestedCategory(e.target.value.toUpperCase())} placeholder="e.g. ACC" className="border p-2 rounded w-32" />
          </div>
          <button onClick={addRule} disabled={saving} className="bg-primary text-primary-foreground px-4 py-2 rounded disabled:opacity-50">
            {saving ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No cross-sell rules configured yet.</p>
      ) : (
        <table className="min-w-full border">
          <thead>
            <tr>
              <th className="border p-2 text-left">When viewing</th>
              <th className="border p-2 text-left">Suggest</th>
              <th className="border p-2 text-center">Active</th>
              <th className="border p-2"></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className={r.is_active ? '' : 'opacity-50'}>
                <td className="border p-2">{r.source_category}</td>
                <td className="border p-2">{r.suggested_category}</td>
                <td className="border p-2 text-center">
                  <button onClick={() => toggleActive(r)} className="text-primary underline text-xs">{r.is_active ? 'Deactivate' : 'Activate'}</button>
                </td>
                <td className="border p-2">
                  <button onClick={() => removeRule(r.id)} className="text-destructive underline text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

interface Banner {
  id: string
  image_path: string
  image_width: number | null
  image_height: number | null
  link_url: string | null
  title: string | null
  theme: 'default' | 'diwali' | 'christmas' | 'sale' | 'custom'
  custom_color: string | null
  starts_at: string | null
  ends_at: string | null
  is_active: boolean
  sort_order: number
}

const THEME_OPTIONS: { value: Banner['theme']; label: string }[] = [
  { value: 'default', label: 'Default (no tint)' },
  { value: 'diwali', label: 'Diwali (gold / red)' },
  { value: 'christmas', label: 'Christmas (red / green)' },
  { value: 'sale', label: 'Sale (blue)' },
  { value: 'custom', label: 'Custom color' },
]

function toLocalDatetimeInputBanner(iso?: string | null) {
  if (!iso) return ''
  return new Date(iso).toISOString().slice(0, 16)
}

// The homepage now renders every banner at its OWN uploaded aspect ratio (full
// width, no cropping) rather than forcing a fixed ratio -- see HomeBanners.tsx.
// So there's no hard size requirement; this is purely a suggestion for what
// tends to look best as a homepage strip.
const RECOMMENDED_BANNER_HINT = 'Suggested: a wide/landscape image (e.g. 1600×500px), JPG/PNG/WebP, under 3MB. Any size works -- it displays edge-to-edge at its own aspect ratio, nothing gets cropped.'

const emptyBannerForm = {
  imagePath: '', imageWidth: 0, imageHeight: 0, linkUrl: '', title: '',
  theme: 'default' as Banner['theme'], customColor: '#c0392b', startsAt: '', endsAt: '', sortOrder: '0',
}

function BannersSection() {
  const [banners, setBanners] = useState<Banner[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  const [imagePath, setImagePath] = useState(emptyBannerForm.imagePath)
  const [imageDims, setImageDims] = useState({ width: 0, height: 0 })
  const [linkUrl, setLinkUrl] = useState(emptyBannerForm.linkUrl)
  const [title, setTitle] = useState(emptyBannerForm.title)
  const [theme, setTheme] = useState<Banner['theme']>(emptyBannerForm.theme)
  const [customColor, setCustomColor] = useState(emptyBannerForm.customColor)
  const [startsAt, setStartsAt] = useState(emptyBannerForm.startsAt)
  const [endsAt, setEndsAt] = useState(emptyBannerForm.endsAt)
  const [sortOrder, setSortOrder] = useState(emptyBannerForm.sortOrder)

  const resetForm = () => {
    setEditingId(null)
    setImagePath(emptyBannerForm.imagePath)
    setImageDims({ width: 0, height: 0 })
    setLinkUrl(emptyBannerForm.linkUrl)
    setTitle(emptyBannerForm.title)
    setTheme(emptyBannerForm.theme)
    setCustomColor(emptyBannerForm.customColor)
    setStartsAt(emptyBannerForm.startsAt)
    setEndsAt(emptyBannerForm.endsAt)
    setSortOrder(emptyBannerForm.sortOrder)
  }

  const startEdit = (b: Banner) => {
    setEditingId(b.id)
    setImagePath(b.image_path)
    setImageDims({ width: b.image_width || 0, height: b.image_height || 0 })
    setLinkUrl(b.link_url || '')
    setTitle(b.title || '')
    setTheme(b.theme)
    setCustomColor(b.custom_color || emptyBannerForm.customColor)
    setStartsAt(toLocalDatetimeInputBanner(b.starts_at))
    setEndsAt(toLocalDatetimeInputBanner(b.ends_at))
    setSortOrder(String(b.sort_order))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const fetchBanners = async () => {
    setLoading(true)
    const res = await apiFetch('/api/website-admin/banners')
    if (res.ok) setBanners(await res.json())
    setLoading(false)
  }

  useEffect(() => { fetchBanners() }, [])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      // Natural pixel dimensions of the uploaded file -- stored alongside the
      // image so the storefront can render it at its own aspect ratio instead
      // of force-cropping to a fixed one (see HomeBanners.tsx).
      const dims = await new Promise<{ width: number; height: number }>((resolve) => {
        const img = new window.Image()
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
        img.onerror = () => resolve({ width: 0, height: 0 })
        img.src = URL.createObjectURL(file)
      })

      const urlRes = await apiFetch('/api/storage/upload-url', {
        method: 'POST',
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          bucket: 'product-images',
          folder: 'banners',
          fileType: 'banner',
        }),
      })
      if (!urlRes.ok) throw new Error('Could not get upload URL')
      const { uploadUrl, key } = await urlRes.json()
      await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
      setImagePath(key)
      setImageDims(dims)
    } catch (err: any) {
      setError(err.message || 'Upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const saveBanner = async () => {
    setError('')
    if (!imagePath) {
      setError('Upload a banner image first.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        image_path: imagePath,
        image_width: imageDims.width || null,
        image_height: imageDims.height || null,
        link_url: linkUrl.trim() || null,
        title: title.trim() || null,
        theme,
        custom_color: theme === 'custom' ? customColor : null,
        starts_at: startsAt ? new Date(startsAt).toISOString() : null,
        ends_at: endsAt ? new Date(endsAt).toISOString() : null,
        sort_order: Number(sortOrder) || 0,
      }
      const res = await apiFetch(
        editingId ? `/api/website-admin/banners/${editingId}` : '/api/website-admin/banners',
        { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(payload) }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error || `Failed to ${editingId ? 'save' : 'add'} banner`)
        return
      }
      resetForm()
      await fetchBanners()
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (banner: Banner) => {
    await apiFetch(`/api/website-admin/banners/${banner.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !banner.is_active }) })
    await fetchBanners()
  }

  const removeBanner = async (id: string) => {
    if (!confirm('Delete this banner?')) return
    await apiFetch(`/api/website-admin/banners/${id}`, { method: 'DELETE' })
    await fetchBanners()
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        Add one or more banners for the storefront homepage (e.g. a Diwali or festival sale announcement). Multiple
        active banners auto-rotate; only one is shown at a time if just one is active. Use the start/end dates to
        schedule a banner in advance and have it disappear automatically when the sale ends.
      </p>

      <div className="border rounded-lg p-4 mb-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{editingId ? 'Edit Banner' : 'Add Banner'}</h3>
          {editingId && (
            <button onClick={resetForm} className="text-xs text-muted-foreground underline">Cancel edit / add new instead</button>
          )}
        </div>
        {error && <div className="text-destructive text-sm">{error}</div>}

        <div>
          <label className="block text-xs font-medium mb-1">Image</label>
          <p className="text-xs text-muted-foreground mb-2">{RECOMMENDED_BANNER_HINT}</p>
          {imagePath && (
            <div
              className="mb-2 w-full max-w-sm overflow-hidden rounded border bg-muted"
              style={{ aspectRatio: imageDims.width && imageDims.height ? `${imageDims.width} / ${imageDims.height}` : '1600 / 500' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={publicImageUrl(imagePath)} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded border cursor-pointer text-sm hover:bg-accent w-fit">
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {uploading ? 'Uploading…' : imagePath ? 'Replace image' : 'Upload image'}
            <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
          </label>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">Title (optional overlay text)</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Diwali Dhamaka Sale" className="border p-2 w-full rounded" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Link (optional, where the banner goes)</label>
            <input type="text" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="/laptops or a full URL" className="border p-2 w-full rounded" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Theme</label>
            <select value={theme} onChange={(e) => setTheme(e.target.value as Banner['theme'])} className="border p-2 w-full rounded">
              {THEME_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {theme === 'custom' && (
            <div>
              <label className="block text-xs font-medium mb-1">Custom accent color</label>
              <input type="color" value={customColor} onChange={(e) => setCustomColor(e.target.value)} className="border p-1 w-full rounded h-10" />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium mb-1">Starts (optional)</label>
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="border p-2 w-full rounded" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Ends (optional)</label>
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="border p-2 w-full rounded" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Sort order (lower shows first)</label>
            <input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="border p-2 w-full rounded" />
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={saveBanner} disabled={saving || uploading} className="bg-primary text-primary-foreground px-4 py-2 rounded disabled:opacity-50">
            {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Banner'}
          </button>
          {editingId && (
            <button onClick={resetForm} className="px-4 py-2 rounded border">Cancel</button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : banners.length === 0 ? (
        <p className="text-sm text-muted-foreground">No banners configured yet.</p>
      ) : (
        <table className="min-w-full border">
          <thead>
            <tr>
              <th className="border p-2 text-left">Image</th>
              <th className="border p-2 text-left">Title</th>
              <th className="border p-2 text-left">Theme</th>
              <th className="border p-2 text-left">Window</th>
              <th className="border p-2 text-center">Active</th>
              <th className="border p-2"></th>
            </tr>
          </thead>
          <tbody>
            {banners.map((b) => (
              <tr key={b.id} className={b.is_active ? '' : 'opacity-50'}>
                <td className="border p-2">
                  <div className="w-24 h-8 overflow-hidden rounded border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={publicImageUrl(b.image_path)} alt="" className="w-full h-full object-cover" />
                  </div>
                </td>
                <td className="border p-2">{b.title || '—'}</td>
                <td className="border p-2">{THEME_OPTIONS.find((t) => t.value === b.theme)?.label || b.theme}</td>
                <td className="border p-2 text-xs">
                  {b.starts_at || b.ends_at
                    ? `${b.starts_at ? new Date(b.starts_at).toLocaleDateString() : 'Now'} → ${b.ends_at ? new Date(b.ends_at).toLocaleDateString() : 'Forever'}`
                    : 'Always on'}
                </td>
                <td className="border p-2 text-center">
                  <button onClick={() => toggleActive(b)} className="text-primary underline text-xs">{b.is_active ? 'Deactivate' : 'Activate'}</button>
                </td>
                <td className="border p-2 space-x-2 whitespace-nowrap">
                  <button onClick={() => startEdit(b)} className="text-primary underline text-xs">Edit</button>
                  <button onClick={() => removeBanner(b.id)} className="text-destructive underline text-xs inline-flex items-center gap-1">
                    <Trash2 className="size-3" /> Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const TABS = [
  { key: 'upgrade_pricing', label: 'Upgrade Pricing' },
  { key: 'promotions', label: 'Promotions' },
  { key: 'cross_sell', label: 'Cross-sell' },
  { key: 'banners', label: 'Banners' },
] as const

export default function WebsiteAdminManager() {
  const [tab, setTab] = useState<typeof TABS[number]['key']>('upgrade_pricing')

  return (
    <div>
      <div className="flex gap-2 mb-4 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'upgrade_pricing' && <UpgradePricingSection />}
      {tab === 'promotions' && <PromotionsSection />}
      {tab === 'cross_sell' && <CrossSellSection />}
      {tab === 'banners' && <BannersSection />}
    </div>
  )
}

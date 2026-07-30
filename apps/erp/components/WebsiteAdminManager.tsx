'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { SearchableSelect } from '@/components/SearchableSelect'
import { useCustomOptions } from '@/lib/useCustomOptions'

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
      <p className="text-sm text-gray-600 mb-4">
        Configure what upgrades customers can buy on the website (e.g. 8GB RAM → 16GB RAM = +₹3,500), and their price.
        RAM/SSD upgrades are a real physical service performed by staff before shipping; a Warranty upgrade just
        extends the unit&apos;s warranty. Only rules matching a unit&apos;s <em>current</em> spec will show on the
        product page — there is no automatic chaining across tiers.
      </p>

      <div className="border rounded-lg p-4 mb-4">
        <h3 className="text-sm font-semibold mb-3">Add Upgrade Rule</h3>
        {error && <div className="text-red-600 text-sm mb-2">{error}</div>}
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
            <button onClick={addRule} disabled={saving} className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50 h-fit self-end">
              {saving ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-gray-500">No upgrade rules configured yet.</p>
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
                  <button onClick={() => toggleActive(r)} className="text-blue-600 underline text-xs">
                    {r.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
                <td className="border p-2">
                  <button onClick={() => removeRule(r.id)} className="text-red-600 underline text-xs">Delete</button>
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
      <p className="text-sm text-gray-600 mb-4">
        Discounts, coupon codes, and free-gift promotions for the website. At most one non-stackable promotion
        applies per order (the best discount wins); any number of stackable promotions combine with it and each other.
      </p>

      <div className="border rounded-lg p-4 mb-4 space-y-3">
        <h3 className="text-sm font-semibold">Add Promotion</h3>
        {error && <div className="text-red-600 text-sm">{error}</div>}
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
        <button onClick={addPromo} disabled={saving} className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50">
          {saving ? 'Adding…' : 'Add Promotion'}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : promos.length === 0 ? (
        <p className="text-sm text-gray-500">No promotions configured yet.</p>
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
                  <button onClick={() => toggleActive(p)} className="text-blue-600 underline text-xs">{p.is_active ? 'Deactivate' : 'Activate'}</button>
                </td>
                <td className="border p-2">
                  <button onClick={() => removePromo(p.id)} className="text-red-600 underline text-xs">Delete</button>
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
      <p className="text-sm text-gray-600 mb-4">
        Which category to suggest under "Complete your setup" on a product page. Seeded from the previous default
        (every category suggests Accessories) — add more specific rules (e.g. Laptops → Adapters) as you like.
      </p>

      <div className="border rounded-lg p-4 mb-4">
        <h3 className="text-sm font-semibold mb-3">Add Rule</h3>
        {error && <div className="text-red-600 text-sm mb-2">{error}</div>}
        <div className="flex gap-3 items-end">
          <div>
            <label className="block text-xs font-medium mb-1">When viewing category</label>
            <input type="text" value={sourceCategory} onChange={(e) => setSourceCategory(e.target.value.toUpperCase())} placeholder="e.g. LAP" className="border p-2 rounded w-32" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Suggest category</label>
            <input type="text" value={suggestedCategory} onChange={(e) => setSuggestedCategory(e.target.value.toUpperCase())} placeholder="e.g. ACC" className="border p-2 rounded w-32" />
          </div>
          <button onClick={addRule} disabled={saving} className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50">
            {saving ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-gray-500">No cross-sell rules configured yet.</p>
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
                  <button onClick={() => toggleActive(r)} className="text-blue-600 underline text-xs">{r.is_active ? 'Deactivate' : 'Activate'}</button>
                </td>
                <td className="border p-2">
                  <button onClick={() => removeRule(r.id)} className="text-red-600 underline text-xs">Delete</button>
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
              tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'upgrade_pricing' && <UpgradePricingSection />}
      {tab === 'promotions' && <PromotionsSection />}
      {tab === 'cross_sell' && <CrossSellSection />}
    </div>
  )
}

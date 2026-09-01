'use client'

import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useRole } from '@/lib/auth/useRole'
import DropdownOptionsManager from '@/components/DropdownOptionsManager'
import UserManager from '@/components/UserManager'
import BusinessProfileManager from '@/components/BusinessProfileManager'
import TagsManager from '@/components/TagsManager'
import WebsiteAdminManager from '@/components/WebsiteAdminManager'
import FieldRedactionManager from '@/components/FieldRedactionManager'
import DigestsManager from '@/components/DigestsManager'
import AppearanceManager from '@/components/AppearanceManager'
import NavigationManager from '@/components/NavigationManager'
import AuditLogPage from './audit-log/page'
import BackupPageGuarded from './backup/page'
import { useAsyncAction } from '@/lib/useAsyncAction'

interface AssetCounter {
  prefix: string
  year: string
  last_number: number
  year_suffix: string
}

const ENTITY_LABELS: Record<string, string> = {
  DBAS: 'Digitalbluez',
  TTAS: 'Techtenth',
  CSAS: 'Cash',
  OTHR: 'Other',
}

// ownerOnly defaults to true when omitted -- only the 3 self-service tabs below
// explicitly opt out. Settings itself is open to every signed-in role (see
// SettingsPageGuarded); this is what actually gates the admin tabs now that the
// outer <RequireOwner> is gone. Audit Log and Backup moved in here from being
// standalone top-level nav items (components/sidebar.tsx, 2026-09 regroup) --
// their underlying page components are reused as-is via direct import, not
// duplicated; the original /dashboard/settings/audit-log and .../backup routes
// still work if linked directly, they're just no longer in the sidebar.
const CATEGORIES = [
  { key: 'appearance', label: 'Appearance', ownerOnly: false },
  { key: 'navigation', label: 'My Navigation', ownerOnly: false },
  { key: 'audit_log', label: 'Audit Log', ownerOnly: false },
  { key: 'asset_numbering', label: 'Asset Numbering', ownerOnly: true },
  { key: 'dropdown_options', label: 'Dropdown Options', ownerOnly: true },
  { key: 'business_profiles', label: 'Business Profiles', ownerOnly: true },
  { key: 'users', label: 'Users & Access', ownerOnly: true },
  { key: 'activity_tags', label: 'Activity Tags', ownerOnly: true },
  { key: 'website_admin', label: 'Website Admin', ownerOnly: true },
  { key: 'field_redaction', label: 'Field Redaction', ownerOnly: true },
  { key: 'digests', label: 'Digests', ownerOnly: true },
  { key: 'backup', label: 'Backup', ownerOnly: true },
] as const

type CategoryKey = typeof CATEGORIES[number]['key']

function AssetNumberingSection() {
  const [counters, setCounters] = useState<AssetCounter[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const savingRef = useRef<Set<string>>(new Set())

  // Edit state
  const [editValues, setEditValues] = useState<Record<string, { last: number; suffix: string }>>({})

  const fetchCounters = async () => {
    setLoading(true)
    const res = await apiFetch('/api/settings/asset-counters')
    if (res.ok) {
      const data = await res.json()
      setCounters(data)
      const init: any = {}
      data.forEach((c: AssetCounter) => {
        init[c.prefix] = { last: c.last_number, suffix: c.year_suffix || '' }
      })
      setEditValues(init)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchCounters()
  }, [])

  // Save acts on one prefix row at a time -- guard re-entrancy per-prefix so a
  // double click on the same row's Save button can't fire a duplicate update.
  const handleSave = async (prefix: string) => {
    if (savingRef.current.has(prefix)) return
    savingRef.current.add(prefix)
    setSaving(prefix)
    try {
      const vals = editValues[prefix]
      const res = await apiFetch('/api/settings/asset-counters', {
        method: 'PUT',
        body: JSON.stringify({
          prefix,
          last_number: vals.last,
          year_suffix: vals.suffix || null,
        }),
      })
      if (res.ok) {
        alert(`Counter for ${prefix} updated.`)

        fetchCounters()
      } else {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Failed to update')
      }
    } finally {
      savingRef.current.delete(prefix)
      setSaving(prev => (prev === prefix ? null : prev))
    }
  }

  const { run: handleRecalculate, pending: refreshing } = useAsyncAction(async () => {
    const res = await apiFetch('/api/settings/asset-counters', { method: 'POST' })
    if (res.ok) {
      alert('Counters recalculated from existing assets.')
      fetchCounters()
    } else {
      const err = await res.json().catch(() => ({}))
      alert(err.error || 'Recalculate failed')
    }
  })

  const updateEdit = (prefix: string, field: 'last' | 'suffix', value: string) => {
    setEditValues(prev => ({
      ...prev,
      [prefix]: {
        ...prev[prefix],
        [field]: field === 'last' ? parseInt(value) || 0 : value,
      },
    }))
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        Set the last used number and year suffix. After saving, the counter is automatically refreshed from actual assets.
      </p>

      <table className="min-w-full border mb-4">
        <thead>
          <tr>
            <th className="border p-2">Entity</th>
            <th className="border p-2">Prefix</th>
            <th className="border p-2">Year Suffix (e.g., 26)</th>
            <th className="border p-2">Last Used Seq</th>
            <th className="border p-2">Preview</th>
            <th className="border p-2">Action</th>
          </tr>
        </thead>
        <tbody>
          {counters.map(counter => {
            const vals = editValues[counter.prefix] || { last: 0, suffix: '' }
            const nextNum = vals.last + 1
            const suffix = vals.suffix || new Date().getFullYear().toString().slice(-2) // fallback to current year if empty
            const preview = `${counter.prefix}${suffix}-${nextNum}`

            return (
              <tr key={counter.prefix}>
                <td className="border p-2">{ENTITY_LABELS[counter.prefix]}</td>
                <td className="border p-2 font-mono">{counter.prefix}</td>
                <td className="border p-2">
                  <input
                    type="text"
                    maxLength={2}
                    value={vals.suffix}
                    onChange={(e) => updateEdit(counter.prefix, 'suffix', e.target.value)}
                    className="border p-1 w-16 rounded"
                    placeholder="YY"
                  />
                </td>
                <td className="border p-2">
                  <input
                    type="number"
                    min={0}
                    value={vals.last}
                    onChange={(e) => updateEdit(counter.prefix, 'last', e.target.value)}
                    className="border p-1 w-24 rounded"
                  />
                </td>
                <td className="border p-2 font-mono text-muted-foreground">{preview}</td>
                <td className="border p-2">
                  <button
                    onClick={() => handleSave(counter.prefix)}
                    disabled={saving === counter.prefix}
                    className="bg-primary text-primary-foreground px-3 py-1 rounded disabled:opacity-50"
                  >
                    {saving === counter.prefix ? 'Saving…' : 'Save'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <button
        onClick={handleRecalculate}
        disabled={refreshing}
        className="bg-secondary text-secondary-foreground px-4 py-2 rounded disabled:opacity-50"
      >
        {refreshing ? 'Recalculating…' : 'Refresh Counters from Database'}
      </button>
    </div>
  )
}

function SettingsPage() {
  const { isOwner, loading } = useRole()
  const visibleCategories = CATEGORIES.filter(cat => isOwner || !cat.ownerOnly)
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('appearance')

  // A non-owner never had a valid activeCategory beyond the 3 self-service tabs
  // to begin with (default is already 'appearance'), but guard anyway in case a
  // deep link/back-navigation lands on an owner-only key.
  const category = visibleCategories.some(c => c.key === activeCategory) ? activeCategory : visibleCategories[0]?.key

  // Avoids a one-frame flicker of the owner-only tabs disappearing/reappearing
  // while useRole() resolves (isOwner defaults to false before it loads).
  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading...</div>
  }

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 text-foreground">Settings</h1>

      <div className="flex flex-col md:flex-row gap-4 md:gap-6">
        <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible md:w-48 md:shrink-0 pb-1 md:pb-0">
          {visibleCategories.map(cat => (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              className={`shrink-0 md:w-full text-left px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                category === cat.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold mb-3 text-foreground">{visibleCategories.find(c => c.key === category)?.label}</h2>
          {category === 'appearance' && <AppearanceManager />}
          {category === 'navigation' && <NavigationManager />}
          {category === 'audit_log' && <AuditLogPage />}
          {category === 'asset_numbering' && <AssetNumberingSection />}
          {category === 'dropdown_options' && <DropdownOptionsManager />}
          {category === 'business_profiles' && <BusinessProfileManager />}
          {category === 'users' && <UserManager />}
          {category === 'activity_tags' && <TagsManager />}
          {category === 'website_admin' && <WebsiteAdminManager />}
          {category === 'field_redaction' && <FieldRedactionManager />}
          {category === 'digests' && <DigestsManager />}
          {category === 'backup' && <BackupPageGuarded />}
        </div>
      </div>
    </div>
  )
}

// Settings is no longer owner-exclusive -- every signed-in, active user can load
// this page (the layout above it already redirects anonymous visitors to
// /login). Per-tab access is enforced by `visibleCategories` above; the 9
// admin tabs stay owner-gated there, mirroring sidebar.tsx's own canSee().
export default function SettingsPageGuarded() {
  return <SettingsPage />
}

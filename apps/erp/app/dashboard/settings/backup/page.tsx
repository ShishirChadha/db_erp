'use client'

import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import RequireOwner from '@/components/RequireOwner'
import { Checkbox } from '@/components/ui/checkbox'
import { Pagination } from '@/components/Pagination'
import { StatusBadge } from '@/components/StatusBadge'
import { ErrorBanner } from '@/components/ErrorBanner'
import RestorePanel from './RestorePanel'

const MODULES = [
  { key: 'sales', label: 'Sales' },
  { key: 'purchases', label: 'Purchases' },
  { key: 'inventory', label: 'Inventory & Assets' },
  { key: 'repairs', label: 'Repairs' },
  { key: 'customers_vendors', label: 'Customers & Vendors' },
  { key: 'invoices_quotations', label: 'Invoices & Quotations' },
] as const

interface BackupSettings {
  enabled: boolean
  frequency: 'daily' | 'weekly'
  day_of_week: number | null
  hour_local: number
  timezone: string
  modules: string[]
  retention_count: number
}

interface BackupRow {
  id: string
  created_at: string
  trigger_type: 'scheduled' | 'manual' | 'pre_restore_safety'
  modules: string[]
  row_counts: Record<string, number>
  status: 'complete' | 'failed'
  error_message: string | null
  downloaded_at: string | null
  size_bytes: number
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function ModuleChecklist({ selected, onChange }: { selected: string[]; onChange: (modules: string[]) => void }) {
  const isFull = selected.includes('full')

  const toggleFull = (checked: boolean) => {
    onChange(checked ? ['full'] : [])
  }

  const toggleModule = (key: string, checked: boolean) => {
    if (checked) onChange([...selected.filter((m) => m !== 'full'), key])
    else onChange(selected.filter((m) => m !== key))
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm font-medium">
        <Checkbox checked={isFull} onCheckedChange={(v) => toggleFull(!!v)} />
        Full backup (all modules)
      </label>
      <div className="grid grid-cols-2 gap-2 pl-1">
        {MODULES.map((m) => (
          <label key={m.key} className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked={isFull || selected.includes(m.key)} disabled={isFull} onCheckedChange={(v) => toggleModule(m.key, !!v)} />
            {m.label}
          </label>
        ))}
      </div>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ScheduleSection() {
  const [settings, setSettings] = useState<BackupSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)

  const fetchSettings = async () => {
    setLoading(true)
    setError(null)
    const res = await apiFetch('/api/settings/backup-schedule')
    if (res.ok) setSettings(await res.json())
    else setError('Failed to load backup schedule.')
    setLoading(false)
  }

  useEffect(() => {
    fetchSettings()
  }, [])

  const handleSave = async () => {
    if (busyRef.current || !settings) return
    busyRef.current = true
    setSaving(true)
    try {
      const res = await apiFetch('/api/settings/backup-schedule', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: settings.enabled,
          frequency: settings.frequency,
          dayOfWeek: settings.day_of_week,
          hourLocal: settings.hour_local,
          modules: settings.modules,
          retentionCount: settings.retention_count,
          timezone: settings.timezone,
        }),
      })
      if (res.ok) {
        alert('Backup schedule saved.')
        fetchSettings()
      } else {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Failed to save schedule')
      }
    } finally {
      busyRef.current = false
      setSaving(false)
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>
  if (error || !settings) return <ErrorBanner message={error || 'Could not load settings'} onRetry={fetchSettings} />

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <label className="flex items-center gap-2 text-sm font-medium">
        <Checkbox checked={settings.enabled} onCheckedChange={(v) => setSettings({ ...settings, enabled: !!v })} />
        Enable scheduled backups
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <select
          className="border p-2 rounded text-sm"
          value={settings.frequency}
          onChange={(e) => setSettings({ ...settings, frequency: e.target.value as 'daily' | 'weekly' })}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>

        {settings.frequency === 'weekly' && (
          <select
            className="border p-2 rounded text-sm"
            value={settings.day_of_week ?? 0}
            onChange={(e) => setSettings({ ...settings, day_of_week: parseInt(e.target.value) })}
          >
            {DAYS.map((d, i) => (
              <option key={d} value={i}>{d}</option>
            ))}
          </select>
        )}

        <select
          className="border p-2 rounded text-sm"
          value={settings.hour_local}
          onChange={(e) => setSettings({ ...settings, hour_local: parseInt(e.target.value) })}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>{`${h.toString().padStart(2, '0')}:00`}</option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">{settings.timezone}</span>
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Modules to back up</p>
        <ModuleChecklist selected={settings.modules} onChange={(modules) => setSettings({ ...settings, modules })} />
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-muted-foreground">Keep last</label>
        <input
          type="number"
          min={1}
          max={100}
          value={settings.retention_count}
          onChange={(e) => setSettings({ ...settings, retention_count: parseInt(e.target.value) || 1 })}
          className="border p-1 w-16 rounded text-sm"
        />
        <span className="text-sm text-muted-foreground">scheduled backups</span>
      </div>

      <button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground px-4 py-2 rounded disabled:opacity-50 w-fit">
        {saving ? 'Saving…' : 'Save Schedule'}
      </button>
    </div>
  )
}

function BackupNowSection({ onCreated }: { onCreated: () => void }) {
  const [modules, setModules] = useState<string[]>(['full'])
  const [running, setRunning] = useState(false)
  const busyRef = useRef(false)

  const handleRun = async () => {
    if (busyRef.current || modules.length === 0) return
    busyRef.current = true
    setRunning(true)
    try {
      const res = await apiFetch('/api/backup/run', { method: 'POST', body: JSON.stringify({ modules }) })
      if (res.ok) {
        alert('Backup created.')
        onCreated()
      } else {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Backup failed')
      }
    } finally {
      busyRef.current = false
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 max-w-xl">
      <ModuleChecklist selected={modules} onChange={setModules} />
      <button onClick={handleRun} disabled={running || modules.length === 0} className="bg-primary text-primary-foreground px-4 py-2 rounded disabled:opacity-50 w-fit">
        {running ? 'Backing up…' : 'Backup Now'}
      </button>
    </div>
  )
}

function triggerTone(t: BackupRow['trigger_type']): 'info' | 'neutral' | 'purple' {
  if (t === 'scheduled') return 'info'
  if (t === 'pre_restore_safety') return 'purple'
  return 'neutral'
}

function HistorySection({ reloadKey }: { reloadKey: number }) {
  const [rows, setRows] = useState<BackupRow[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pageSize = 20

  const fetchHistory = async (p: number) => {
    setLoading(true)
    setError(null)
    const res = await apiFetch(`/api/backup?page=${p}&limit=${pageSize}`)
    if (res.ok) {
      const { data, total } = await res.json()
      setRows(data)
      setTotal(total)
    } else {
      setError('Failed to load backup history.')
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchHistory(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, reloadKey])

  const handleDownload = async (row: BackupRow) => {
    const res = await apiFetch(`/api/backup/${row.id}/download`)
    if (!res.ok) {
      alert('Download failed.')
      return
    }
    const blob = await res.blob()
    const disposition = res.headers.get('Content-Disposition') || ''
    const match = disposition.match(/filename="([^"]+)"/)
    const filename = match ? match[1] : `backup-${row.id}.json`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    fetchHistory(page)
  }

  if (error) return <ErrorBanner message={error} onRetry={() => fetchHistory(page)} />

  return (
    <div>
      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="p-2 text-left">Created</th>
              <th className="p-2 text-left">Trigger</th>
              <th className="p-2 text-left">Modules</th>
              <th className="p-2 text-left">Rows</th>
              <th className="p-2 text-right">Size</th>
              <th className="p-2 text-left">Status</th>
              <th className="p-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">Loading...</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No backups yet.</td></tr>
            )}
            {!loading && rows.map((row) => {
              const isNew = row.trigger_type === 'scheduled' && !row.downloaded_at
              const totalRows = Object.values(row.row_counts || {}).reduce((a, b) => a + b, 0)
              return (
                <tr key={row.id} className="border-t">
                  <td className="p-2 whitespace-nowrap">
                    {new Date(row.created_at).toLocaleString()}
                    {isNew && <span className="ml-2 inline-block rounded-full bg-primary text-primary-foreground text-xs px-2 py-0.5">new</span>}
                  </td>
                  <td className="p-2"><StatusBadge tone={triggerTone(row.trigger_type)}>{row.trigger_type.replace(/_/g, ' ')}</StatusBadge></td>
                  <td className="p-2">{row.modules.join(', ')}</td>
                  <td className="p-2 tabular-nums">{totalRows}</td>
                  <td className="p-2 text-right tabular-nums">{formatSize(row.size_bytes)}</td>
                  <td className="p-2">
                    <StatusBadge tone={row.status === 'complete' ? 'success' : 'danger'}>{row.status}</StatusBadge>
                  </td>
                  <td className="p-2">
                    {row.status === 'complete' && (
                      <button onClick={() => handleDownload(row)} className="text-primary hover:underline">Download</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
    </div>
  )
}

function BackupPage() {
  const [reloadKey, setReloadKey] = useState(0)

  return (
    <div className="p-4 max-w-5xl mx-auto flex flex-col gap-8">
      <h1 className="text-2xl font-bold">Backup</h1>

      <section>
        <h2 className="text-lg font-semibold mb-3">Schedule</h2>
        <ScheduleSection />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Backup Now</h2>
        <BackupNowSection onCreated={() => setReloadKey((k) => k + 1)} />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">History</h2>
        <HistorySection reloadKey={reloadKey} />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Restore</h2>
        <RestorePanel onApplied={() => setReloadKey((k) => k + 1)} />
      </section>
    </div>
  )
}

export default function BackupPageGuarded() {
  return (
    <RequireOwner>
      <BackupPage />
    </RequireOwner>
  )
}

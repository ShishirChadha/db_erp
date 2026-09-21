'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface SessionRow {
  id: string
  device_label: string | null
  ip_address: string | null
  location: string | null
  created_at: string
  last_seen_at: string
  user: { id: string; full_name: string | null; username: string | null; role: string } | null
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

// Owner-only tab: every active login across every account (manager/employee logins
// are capped and the oldest auto-logged-off past the limit below -- see
// lib/auth/device-sessions.ts; the owner's own logins are shown but never
// auto-kicked). "Log off" here revokes the session row, which the device's next
// request picks up via lib/auth/session.ts and is treated as signed out.
export default function ActiveSessionsManager() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [logOffAllBusy, setLogOffAllBusy] = useState(false)

  const [maxDevices, setMaxDevices] = useState<number | ''>('')
  const [limitSaving, setLimitSaving] = useState(false)
  const [limitSaved, setLimitSaved] = useState(false)

  const fetchSessions = useCallback(async () => {
    setLoading(true)
    setError('')
    const res = await apiFetch('/api/user-sessions')
    if (res.ok) setSessions(await res.json())
    else setError((await res.json().catch(() => ({}))).error || 'Failed to load active devices.')
    setLoading(false)
  }, [])

  const fetchLimit = useCallback(async () => {
    const res = await apiFetch('/api/settings/device-limit')
    if (res.ok) setMaxDevices((await res.json()).max_devices)
  }, [])

  useEffect(() => { fetchSessions(); fetchLimit() }, [fetchSessions, fetchLimit])

  const saveLimit = async () => {
    if (maxDevices === '' || maxDevices < 1) return
    setLimitSaving(true)
    setLimitSaved(false)
    setError('')
    const res = await apiFetch('/api/settings/device-limit', {
      method: 'PATCH',
      body: JSON.stringify({ max_devices: maxDevices }),
    })
    if (res.ok) {
      setLimitSaved(true)
      setTimeout(() => setLimitSaved(false), 2000)
    } else {
      setError((await res.json().catch(() => ({}))).error || 'Failed to save.')
    }
    setLimitSaving(false)
  }

  const logOff = async (session: SessionRow) => {
    const who = session.user?.full_name || session.user?.username || 'this user'
    if (!window.confirm(`Log off ${who}'s "${session.device_label || 'device'}"? They'll be signed out next time they load a page.`)) return
    setBusyId(session.id)
    const res = await apiFetch(`/api/user-sessions/${session.id}`, { method: 'DELETE' })
    if (res.ok) setSessions(prev => prev.filter(s => s.id !== session.id))
    else setError((await res.json().catch(() => ({}))).error || 'Failed to log off device.')
    setBusyId(null)
  }

  const logOffAll = async () => {
    if (!window.confirm('Log off every active device for every user (except this one you\'re using right now)? They\'ll all be signed out next time they load a page.')) return
    setLogOffAllBusy(true)
    setError('')
    const res = await apiFetch('/api/user-sessions', { method: 'DELETE' })
    if (res.ok) {
      await fetchSessions()
    } else {
      setError((await res.json().catch(() => ({}))).error || 'Failed to log off all devices.')
    }
    setLogOffAllBusy(false)
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border p-4 max-w-md space-y-2">
        <label className="text-sm font-medium">Max devices per staff account at once</label>
        <p className="text-xs text-muted-foreground">
          Applies to manager/employee logins. Logging in on a new device past this limit
          automatically signs the least-recently-used device out. Your own owner account is
          never capped.
        </p>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={20}
            className="w-24 h-8"
            value={maxDevices}
            onChange={(e) => setMaxDevices(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
          />
          <Button size="sm" onClick={saveLimit} loading={limitSaving}>Save</Button>
          {limitSaved && <span className="text-xs text-green-600">Saved</span>}
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive text-sm px-4 py-3 rounded-lg">{error}</div>
      )}

      <div className="flex justify-end">
        <Button
          size="sm"
          variant="destructive"
          onClick={logOffAll}
          loading={logOffAllBusy}
          disabled={sessions.length === 0}
        >
          Log off all devices
        </Button>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-2 font-medium">User</th>
              <th className="text-left p-2 font-medium">Device</th>
              <th className="text-left p-2 font-medium">Location</th>
              <th className="text-left p-2 font-medium">Logged in</th>
              <th className="text-left p-2 font-medium">Last active</th>
              <th className="text-left p-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {!loading && sessions.length === 0 && (
              <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No active devices.</td></tr>
            )}
            {sessions.map(s => (
              <tr key={s.id} className="border-b last:border-0">
                <td className="p-2">
                  {s.user?.full_name || s.user?.username || '—'}
                  {s.user?.role === 'owner' && <span className="ml-1 text-xs text-muted-foreground">(Owner)</span>}
                </td>
                <td className="p-2">{s.device_label || 'Unknown device'}</td>
                <td className="p-2">{s.location || (s.ip_address ? s.ip_address : '—')}</td>
                <td className="p-2 whitespace-nowrap">{formatWhen(s.created_at)}</td>
                <td className="p-2 whitespace-nowrap">{formatWhen(s.last_seen_at)}</td>
                <td className="p-2 text-right">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => logOff(s)}
                    loading={busyId === s.id}
                  >
                    Log off
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

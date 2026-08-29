'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ErrorBanner } from '@/components/ErrorBanner'

interface ChannelConfig {
  email_enabled: boolean
  email_from_override: string | null
  whatsapp_enabled: boolean
  whatsapp_phone_number_id: string | null
  whatsapp_has_token: boolean
  whatsapp_template_name: string | null
  whatsapp_graph_api_version: string
  dispatch_url: string | null
  dispatch_has_secret: boolean
}
interface Profile { id: string; full_name: string; role: 'owner' | 'manager' | 'employee'; is_active: boolean }
interface Subscription {
  id?: string
  profile_id: string
  period: 'daily' | 'fortnightly' | 'monthly'
  enabled: boolean
  channels: { email: boolean; whatsapp: boolean; in_app: boolean }
  hour_local: number
  timezone: string
  whatsapp_number: string | null
  email_override: string | null
  blocks: string[]
}
interface RunRow {
  id: string; subscription_id: string; period: string; period_start: string
  channel: string; status: string; error_message: string | null; sent_at: string
}

const PERIODS: Subscription['period'][] = ['daily', 'fortnightly', 'monthly']

function emptySub(profile_id: string, period: Subscription['period']): Subscription {
  return {
    profile_id, period, enabled: false,
    channels: { email: true, whatsapp: false, in_app: true },
    hour_local: 21, timezone: 'Asia/Kolkata',
    whatsapp_number: null, email_override: null, blocks: ['kpis', 'inventory'],
  }
}

// Owner-only channel config + per-person subscriptions for the daily/fortnightly/
// monthly digest engine. Mounted as a Settings tab (app/dashboard/settings/page.tsx)
// -- the owner-only guard lives on that parent page, not here.
export default function DigestsManager() {
  const [config, setConfig] = useState<ChannelConfig | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [subs, setSubs] = useState<Subscription[]>([])
  const [runs, setRuns] = useState<RunRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [testStatus, setTestStatus] = useState<Record<string, string>>({})

  // Draft channel-config form fields (secrets are write-only; GET never returns them).
  const [whatsappToken, setWhatsappToken] = useState('')
  const [dispatchSecret, setDispatchSecret] = useState('')

  const load = async () => {
    setLoading(true)
    const res = await apiFetch('/api/settings/digests')
    if (res.ok) {
      const data = await res.json()
      setConfig(data.config)
      setProfiles(data.profiles || [])
      setRuns(data.recentRuns || [])
      const byKey = new Map((data.subscriptions || []).map((s: Subscription) => [`${s.profile_id}:${s.period}`, s]))
      const full: Subscription[] = []
      for (const p of data.profiles || []) {
        for (const period of PERIODS) {
          full.push((byKey.get(`${p.id}:${period}`) as Subscription) || emptySub(p.id, period))
        }
      }
      setSubs(full)
    } else {
      setError('Failed to load digest settings.')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const saveChannelConfig = async () => {
    if (!config) return
    setSaving(true)
    setError('')
    const res = await apiFetch('/api/settings/digests', {
      method: 'PUT',
      body: JSON.stringify({
        channel_config: {
          ...config,
          whatsapp_access_token: whatsappToken || undefined,
          dispatch_secret: dispatchSecret || undefined,
        },
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to save channel config.')
    } else {
      setWhatsappToken('')
      setDispatchSecret('')
      await load()
    }
    setSaving(false)
  }

  const saveSubscriptions = async () => {
    setSaving(true)
    setError('')
    const res = await apiFetch('/api/settings/digests', { method: 'PUT', body: JSON.stringify({ subscriptions: subs }) })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to save subscriptions.')
    } else {
      await load()
    }
    setSaving(false)
  }

  const sendNow = async (subscriptionId: string, key: string) => {
    setTestStatus((prev) => ({ ...prev, [key]: 'Sending…' }))
    const res = await apiFetch('/api/digests/run?preview=1', { method: 'POST', body: JSON.stringify({ subscription_id: subscriptionId }) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setTestStatus((prev) => ({ ...prev, [key]: `Failed: ${data.error || res.status}` }))
      return
    }
    const summary = Object.entries(data.results || {}).map(([ch, r]: [string, any]) => `${ch}: ${r.success ? 'sent' : r.error}`).join(' · ')
    setTestStatus((prev) => ({ ...prev, [key]: summary || 'Done' }))
  }

  const updateSub = (idx: number, patch: Partial<Subscription>) => {
    setSubs((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>

  return (
    <div>
      <p className="text-sm text-gray-500 mb-6">
        Scheduled daily / fortnightly (1st &amp; 16th) / monthly insight nuggets over email, WhatsApp, and in-app —
        built on the same numbers as Dashboard → Reports. Nothing sends until a channel is enabled below and at
        least one person has an enabled subscription. To send a digest to more than one email address (e.g. an
        accountant who has no ERP login), enter them comma-separated in that row's "Email recipients" column.
      </p>

      {error && <ErrorBanner message={error} />}

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Channels</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Checkbox checked={config?.email_enabled ?? false} onCheckedChange={(v) => setConfig((c) => c && { ...c, email_enabled: !!v })} />
            <label className="text-sm">Email enabled (uses RESEND_API_KEY / RESEND_FROM_EMAIL from the server environment)</label>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">From-address override (optional)</label>
            <input className="w-full border rounded-md h-8 px-2 text-sm" value={config?.email_from_override || ''}
              onChange={(e) => setConfig((c) => c && { ...c, email_from_override: e.target.value })} placeholder="reports@yourdomain.com" />
          </div>

          <hr />

          <div className="flex items-center gap-2">
            <Checkbox checked={config?.whatsapp_enabled ?? false} onCheckedChange={(v) => setConfig((c) => c && { ...c, whatsapp_enabled: !!v })} />
            <label className="text-sm">WhatsApp enabled (Meta WhatsApp Cloud API)</label>
          </div>
          <p className="text-xs text-gray-500">
            Free tier: up to 5 test recipients, 250 conversations/day — plenty for a personal digest. Create a free
            Meta developer app + WhatsApp product, use your spare number (or Meta's free test number) as the
            sender, and get an approved template with body placeholders in this order: period label, revenue,
            units, collections, outstanding.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Phone Number ID</label>
              <input className="w-full border rounded-md h-8 px-2 text-sm" value={config?.whatsapp_phone_number_id || ''}
                onChange={(e) => setConfig((c) => c && { ...c, whatsapp_phone_number_id: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Template name</label>
              <input className="w-full border rounded-md h-8 px-2 text-sm" value={config?.whatsapp_template_name || ''}
                onChange={(e) => setConfig((c) => c && { ...c, whatsapp_template_name: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">
                Access token {config?.whatsapp_has_token && <Badge variant="secondary" className="ml-1 text-xs">stored</Badge>}
              </label>
              <input type="password" className="w-full border rounded-md h-8 px-2 text-sm" value={whatsappToken}
                onChange={(e) => setWhatsappToken(e.target.value)} placeholder={config?.whatsapp_has_token ? 'Leave blank to keep current' : ''} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Graph API version</label>
              <input className="w-full border rounded-md h-8 px-2 text-sm" value={config?.whatsapp_graph_api_version || 'v21.0'}
                onChange={(e) => setConfig((c) => c && { ...c, whatsapp_graph_api_version: e.target.value })} />
            </div>
          </div>

          <hr />

          <div>
            <label className="block text-sm text-gray-600 mb-1">Deployed URL (for the scheduled cron trigger)</label>
            <input className="w-full border rounded-md h-8 px-2 text-sm" value={config?.dispatch_url || ''}
              onChange={(e) => setConfig((c) => c && { ...c, dispatch_url: e.target.value })} placeholder="https://your-app.vercel.app/api/digests/run" />
            <p className="text-xs text-gray-400 mt-1">
              Leave blank to keep automatic scheduling off — "Send now" below still works without it.
            </p>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">
              Dispatch secret {config?.dispatch_has_secret && <Badge variant="secondary" className="ml-1 text-xs">stored</Badge>}
            </label>
            <input type="password" className="w-full border rounded-md h-8 px-2 text-sm" value={dispatchSecret}
              onChange={(e) => setDispatchSecret(e.target.value)} placeholder={config?.dispatch_has_secret ? 'Leave blank to keep current' : 'A random shared secret'} />
          </div>

          <button onClick={saveChannelConfig} disabled={saving} className="h-8 px-4 rounded-md bg-blue-600 text-white text-sm disabled:opacity-50">
            Save Channels
          </button>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Subscriptions</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">Person</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">Period</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-500">On</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-500">Email</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-500">WhatsApp</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-500">In-app</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">Hour</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">Email recipients</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">WhatsApp #</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500"></th>
                </tr>
              </thead>
              <tbody>
                {subs.map((s, idx) => {
                  const profile = profiles.find((p) => p.id === s.profile_id)
                  const key = `${s.profile_id}:${s.period}`
                  return (
                    <tr key={key} className="border-t">
                      <td className="px-3 py-2">{profile?.full_name} <span className="text-xs text-gray-400">({profile?.role})</span></td>
                      <td className="px-3 py-2 capitalize">{s.period}</td>
                      <td className="px-3 py-2 text-center"><Checkbox checked={s.enabled} onCheckedChange={(v) => updateSub(idx, { enabled: !!v })} /></td>
                      <td className="px-3 py-2 text-center"><Checkbox checked={s.channels.email} onCheckedChange={(v) => updateSub(idx, { channels: { ...s.channels, email: !!v } })} /></td>
                      <td className="px-3 py-2 text-center"><Checkbox checked={s.channels.whatsapp} onCheckedChange={(v) => updateSub(idx, { channels: { ...s.channels, whatsapp: !!v } })} /></td>
                      <td className="px-3 py-2 text-center"><Checkbox checked={s.channels.in_app} onCheckedChange={(v) => updateSub(idx, { channels: { ...s.channels, in_app: !!v } })} /></td>
                      <td className="px-3 py-2">
                        <input type="number" min={0} max={23} value={s.hour_local} className="w-14 border rounded-md h-8 px-1 text-sm"
                          onChange={(e) => updateSub(idx, { hour_local: parseInt(e.target.value, 10) || 0 })} />
                      </td>
                      <td className="px-3 py-2">
                        <input value={s.email_override || ''} placeholder="a@x.com, b@y.com" title="Comma-separated addresses. Leave blank to use this person's account email."
                          className="w-44 border rounded-md h-8 px-2 text-sm"
                          onChange={(e) => updateSub(idx, { email_override: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <input value={s.whatsapp_number || ''} placeholder="919991111193" className="w-32 border rounded-md h-8 px-2 text-sm"
                          onChange={(e) => updateSub(idx, { whatsapp_number: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        {s.id ? (
                          <button onClick={() => sendNow(s.id!, key)} className="text-xs text-blue-600 underline whitespace-nowrap">
                            Send now
                          </button>
                        ) : <span className="text-xs text-gray-400">Save first</span>}
                        {testStatus[key] && <p className="text-xs text-gray-500 mt-1 max-w-[200px]">{testStatus[key]}</p>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <button onClick={saveSubscriptions} disabled={saving} className="h-8 px-4 mt-4 rounded-md bg-blue-600 text-white text-sm disabled:opacity-50">
            Save Subscriptions
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent Sends</CardTitle></CardHeader>
        <CardContent>
          {runs.length === 0 ? <p className="text-sm text-gray-500">No digests sent yet.</p> : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Sent</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Period</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Channel</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Status</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-2">{new Date(r.sent_at).toLocaleString('en-IN')}</td>
                      <td className="px-3 py-2 capitalize">{r.period} ({r.period_start})</td>
                      <td className="px-3 py-2 capitalize">{r.channel}</td>
                      <td className="px-3 py-2"><Badge variant={r.status === 'sent' ? 'secondary' : 'destructive'}>{r.status}</Badge></td>
                      <td className="px-3 py-2 text-xs text-gray-500">{r.error_message || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

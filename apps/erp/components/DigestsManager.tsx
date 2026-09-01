'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ErrorBanner } from '@/components/ErrorBanner'
import { ChevronDown, ChevronRight, Send, Mail, MessageCircle, Bell } from 'lucide-react'

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
  period: 'daily' | 'weekly' | 'fortnightly' | 'monthly'
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
interface BlockDef { id: string; label: string; roles: Array<'owner' | 'manager' | 'employee'>; chart?: 'bar' | 'segmented' }

const PERIODS: Subscription['period'][] = ['daily', 'weekly', 'fortnightly', 'monthly']
const PERIOD_LABEL: Record<Subscription['period'], string> = { daily: 'Daily', weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly' }
const PERIOD_HINT: Record<Subscription['period'], string> = {
  daily: 'Yesterday, in full — a fresh closed day every morning.',
  weekly: 'The Monday–Sunday week that just ended, sent every Monday.',
  fortnightly: 'The half-month that just ended (1st–15th or 16th–end), sent on the 1st and 16th.',
  monthly: 'This month so far, 1st to today — not a rolling 30 days, so it grows through the month.',
}

function emptySub(profile_id: string, period: Subscription['period']): Subscription {
  return {
    profile_id, period, enabled: false,
    channels: { email: true, whatsapp: false, in_app: true },
    hour_local: 21, timezone: 'Asia/Kolkata',
    whatsapp_number: null, email_override: null, blocks: ['kpis', 'inventory'],
  }
}

function hourLabel(h: number): string {
  const period = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${period}`
}

// Owner-only channel config + per-person subscriptions for the daily/fortnightly/
// monthly digest engine. Mounted as a Settings tab (app/dashboard/settings/page.tsx)
// -- the owner-only guard lives on that parent page, not here. Everything below is
// collapsed by default (channel form, each person, recent sends) so the page reads
// as a short list of summaries rather than one long always-open form -- expand only
// what you're currently editing.
export default function DigestsManager() {
  const [config, setConfig] = useState<ChannelConfig | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [subs, setSubs] = useState<Subscription[]>([])
  const [runs, setRuns] = useState<RunRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [testStatus, setTestStatus] = useState<Record<string, string>>({})
  const [blockCatalog, setBlockCatalog] = useState<BlockDef[]>([])

  const [channelsOpen, setChannelsOpen] = useState(false)
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null)
  const [runsOpen, setRunsOpen] = useState(false)

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
      setBlockCatalog(data.blockCatalog || [])
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

  const updateSub = (idx: number, patch: Partial<Subscription>) => {
    setSubs((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  // Always clickable, even on a subscription that's never been saved -- silently
  // persists just that one row first (not the whole grid) so "Send now" can double
  // as a format check while you're still deciding on settings, not only after a
  // separate Save step.
  const sendNow = async (idx: number) => {
    const target = subs[idx]
    const key = `${target.profile_id}:${target.period}`
    setTestStatus((prev) => ({ ...prev, [key]: 'Sending…' }))

    let subscriptionId = target.id
    if (!subscriptionId) {
      const saveRes = await apiFetch('/api/settings/digests', { method: 'PUT', body: JSON.stringify({ subscriptions: [target] }) })
      if (!saveRes.ok) {
        setTestStatus((prev) => ({ ...prev, [key]: 'Could not save before sending' }))
        return
      }
      const reload = await apiFetch('/api/settings/digests')
      const data = await reload.json().catch(() => ({}))
      const saved = (data.subscriptions || []).find((s: Subscription) => s.profile_id === target.profile_id && s.period === target.period)
      subscriptionId = saved?.id
      if (saved) setSubs((prev) => prev.map((s, i) => (i === idx ? { ...s, id: saved.id } : s)))
    }
    if (!subscriptionId) {
      setTestStatus((prev) => ({ ...prev, [key]: 'Failed to save' }))
      return
    }

    const res = await apiFetch('/api/digests/run?preview=1', { method: 'POST', body: JSON.stringify({ subscription_id: subscriptionId }) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setTestStatus((prev) => ({ ...prev, [key]: `Failed: ${data.error || res.status}` }))
      return
    }
    const summary = Object.entries(data.results || {}).map(([ch, r]: [string, any]) => `${ch}: ${r.success ? 'sent' : r.error}`).join(' · ')
    setTestStatus((prev) => ({ ...prev, [key]: summary || 'Done' }))
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>

  const emailStatus = config?.email_enabled
    ? `Email on${config.email_from_override ? ` · ${config.email_from_override}` : ''}`
    : 'Email off'
  const whatsappStatus = config?.whatsapp_enabled ? 'WhatsApp on' : 'WhatsApp not configured'

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-muted-foreground mb-4">
        Scheduled daily / fortnightly (1st &amp; 16th) / monthly insight nuggets, built on the same numbers as
        Dashboard → Reports. Click a section below to expand it.
      </p>

      {error && <ErrorBanner message={error} />}

      {/* ── Channels: collapsed summary, expand to edit ── */}
      <Card className="mb-3">
        <button className="w-full text-left" onClick={() => setChannelsOpen((v) => !v)}>
          <CardHeader className="flex flex-row items-center justify-between py-3">
            <div>
              <CardTitle className="text-sm">Channels</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{emailStatus} · {whatsappStatus}</p>
            </div>
            {channelsOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </CardHeader>
        </button>
        {channelsOpen && (
          <CardContent className="space-y-4 pt-0">
            <div className="flex items-center gap-2">
              <Checkbox checked={config?.email_enabled ?? false} onCheckedChange={(v) => setConfig((c) => c && { ...c, email_enabled: !!v })} />
              <label className="text-sm">Email enabled (uses RESEND_API_KEY / RESEND_FROM_EMAIL from the server environment)</label>
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">From-address override (optional)</label>
              <input className="w-full border rounded-md h-8 px-2 text-sm" value={config?.email_from_override || ''}
                onChange={(e) => setConfig((c) => c && { ...c, email_from_override: e.target.value })} placeholder="reports@yourdomain.com" />
            </div>

            <hr />

            <div className="flex items-center gap-2">
              <Checkbox checked={config?.whatsapp_enabled ?? false} onCheckedChange={(v) => setConfig((c) => c && { ...c, whatsapp_enabled: !!v })} />
              <label className="text-sm">WhatsApp enabled (Meta WhatsApp Cloud API)</label>
            </div>
            <p className="text-xs text-muted-foreground">
              Free tier: up to 5 test recipients, 250 conversations/day. Create a free Meta developer app + WhatsApp
              product, use a spare number (or Meta's free test number) as the sender, and get an approved template
              with body placeholders in this order: period label, revenue, units, collections, outstanding.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Phone Number ID</label>
                <input className="w-full border rounded-md h-8 px-2 text-sm" value={config?.whatsapp_phone_number_id || ''}
                  onChange={(e) => setConfig((c) => c && { ...c, whatsapp_phone_number_id: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Template name</label>
                <input className="w-full border rounded-md h-8 px-2 text-sm" value={config?.whatsapp_template_name || ''}
                  onChange={(e) => setConfig((c) => c && { ...c, whatsapp_template_name: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">
                  Access token {config?.whatsapp_has_token && <Badge variant="secondary" className="ml-1 text-xs">stored</Badge>}
                </label>
                <input type="password" className="w-full border rounded-md h-8 px-2 text-sm" value={whatsappToken}
                  onChange={(e) => setWhatsappToken(e.target.value)} placeholder={config?.whatsapp_has_token ? 'Leave blank to keep current' : ''} />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Graph API version</label>
                <input className="w-full border rounded-md h-8 px-2 text-sm" value={config?.whatsapp_graph_api_version || 'v21.0'}
                  onChange={(e) => setConfig((c) => c && { ...c, whatsapp_graph_api_version: e.target.value })} />
              </div>
            </div>

            <hr />

            <div>
              <label className="block text-sm text-muted-foreground mb-1">Deployed URL (for the scheduled cron trigger)</label>
              <input className="w-full border rounded-md h-8 px-2 text-sm" value={config?.dispatch_url || ''}
                onChange={(e) => setConfig((c) => c && { ...c, dispatch_url: e.target.value })} placeholder="https://your-app.vercel.app/api/digests/run" />
              <p className="text-xs text-muted-foreground mt-1">Leave blank to keep automatic scheduling off — "Send now" still works without it.</p>
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                Dispatch secret {config?.dispatch_has_secret && <Badge variant="secondary" className="ml-1 text-xs">stored</Badge>}
              </label>
              <input type="password" className="w-full border rounded-md h-8 px-2 text-sm" value={dispatchSecret}
                onChange={(e) => setDispatchSecret(e.target.value)} placeholder={config?.dispatch_has_secret ? 'Leave blank to keep current' : 'A random shared secret'} />
            </div>

            <button onClick={saveChannelConfig} disabled={saving} className="h-8 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50">
              Save Channels
            </button>
          </CardContent>
        )}
      </Card>

      {/* ── One card per person, collapsed by default ── */}
      <div className="mb-3 space-y-2">
        {profiles.map((profile) => {
          const rows = PERIODS.map((period) => ({
            period,
            idx: subs.findIndex((s) => s.profile_id === profile.id && s.period === period),
          }))
          const isExpanded = expandedProfileId === profile.id

          return (
            <Card key={profile.id}>
              <button className="w-full text-left" onClick={() => setExpandedProfileId(isExpanded ? null : profile.id)}>
                <CardHeader className="flex flex-row items-center justify-between py-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                    <div>
                      <CardTitle className="text-sm">{profile.full_name} <span className="text-xs font-normal text-muted-foreground capitalize">({profile.role})</span></CardTitle>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {rows.map(({ period, idx }) => {
                      const s = idx >= 0 ? subs[idx] : null
                      if (!s) return null
                      return (
                        <span
                          key={period}
                          onClick={(e) => e.stopPropagation()}
                          className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border ${
                            s.enabled ? 'border-success/20 bg-success/15 text-success' : 'border-border bg-muted text-muted-foreground'
                          }`}
                        >
                          {PERIOD_LABEL[period]}{s.enabled ? ` · ${hourLabel(s.hour_local)}` : ''}
                          <button
                            title={`Send a test ${period} digest now`}
                            onClick={() => sendNow(idx)}
                            className="ml-0.5 text-muted-foreground hover:text-primary"
                          >
                            <Send className="h-3 w-3" />
                          </button>
                        </span>
                      )
                    })}
                  </div>
                </CardHeader>
              </button>

              {isExpanded && (
                <CardContent className="pt-0">
                  <Tabs defaultValue="daily">
                    <TabsList className="mb-3">
                      {PERIODS.map((period) => <TabsTrigger key={period} value={period}>{PERIOD_LABEL[period]}</TabsTrigger>)}
                    </TabsList>
                    {rows.map(({ period, idx }) => {
                      if (idx < 0) return null
                      const s = subs[idx]
                      const key = `${s.profile_id}:${s.period}`
                      const availableBlocks = blockCatalog.filter((b) => b.roles.includes(profile.role))
                      return (
                        <TabsContent key={period} value={period} className="space-y-4">
                          <p className="text-xs text-muted-foreground">{PERIOD_HINT[period]}</p>
                          <div className="flex flex-wrap items-center gap-4">
                            <label className="flex items-center gap-2 text-sm">
                              <Checkbox checked={s.enabled} onCheckedChange={(v) => updateSub(idx, { enabled: !!v })} />
                              Send this digest
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                              Hour
                              <input type="number" min={0} max={23} value={s.hour_local} className="w-14 border rounded-md h-8 px-1 text-sm"
                                onChange={(e) => updateSub(idx, { hour_local: parseInt(e.target.value, 10) || 0 })} />
                              <span className="text-xs text-muted-foreground">({s.timezone})</span>
                            </label>
                          </div>

                          <div className="flex flex-wrap gap-3">
                            <label className="flex items-center gap-1.5 text-sm border rounded-md px-2 py-1">
                              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                              <Checkbox checked={s.channels.email} onCheckedChange={(v) => updateSub(idx, { channels: { ...s.channels, email: !!v } })} />
                              Email
                            </label>
                            <label className="flex items-center gap-1.5 text-sm border rounded-md px-2 py-1">
                              <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
                              <Checkbox checked={s.channels.whatsapp} onCheckedChange={(v) => updateSub(idx, { channels: { ...s.channels, whatsapp: !!v } })} />
                              WhatsApp
                            </label>
                            <label className="flex items-center gap-1.5 text-sm border rounded-md px-2 py-1">
                              <Bell className="h-3.5 w-3.5 text-muted-foreground" />
                              <Checkbox checked={s.channels.in_app} onCheckedChange={(v) => updateSub(idx, { channels: { ...s.channels, in_app: !!v } })} />
                              In-app
                            </label>
                          </div>

                          {s.channels.email && (
                            <div>
                              <label className="block text-xs text-muted-foreground mb-1">Email recipients (comma-separated; blank = this person's account email)</label>
                              <input value={s.email_override || ''} placeholder="a@x.com, b@y.com"
                                className="w-full max-w-sm border rounded-md h-8 px-2 text-sm"
                                onChange={(e) => updateSub(idx, { email_override: e.target.value })} />
                            </div>
                          )}
                          {s.channels.whatsapp && (
                            <div>
                              <label className="block text-xs text-muted-foreground mb-1">WhatsApp number (with country code, no +)</label>
                              <input value={s.whatsapp_number || ''} placeholder="919991111193"
                                className="w-full max-w-sm border rounded-md h-8 px-2 text-sm"
                                onChange={(e) => updateSub(idx, { whatsapp_number: e.target.value })} />
                            </div>
                          )}

                          <div>
                            <p className="text-xs text-muted-foreground mb-2">
                              Sections in this digest ({s.blocks.length} of {availableBlocks.length} selected)
                            </p>
                            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                              {availableBlocks.map((b) => (
                                <label key={b.id} className="flex items-center gap-1.5 text-sm">
                                  <Checkbox
                                    checked={s.blocks.includes(b.id)}
                                    onCheckedChange={(v) => updateSub(idx, {
                                      blocks: v ? [...s.blocks, b.id] : s.blocks.filter((x) => x !== b.id),
                                    })}
                                  />
                                  {b.label}
                                  {b.chart && <Badge variant="secondary" className="text-xs">chart</Badge>}
                                </label>
                              ))}
                            </div>
                          </div>

                          <div className="flex items-center gap-3 pt-1">
                            <button onClick={saveSubscriptions} disabled={saving} className="h-8 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50">
                              Save
                            </button>
                            <button onClick={() => sendNow(idx)} className="h-8 px-3 rounded-md border text-sm inline-flex items-center gap-1.5 text-muted-foreground hover:bg-muted">
                              <Send className="h-3.5 w-3.5" /> Send test now
                            </button>
                            {testStatus[key] && <span className="text-xs text-muted-foreground">{testStatus[key]}</span>}
                          </div>
                        </TabsContent>
                      )
                    })}
                  </Tabs>
                </CardContent>
              )}
            </Card>
          )
        })}
      </div>

      {/* ── Recent sends: collapsed by default, it's a log not primary config ── */}
      <Card>
        <button className="w-full text-left" onClick={() => setRunsOpen((v) => !v)}>
          <CardHeader className="flex flex-row items-center justify-between py-3">
            <CardTitle className="text-sm">Recent Sends {runs.length > 0 && <span className="text-xs font-normal text-muted-foreground">({runs.length})</span>}</CardTitle>
            {runsOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </CardHeader>
        </button>
        {runsOpen && (
          <CardContent className="pt-0">
            {runs.length === 0 ? <p className="text-sm text-muted-foreground">No digests sent yet.</p> : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Sent</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Period</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Channel</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="px-3 py-2">{new Date(r.sent_at).toLocaleString('en-IN')}</td>
                        <td className="px-3 py-2 capitalize">{r.period} ({r.period_start})</td>
                        <td className="px-3 py-2 capitalize">{r.channel}</td>
                        <td className="px-3 py-2"><Badge variant={r.status === 'sent' ? 'secondary' : 'destructive'}>{r.status}</Badge></td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{r.error_message || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  )
}

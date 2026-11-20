'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Play, Trash2, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { apiFetch } from '@/lib/api-client'
import { useAsyncAction } from '@/lib/useAsyncAction'
import { useVoice } from './useVoice'

// Settings -> DB Assistant. Only DB's master sees this tab (the config route
// answers 403 to everyone else). Stacked sections, no tab strip.

type Money = { usd: number; inr: number }
type Usage = {
  today: { claude: Money; sarvam: Money }
  month: { claude: Money; sarvam: Money }
  since_credit: { claude: Money; sarvam: Money } | null
  conversations_this_month: number
}
type Config = {
  settings: any
  sarvam_key_configured: boolean
  sarvam_key_from_env: boolean
  status: { ready: boolean; reason?: string }
  owners: { id: string; full_name: string | null; username: string | null }[]
  me: string
  voices: { id: string; label: string }[]
  models: string[]
  usage: Usage
}
type Note = { id: string; note: string; created_at: string; customers: { customer_name: string } | null }

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: n < 100 ? 2 : 0 })}`
const usd = (n: number) => `$${n.toFixed(n < 10 ? 3 : 2)}`
const MODEL_LABELS: Record<string, string> = {
  'claude-opus-5-5': 'Opus 5.5 — smartest (recommended)',
  'claude-sonnet-5-5': 'Sonnet 5.5 — about half the cost, a little less sharp',
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div>
        <h3 className="font-medium">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

export default function AssistantSettingsManager() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [s, setS] = useState<any>(null)
  const [key, setKey] = useState('')
  const [notes, setNotes] = useState<Note[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = async () => {
    const r = await apiFetch('/api/assistant/config')
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error || 'Not available.'); return }
    const j: Config = await r.json()
    setCfg(j)
    setS({ ...j.settings, wake_phrases_text: (j.settings.wake_phrases || []).join(', ') })
    apiFetch('/api/assistant/notes').then((x) => x.json()).then((n) => setNotes(Array.isArray(n) ? n : []))
  }
  useEffect(() => { load() }, [])

  const preview = useVoice({ provider: s?.voice_provider === 'sarvam' && cfg?.sarvam_key_configured ? 'sarvam' : 'browser', speakReplies: true }, () => {})

  const save = useAsyncAction(async () => {
    setErr(null); setMsg(null)
    const body: any = {
      master_profile_ids: s.master_profile_ids,
      model: s.model,
      voice_provider: s.voice_provider,
      tts_speaker: s.tts_speaker,
      tts_pace: Number(s.tts_pace),
      speak_replies: s.speak_replies,
      wake_word: s.wake_word,
      wake_phrases: String(s.wake_phrases_text || '').split(',').map((x: string) => x.trim()).filter(Boolean),
      hinglish_script: s.hinglish_script,
      anthropic_credit_usd: s.anthropic_credit_usd === '' || s.anthropic_credit_usd == null ? null : Number(s.anthropic_credit_usd),
      sarvam_credit_inr: s.sarvam_credit_inr === '' || s.sarvam_credit_inr == null ? null : Number(s.sarvam_credit_inr),
      credit_since: s.credit_since || null,
      usd_inr: Number(s.usd_inr),
    }
    if (key.trim()) body.sarvam_key = key.trim()
    const r = await apiFetch('/api/assistant/config', { method: 'PUT', body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setErr(j.error || 'Could not save.'); return }
    setKey('')
    setMsg('Saved.')
    window.dispatchEvent(new Event('db-assistant-settings'))
    await load()
  })

  const wake = useAsyncAction(async () => {
    const r = await apiFetch('/api/assistant/setup', { method: 'POST' })
    if (!r.ok) setErr((await r.json().catch(() => ({}))).error || 'Could not set up DB.')
    await load()
  })

  const removeKey = useAsyncAction(async () => {
    await apiFetch('/api/assistant/config', { method: 'PUT', body: JSON.stringify({ sarvam_key: null }) })
    window.dispatchEvent(new Event('db-assistant-settings'))
    await load()
  })

  const forget = async (id: string) => {
    await apiFetch(`/api/assistant/notes?id=${id}`, { method: 'DELETE' })
    setNotes((n) => n.filter((x) => x.id !== id))
  }

  if (err && !cfg) return <p className="text-sm text-muted-foreground">{err}</p>
  if (!cfg || !s) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>

  const set = (k: string, v: unknown) => setS((prev: any) => ({ ...prev, [k]: v }))
  const u = cfg.usage
  const since = u.since_credit
  const claudeLeft = s.anthropic_credit_usd != null && s.anthropic_credit_usd !== '' && since ? Number(s.anthropic_credit_usd) - since.claude.usd : null
  const sarvamLeft = s.sarvam_credit_inr != null && s.sarvam_credit_inr !== '' && since ? Number(s.sarvam_credit_inr) - since.sarvam.inr : null

  return (
    <div className="space-y-4">
      <Section title="DB and who can talk to her" hint="DB only answers the logins ticked here. Everyone else doesn't even see her button.">
        <p className="text-sm">
          Status:{' '}
          {cfg.status.ready ? <span className="text-success">awake</span>
            : cfg.status.reason === 'deactivated' ? <span className="text-destructive">deactivated in Users & Access</span>
            : cfg.status.reason === 'logged_off' ? <span className="text-warning">logged off</span>
            : <span className="text-muted-foreground">not set up</span>}
          {!cfg.status.ready && cfg.status.reason !== 'deactivated' && (
            <Button size="sm" className="ml-3" onClick={() => wake.run()} loading={wake.pending}>{cfg.status.reason === 'logged_off' ? 'Wake DB up' : 'Set up DB'}</Button>
          )}
        </p>
        <div className="space-y-2">
          {cfg.owners.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={s.master_profile_ids.includes(o.id)}
                disabled={o.id === cfg.me}
                onCheckedChange={(c) => set('master_profile_ids', c ? [...s.master_profile_ids, o.id] : s.master_profile_ids.filter((x: string) => x !== o.id))}
              />
              {o.full_name || o.username || 'Owner'} {o.id === cfg.me && <span className="text-xs text-muted-foreground">(you)</span>}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          To stop her completely, log off “DB assistant (server)” in Active Devices, or deactivate the user “DB”.{' '}
          <Link href="/dashboard/assistant" className="underline">Her conversations →</Link>
        </p>
      </Section>

      <Section title="Brain" hint="The AI model DB thinks with.">
        <select value={s.model} onChange={(e) => set('model', e.target.value)} className="h-8 w-full rounded-md border bg-background px-2 text-sm">
          {cfg.models.map((m) => <option key={m} value={m}>{MODEL_LABELS[m] || m}</option>)}
        </select>
      </Section>

      <Section title="Voice" hint="Sarvam AI gives DB a natural Indian voice and understands Hinglish. The browser voice is free but robotic.">
        <div className="flex gap-4 text-sm">
          {(['sarvam', 'browser'] as const).map((p) => (
            <label key={p} className="flex items-center gap-2">
              <input type="radio" name="voice_provider" checked={s.voice_provider === p} onChange={() => set('voice_provider', p)} />
              {p === 'sarvam' ? 'Sarvam AI (natural)' : 'Browser (free)'}
            </label>
          ))}
        </div>
        {s.voice_provider === 'sarvam' && (
          <div className="space-y-2">
            <Label className="text-xs">Sarvam API key</Label>
            {cfg.sarvam_key_from_env ? (
              <p className="text-xs text-muted-foreground">Set on the server (SARVAM_API_KEY).</p>
            ) : (
              <div className="flex gap-2">
                <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={cfg.sarvam_key_configured ? 'Saved — paste a new one to replace' : 'Paste your key from dashboard.sarvam.ai'} />
                {cfg.sarvam_key_configured && <Button variant="outline" size="sm" onClick={() => removeKey.run()} loading={removeKey.pending}>Remove</Button>}
              </div>
            )}
            {!cfg.sarvam_key_configured && <p className="text-xs text-warning">No key yet — DB uses the browser voice until you add one. New Sarvam accounts get ₹100 free credit.</p>}
            <Label className="text-xs">Her voice</Label>
            <div className="flex gap-2">
              <select value={s.tts_speaker} onChange={(e) => set('tts_speaker', e.target.value)} className="h-8 flex-1 rounded-md border bg-background px-2 text-sm">
                {cfg.voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
              <Button
                variant="outline" size="sm" disabled={!cfg.sarvam_key_configured || preview.speaking}
                onClick={() => preview.speak(s.hinglish_script === 'devanagari'
                  ? 'हाय Shishir! मैं DB हूँ। बताइए, आज कौन सा PI बनाना है?'
                  : 'Hi Shishir! Main DB hoon. Bataiye, aaj kaunsa PI banana hai?', { speaker: s.tts_speaker, pace: Number(s.tts_pace) })}
              >
                <Play className="mr-1 h-3.5 w-3.5" />Preview
              </Button>
            </div>
            <Label className="text-xs">Speed: {Number(s.tts_pace).toFixed(2)}×</Label>
            <input type="range" min={0.8} max={1.4} step={0.05} value={s.tts_pace} onChange={(e) => set('tts_pace', Number(e.target.value))} className="w-full" />
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={s.speak_replies} onCheckedChange={(c) => set('speak_replies', !!c)} />Speak her replies out loud
        </label>
      </Section>

      <Section title="Language and tone" hint="DB answers in the language you speak: English gets English, Hindi or Hinglish gets Hinglish.">
        <div className="space-y-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="script" checked={s.hinglish_script === 'devanagari'} onChange={() => set('hinglish_script', 'devanagari')} />
            Hinglish in हिंदी + English script (most natural voice)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="script" checked={s.hinglish_script === 'roman'} onChange={() => set('hinglish_script', 'roman')} />
            Hinglish in Roman letters (easier to read, voice slightly less natural)
          </label>
        </div>
      </Section>

      <Section title="“Hey DB” wake word" hint="Say a wake phrase and DB opens and starts listening — no tapping. Works while the ERP is open on screen (laptop, or a phone with the screen on).">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={s.wake_word} onCheckedChange={(c) => set('wake_word', !!c)} />Listen for my wake phrase on this ERP
        </label>
        <Input value={s.wake_phrases_text} onChange={(e) => set('wake_phrases_text', e.target.value)} placeholder="hey db, db suno" />
        <p className="text-xs text-muted-foreground">Comma-separated. While waiting for the wake phrase, the browser’s own speech service listens (free). A green dot on DB’s button means she is listening for it.</p>
      </Section>

      <Section title="Usage and credit" hint="Exact cost of every request DB makes, counted by the ERP. Neither Anthropic nor Sarvam shares your remaining balance through their API, so enter what you loaded and DB works out what is left.">
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-md bg-muted p-3">
            <p className="text-xs text-muted-foreground">Today</p>
            <p>AI brain: {usd(u.today.claude.usd)} ({inr(u.today.claude.inr)})</p>
            <p>Voice: {inr(u.today.sarvam.inr)}</p>
          </div>
          <div className="rounded-md bg-muted p-3">
            <p className="text-xs text-muted-foreground">This month · {u.conversations_this_month} conversations</p>
            <p>AI brain: {usd(u.month.claude.usd)} ({inr(u.month.claude.inr)})</p>
            <p>Voice: {inr(u.month.sarvam.inr)}</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Anthropic credit loaded (USD)</Label>
            <Input type="number" value={s.anthropic_credit_usd ?? ''} onChange={(e) => set('anthropic_credit_usd', e.target.value)} placeholder="e.g. 20" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Sarvam credit loaded (₹)</Label>
            <Input type="number" value={s.sarvam_credit_inr ?? ''} onChange={(e) => set('sarvam_credit_inr', e.target.value)} placeholder="e.g. 100" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Loaded on (count spend from)</Label>
            <Input type="date" value={s.credit_since ?? ''} onChange={(e) => set('credit_since', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Dollar rate (₹ per $)</Label>
            <Input type="number" value={s.usd_inr} onChange={(e) => set('usd_inr', e.target.value)} />
          </div>
        </div>
        {since && (
          <div className="rounded-md border p-3 text-sm">
            <p>Since {s.credit_since}: AI brain {usd(since.claude.usd)}, voice {inr(since.sarvam.inr)}.</p>
            {claudeLeft != null && <p>Anthropic left (est.): <b>{usd(claudeLeft)}</b> ({inr(claudeLeft * Number(s.usd_inr))})</p>}
            {sarvamLeft != null && <p>Sarvam left (est.): <b>{inr(sarvamLeft)}</b></p>}
            <p className="mt-1 text-xs text-muted-foreground">Only DB’s usage is counted here. If the same Anthropic key is used elsewhere in the ERP (marketing, bank statement reading), the real balance is lower.</p>
          </div>
        )}
        <div className="flex flex-wrap gap-3 text-xs">
          <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">Anthropic billing <ExternalLink className="h-3 w-3" /></a>
          <a href="https://dashboard.sarvam.ai" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">Sarvam dashboard <ExternalLink className="h-3 w-3" /></a>
        </div>
      </Section>

      <Section title="What DB remembers" hint="Preferences you told her to remember. Delete any you no longer want.">
        {notes.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
        {notes.map((n) => (
          <div key={n.id} className="flex items-start justify-between gap-3 rounded-md border p-2 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">{n.customers?.customer_name || 'General'}</p>
              <p>{n.note}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => forget(n.id)} aria-label="Forget"><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </Section>

      <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background py-3">
        <Button onClick={() => save.run()} loading={save.pending}>Save changes</Button>
        {msg && <span className="text-sm text-success">{msg}</span>}
        {err && <span className="text-sm text-destructive">{err}</span>}
      </div>
    </div>
  )
}

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
import { useVoice, type SpeakProvider } from './useVoice'

// Settings -> DB Assistant. Only DB's master sees this tab (the config route
// answers 403 to everyone else). Stacked sections, no tab strip.

type Money = { usd: number; inr: number }
type Attempt<T> = { ok: true; data: T } | { ok: false; error: string } | null
type VoiceOpt = { id: string; label: string }
type Billing = {
  month: { usd: number; by_model: Record<string, number>; data_refreshed_at: string | null }
  today: { usd: number; tokens: number }
  since: { usd: number; data_refreshed_at: string | null } | null
}
type Config = {
  settings: any
  secrets: Record<'sarvam' | 'azure' | 'google' | 'anthropic_admin', { configured: boolean; from_env: boolean }>
  status: { ready: boolean; reason?: string }
  owners: { id: string; full_name: string | null; username: string | null }[]
  me: string
  voices: { sarvam: VoiceOpt[]; azure: Attempt<VoiceOpt[]>; google: Attempt<VoiceOpt[]> }
  models: string[]
  usage: {
    today: { claude: Money; sarvam: Money }
    month: { claude: Money; sarvam: Money }
    since_credit: { claude: Money; sarvam: Money } | null
    conversations_this_month: number
    free_voice_chars_month: { azure: number; google: number }
  }
  free_tts_chars: { azure_tts: number; google_tts: number }
  anthropic_billing: Attempt<Billing>
}
type Note = { id: string; note: string; created_at: string; customers: { customer_name: string } | null }

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: n < 100 ? 2 : 0 })}`
const usd = (n: number) => `$${n.toFixed(n < 10 ? 3 : 2)}`
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'not yet'
const MODEL_LABELS: Record<string, string> = {
  'claude-opus-5-5': 'Opus 5.5 — smartest (recommended)',
  'claude-sonnet-5-5': 'Sonnet 5.5 — about half the cost, a little less sharp',
}
const PROVIDER_LABELS: Record<SpeakProvider, string> = {
  azure: 'Microsoft Azure', google: 'Google Cloud', sarvam: 'Sarvam AI', browser: 'Browser (free, robotic)',
}
const PREVIEW = {
  devanagari: 'हाय Shishir! मैं DB हूँ। बताइए, आज कौन सा PI बनाना है? और हाँ, coffee पी ली या नहीं?',
  roman: 'Hi Shishir! Main DB hoon. Bataiye, aaj kaunsa PI banana hai?',
  english: 'Hi Shishir! It’s DB. Your PI for Limo Auto is ready, shall I send it on WhatsApp?',
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

function KeyField({ label, configured, fromEnv, value, onChange, placeholder, onRemove }: {
  label: string; configured: boolean; fromEnv: boolean; value: string; onChange: (v: string) => void; placeholder: string; onRemove: () => void
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {fromEnv ? <p className="text-xs text-muted-foreground">Set on the server.</p> : (
        <div className="flex gap-2">
          <Input type="password" value={value} onChange={(e) => onChange(e.target.value)} placeholder={configured ? 'Saved — paste a new one to replace' : placeholder} />
          {configured && <Button variant="outline" size="sm" onClick={onRemove}>Remove</Button>}
        </div>
      )}
    </div>
  )
}

export default function AssistantSettingsManager() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [s, setS] = useState<any>(null)
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Note[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = async () => {
    const r = await apiFetch('/api/assistant/config', { timeoutMs: 60_000 })
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error || 'Not available.'); return }
    const j: Config = await r.json()
    setCfg(j)
    setS({ ...j.settings, wake_phrases_text: (j.settings.wake_phrases || []).join(', ') })
    apiFetch('/api/assistant/notes').then((x) => x.json()).then((n) => setNotes(Array.isArray(n) ? n : []))
  }
  useEffect(() => { load() }, [])

  const preview = useVoice({ listen: 'browser', speak: 'browser', speakReplies: true }, () => {})

  const put = async (body: any) => {
    const r = await apiFetch('/api/assistant/config', { method: 'PUT', body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || 'Could not save.')
    window.dispatchEvent(new Event('db-assistant-settings'))
  }

  const save = useAsyncAction(async () => {
    setErr(null); setMsg(null)
    const body: any = {
      master_profile_ids: s.master_profile_ids, model: s.model,
      voice_provider: s.voice_provider, listen_provider: s.listen_provider,
      tts_speaker: s.tts_speaker, azure_voice: s.azure_voice, google_voice: s.google_voice, azure_region: s.azure_region,
      tts_pace: Number(s.tts_pace), speak_replies: s.speak_replies,
      wake_word: s.wake_word,
      wake_phrases: String(s.wake_phrases_text || '').split(',').map((x: string) => x.trim()).filter(Boolean),
      hinglish_script: s.hinglish_script,
      anthropic_credit_usd: s.anthropic_credit_usd === '' || s.anthropic_credit_usd == null ? null : Number(s.anthropic_credit_usd),
      sarvam_credit_inr: s.sarvam_credit_inr === '' || s.sarvam_credit_inr == null ? null : Number(s.sarvam_credit_inr),
      credit_since: s.credit_since || null,
      usd_inr: Number(s.usd_inr),
    }
    for (const [k, v] of Object.entries(keys)) if (v.trim()) body[k] = v.trim()
    try { await put(body) } catch (e) { setErr((e as Error).message); return }
    setKeys({})
    setMsg('Saved.')
    await load()
  })

  const removeKey = async (field: string) => {
    try { await put({ [field]: null }) } catch (e) { setErr((e as Error).message) }
    await load()
  }

  const wake = useAsyncAction(async () => {
    const r = await apiFetch('/api/assistant/setup', { method: 'POST' })
    if (!r.ok) setErr((await r.json().catch(() => ({}))).error || 'Could not set up DB.')
    await load()
  })

  const forget = async (id: string) => {
    await apiFetch(`/api/assistant/notes?id=${id}`, { method: 'DELETE' })
    setNotes((n) => n.filter((x) => x.id !== id))
  }

  if (err && !cfg) return <p className="text-sm text-muted-foreground">{err}</p>
  if (!cfg || !s) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>

  const set = (k: string, v: unknown) => setS((prev: any) => ({ ...prev, [k]: v }))
  const setKey = (k: string, v: string) => setKeys((prev) => ({ ...prev, [k]: v }))
  const vp: SpeakProvider = s.voice_provider
  const voiceList = (p: 'azure' | 'google'): VoiceOpt[] => {
    const a = cfg.voices[p]
    return a && a.ok ? a.data : []
  }
  const voiceError = (p: 'azure' | 'google') => { const a = cfg.voices[p]; return a && !a.ok ? a.error : null }
  const currentVoice = vp === 'azure' ? s.azure_voice : vp === 'google' ? s.google_voice : s.tts_speaker
  const canPreview = vp !== 'browser' && cfg.secrets[vp].configured
  const playPreview = (text: string) => preview.speak(text, { provider: vp, voice: currentVoice, pace: Number(s.tts_pace) })

  const u = cfg.usage
  const billing = cfg.anthropic_billing
  const billed = billing && billing.ok ? billing.data : null
  const loaded = s.anthropic_credit_usd === '' || s.anthropic_credit_usd == null ? null : Number(s.anthropic_credit_usd)
  const anthropicLeft = loaded != null && billed?.since ? loaded - billed.since.usd : null
  const sarvamLoaded = s.sarvam_credit_inr === '' || s.sarvam_credit_inr == null ? null : Number(s.sarvam_credit_inr)
  const sarvamLeft = sarvamLoaded != null && u.since_credit ? sarvamLoaded - u.since_credit.sarvam.inr : null

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

      <Section title="Her voice (speaking)" hint="Who reads DB's replies out loud. Azure and Google are free within their monthly allowance; try each with Preview.">
        <div className="grid gap-1 text-sm sm:grid-cols-2">
          {(['azure', 'google', 'sarvam', 'browser'] as SpeakProvider[]).map((p) => (
            <label key={p} className="flex items-center gap-2">
              <input type="radio" name="voice_provider" checked={vp === p} onChange={() => set('voice_provider', p)} />
              {PROVIDER_LABELS[p]}{p !== 'browser' && !cfg.secrets[p].configured && <span className="text-xs text-muted-foreground">(no key)</span>}
            </label>
          ))}
        </div>

        {vp === 'azure' && (
          <div className="space-y-2">
            <KeyField label="Azure Speech key" configured={cfg.secrets.azure.configured} fromEnv={cfg.secrets.azure.from_env}
              value={keys.azure_key || ''} onChange={(v) => setKey('azure_key', v)} placeholder="Key 1 from your Azure Speech resource" onRemove={() => removeKey('azure_key')} />
            <Label className="text-xs">Azure region (where you created the Speech resource)</Label>
            <Input value={s.azure_region} onChange={(e) => set('azure_region', e.target.value.toLowerCase().replace(/\s/g, ''))} placeholder="centralindia" />
            {voiceError('azure') && <p className="text-xs text-destructive">{voiceError('azure')}</p>}
            {voiceList('azure').length > 0 && (
              <select value={s.azure_voice} onChange={(e) => set('azure_voice', e.target.value)} className="h-8 w-full rounded-md border bg-background px-2 text-sm">
                {voiceList('azure').map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            )}
            <p className="text-xs text-muted-foreground">Free: {u.free_voice_chars_month.azure.toLocaleString('en-IN')} of {cfg.free_tts_chars.azure_tts.toLocaleString('en-IN')} characters used this month (Azure F0 tier).</p>
          </div>
        )}
        {vp === 'google' && (
          <div className="space-y-2">
            <KeyField label="Google Cloud API key (Text-to-Speech enabled)" configured={cfg.secrets.google.configured} fromEnv={cfg.secrets.google.from_env}
              value={keys.google_key || ''} onChange={(v) => setKey('google_key', v)} placeholder="AIza…" onRemove={() => removeKey('google_key')} />
            {voiceError('google') && <p className="text-xs text-destructive">{voiceError('google')}</p>}
            {voiceList('google').length > 0 && (
              <select value={s.google_voice} onChange={(e) => set('google_voice', e.target.value)} className="h-8 w-full rounded-md border bg-background px-2 text-sm">
                {voiceList('google').map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            )}
            <p className="text-xs text-muted-foreground">Free: {u.free_voice_chars_month.google.toLocaleString('en-IN')} of about {cfg.free_tts_chars.google_tts.toLocaleString('en-IN')} Chirp 3 HD characters used this month.</p>
          </div>
        )}
        {vp === 'sarvam' && (
          <div className="space-y-2">
            <KeyField label="Sarvam API key" configured={cfg.secrets.sarvam.configured} fromEnv={cfg.secrets.sarvam.from_env}
              value={keys.sarvam_key || ''} onChange={(v) => setKey('sarvam_key', v)} placeholder="From dashboard.sarvam.ai" onRemove={() => removeKey('sarvam_key')} />
            <select value={s.tts_speaker} onChange={(e) => set('tts_speaker', e.target.value)} className="h-8 w-full rounded-md border bg-background px-2 text-sm">
              {cfg.voices.sarvam.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </div>
        )}

        {vp !== 'browser' && (
          <>
            <Label className="text-xs">Speed: {Number(s.tts_pace).toFixed(2)}×</Label>
            <input type="range" min={0.8} max={1.4} step={0.05} value={s.tts_pace} onChange={(e) => set('tts_pace', Number(e.target.value))} className="w-full" />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={!canPreview || preview.speaking} onClick={() => playPreview(PREVIEW.devanagari)}><Play className="mr-1 h-3.5 w-3.5" />Hinglish</Button>
              <Button variant="outline" size="sm" disabled={!canPreview || preview.speaking} onClick={() => playPreview(PREVIEW.english)}><Play className="mr-1 h-3.5 w-3.5" />English</Button>
              {!canPreview && <span className="self-center text-xs text-muted-foreground">Save the key first, then preview.</span>}
            </div>
          </>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={s.speak_replies} onCheckedChange={(c) => set('speak_replies', !!c)} />Speak her replies out loud
        </label>
      </Section>

      <Section title="Hearing you (listening)" hint="Who turns your speech into text. Sarvam understands Hinglish much better than the browser (which heard “Hi DB” as “IDBI”).">
        <div className="flex gap-4 text-sm">
          {(['sarvam', 'browser'] as const).map((p) => (
            <label key={p} className="flex items-center gap-2">
              <input type="radio" name="listen_provider" checked={s.listen_provider === p} onChange={() => set('listen_provider', p)} />
              {p === 'sarvam' ? 'Sarvam AI' : 'Browser (free)'}
            </label>
          ))}
        </div>
        {s.listen_provider === 'sarvam' && vp !== 'sarvam' && (
          <KeyField label="Sarvam API key" configured={cfg.secrets.sarvam.configured} fromEnv={cfg.secrets.sarvam.from_env}
            value={keys.sarvam_key || ''} onChange={(v) => setKey('sarvam_key', v)} placeholder="From dashboard.sarvam.ai" onRemove={() => removeKey('sarvam_key')} />
        )}
        {s.listen_provider === 'sarvam' && !cfg.secrets.sarvam.configured && <p className="text-xs text-warning">No Sarvam key — DB listens with the browser until you add one.</p>}
      </Section>

      <Section title="Language and tone" hint="DB answers in the language you speak: English gets English, Hindi or Hinglish gets Hinglish.">
        <div className="space-y-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="script" checked={s.hinglish_script === 'devanagari'} onChange={() => set('hinglish_script', 'devanagari')} />
            Hinglish in हिंदी + English script (most natural voice)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="script" checked={s.hinglish_script === 'roman'} onChange={() => set('hinglish_script', 'roman')} />
            Hinglish in Roman letters (easier to read, voice less natural)
          </label>
        </div>
      </Section>

      <Section title="“Hey DB” wake word" hint="Say a wake phrase and DB opens and starts listening — no tapping. Works while the ERP is open on screen (laptop, or a phone with the screen on).">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={s.wake_word} onCheckedChange={(c) => set('wake_word', !!c)} />Listen for my wake phrase on this ERP
        </label>
        <Input value={s.wake_phrases_text} onChange={(e) => set('wake_phrases_text', e.target.value)} placeholder="hey db, db suno" />
        <p className="text-xs text-muted-foreground">Comma-separated. A green dot on DB’s button means she is listening for it.</p>
      </Section>

      <Section title="Anthropic usage and credit (real)" hint="Read from Anthropic's own billing with an Admin API key. Covers every use of your Anthropic account — DB, Marketing, bank statements — not just DB.">
        <KeyField label="Anthropic Admin API key" configured={cfg.secrets.anthropic_admin.configured} fromEnv={cfg.secrets.anthropic_admin.from_env}
          value={keys.anthropic_admin_key || ''} onChange={(v) => setKey('anthropic_admin_key', v)} placeholder="sk-ant-admin… (Claude Console → Settings → Admin keys)" onRemove={() => removeKey('anthropic_admin_key')} />
        {billing && !billing.ok && <p className="text-xs text-destructive">{billing.error}</p>}
        {billed && (
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-md bg-muted p-3">
              <p className="text-xs text-muted-foreground">Today (about 30 min behind)</p>
              <p className="text-lg font-semibold">{usd(billed.today.usd)} <span className="text-sm font-normal text-muted-foreground">{inr(billed.today.usd * Number(s.usd_inr))}</span></p>
              <p className="text-xs text-muted-foreground">{billed.today.tokens.toLocaleString('en-IN')} tokens, priced at list rates</p>
            </div>
            <div className="rounded-md bg-muted p-3">
              <p className="text-xs text-muted-foreground">This month, billed by Anthropic</p>
              <p className="text-lg font-semibold">{usd(billed.month.usd)} <span className="text-sm font-normal text-muted-foreground">{inr(billed.month.usd * Number(s.usd_inr))}</span></p>
              <p className="text-xs text-muted-foreground">Complete up to {when(billed.month.data_refreshed_at)}</p>
            </div>
          </div>
        )}
        {billed && Object.keys(billed.month.by_model).length > 0 && (
          <p className="text-xs text-muted-foreground">By model: {Object.entries(billed.month.by_model).sort((a, b) => b[1] - a[1]).map(([m, v]) => `${m} ${usd(v)}`).join(' · ')}</p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">Credit you loaded (USD)</Label>
            <Input type="number" value={s.anthropic_credit_usd ?? ''} onChange={(e) => set('anthropic_credit_usd', e.target.value)} placeholder="e.g. 20" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Loaded on</Label>
            <Input type="date" value={s.credit_since ?? ''} onChange={(e) => set('credit_since', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Dollar rate (₹ per $)</Label>
            <Input type="number" value={s.usd_inr} onChange={(e) => set('usd_inr', e.target.value)} />
          </div>
        </div>
        {anthropicLeft != null && billed?.since && (
          <p className="rounded-md border p-3 text-sm">
            Spent since {s.credit_since}: {usd(billed.since.usd)}. <b>Credit left (est.): {usd(anthropicLeft)}</b> ({inr(anthropicLeft * Number(s.usd_inr))}).
            <span className="block text-xs text-muted-foreground">Anthropic does not share the balance itself through its API, so this is the credit you entered minus Anthropic’s billed spend (complete up to {when(billed.since.data_refreshed_at)}). Check the exact figure on the billing page.</span>
          </p>
        )}
        <div className="flex flex-wrap gap-3 text-xs">
          <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">Anthropic billing <ExternalLink className="h-3 w-3" /></a>
          <a href="https://console.anthropic.com/settings/admin-keys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">Create an Admin key <ExternalLink className="h-3 w-3" /></a>
        </div>
      </Section>

      <Section title="DB's own usage (live)" hint="Counted by the ERP on every request DB makes, the moment it happens.">
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-md bg-muted p-3">
            <p className="text-xs text-muted-foreground">Today</p>
            <p>Brain: {usd(u.today.claude.usd)} ({inr(u.today.claude.inr)})</p>
            <p>Sarvam: {inr(u.today.sarvam.inr)}</p>
          </div>
          <div className="rounded-md bg-muted p-3">
            <p className="text-xs text-muted-foreground">This month · {u.conversations_this_month} conversations</p>
            <p>Brain: {usd(u.month.claude.usd)} ({inr(u.month.claude.inr)})</p>
            <p>Sarvam: {inr(u.month.sarvam.inr)}</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Sarvam credit loaded (₹)</Label>
            <Input type="number" value={s.sarvam_credit_inr ?? ''} onChange={(e) => set('sarvam_credit_inr', e.target.value)} placeholder="e.g. 100" />
          </div>
          {sarvamLeft != null && <p className="self-end text-sm">Sarvam left (est.): <b>{inr(sarvamLeft)}</b></p>}
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
